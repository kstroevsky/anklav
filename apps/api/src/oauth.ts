import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthUser, AuthedRequest } from './auth';
import { SessionGuard } from './auth';
import { parseBody } from './common/http';
import { DatabaseService } from './db/database.service';
import {
  oauthAuthorizationCodes,
  oauthAuthorizationRequests,
  oauthClients,
  oauthGrantWorkspaces,
  oauthGrants,
  oauthTokens,
  users,
} from './db/schema';
import { WorkspaceService } from './workspace.service';

export const OAUTH_READ_SCOPE = 'anklav:read';
export const OAUTH_WRITE_SCOPE = 'anklav:write';
export const OAUTH_SCOPES = [OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE] as const;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const CLIENT_INACTIVITY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type McpPrincipal = {
  user: AuthUser;
  client: { id: string; name: string };
  grantId: string;
  scopes: Set<string>;
  workspaceIds: Set<string>;
};

type Registration = z.infer<typeof registrationSchema>;
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.string().min(1).max(2_048)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
}).strict();

const authorizationSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().uuid(),
  redirect_uri: z.string().min(1).max(2_048),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().min(1).max(200),
  state: z.string().max(2_048).optional(),
  resource: z.string().url().max(2_048),
});

const tokenSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  code: z.string().min(20).max(512).optional(),
  redirect_uri: z.string().min(1).max(2_048).optional(),
  code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional(),
  refresh_token: z.string().min(20).max(512).optional(),
  client_id: z.string().uuid(),
  resource: z.string().url().max(2_048).optional(),
}).passthrough();

type Limit = { count: number; resetAt: number };

/** OAuth 2.1 public-client authorization server used exclusively for Anklav MCP. */
@Injectable()
export class OAuthService {
  private readonly rateLimits = new Map<string, Limit>();

  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService) {}

  appOrigin(): string {
    const configured = process.env.APP_ORIGIN ?? 'http://localhost:5173';
    const url = new URL(configured);
    return url.origin;
  }

  mcpUrl(): string { return `${this.appOrigin()}/mcp`; }

  assertCanonicalRequest(request: FastifyRequest): void {
    const canonical = new URL(this.appOrigin());
    const forwardedHost = request.headers['x-forwarded-host'];
    const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost ?? request.headers.host;
    const forwardedProto = request.headers['x-forwarded-proto'];
    const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim();
    if (host && host !== canonical.host) throw new BadRequestException('The request host does not match the configured Anklav origin.');
    if (proto && proto !== canonical.protocol.slice(0, -1)) throw new BadRequestException('The request protocol does not match the configured Anklav origin.');
  }

  protectedResourceMetadata() {
    return {
      resource: this.mcpUrl(),
      authorization_servers: [this.appOrigin()],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: `${this.appOrigin()}/api/docs`,
    };
  }

  authorizationServerMetadata() {
    const origin = this.appOrigin();
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [...OAUTH_SCOPES],
    };
  }

  async register(raw: unknown, requestIp: string | undefined) {
    this.limit('registration', requestIp ?? 'unknown', 20, 60 * 60 * 1000);
    const input = parseBody(registrationSchema, raw);
    validateRegistration(input);
    const now = new Date();
    const [client] = await this.database.db.insert(oauthClients).values({
      name: input.client_name,
      redirectUris: input.redirect_uris,
      clientIdIssuedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + CLIENT_INACTIVITY_TTL_MS),
    }).returning();
    return this.clientMetadata(client!);
  }

  async beginAuthorization(raw: unknown) {
    const input = parseBody(authorizationSchema, raw);
    if (input.resource !== this.mcpUrl()) throw oauthError('invalid_target', 'The resource must be this Anklav MCP endpoint.');
    const client = await this.activeClient(input.client_id);
    if (!client.redirectUris.includes(input.redirect_uri)) throw oauthError('invalid_request', 'The redirect_uri must exactly match a registered URI.');
    const scopes = normalizeScopes(input.scope);
    const [pending] = await this.database.db.insert(oauthAuthorizationRequests).values({
      clientId: client.id,
      redirectUri: input.redirect_uri,
      codeChallenge: input.code_challenge,
      scopes: scopes.join(' '),
      state: input.state ?? null,
      resource: input.resource,
      expiresAt: new Date(Date.now() + AUTHORIZATION_REQUEST_TTL_MS),
    }).returning();
    await this.touchClient(client.id);
    return pending!;
  }

  async consentRequest(requestId: string, user: AuthUser) {
    const pending = await this.pendingRequest(requestId);
    const client = await this.activeClient(pending.clientId);
    const workspaces = await this.workspaces.listForUser(user);
    return {
      id: pending.id,
      client: { id: client.id, name: client.name },
      scopes: splitScopes(pending.scopes),
      redirectUri: pending.redirectUri,
      resource: pending.resource,
      expiresAt: pending.expiresAt,
      workspaces,
    };
  }

  async decideConsent(requestId: string, user: AuthUser, input: { approve: boolean; workspaceIds: string[] }) {
    const pending = await this.pendingRequest(requestId);
    if (!input.approve) {
      await this.database.db.delete(oauthAuthorizationRequests).where(eq(oauthAuthorizationRequests.id, pending.id));
      return { redirectUri: redirectWith(pending.redirectUri, { error: 'access_denied', error_description: 'The user declined access.', state: pending.state }) };
    }
    const workspaceIds = [...new Set(input.workspaceIds)];
    if (!workspaceIds.length || workspaceIds.length > 100) throw new BadRequestException('Select at least one active workspace.');
    for (const workspaceId of workspaceIds) await this.workspaces.requireMembership(workspaceId, user);
    const code = opaqueToken();
    const now = new Date();
    const redirectUri = await this.database.db.transaction(async (tx) => {
      const [grant] = await tx.insert(oauthGrants).values({ clientId: pending.clientId, userId: user.id, scopes: pending.scopes, lastUsedAt: now }).returning();
      await tx.insert(oauthGrantWorkspaces).values(workspaceIds.map((workspaceId) => ({ grantId: grant!.id, workspaceId })));
      await tx.insert(oauthAuthorizationCodes).values({
        codeHash: hashToken(code), grantId: grant!.id, clientId: pending.clientId, userId: user.id,
        redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, scopes: pending.scopes,
        resource: pending.resource, expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS),
      });
      await tx.delete(oauthAuthorizationRequests).where(eq(oauthAuthorizationRequests.id, pending.id));
      return redirectWith(pending.redirectUri, { code, state: pending.state, iss: this.appOrigin() });
    });
    await this.touchClient(pending.clientId);
    return { redirectUri };
  }

  async exchangeToken(raw: unknown, requestIp: string | undefined) {
    this.limit('token', requestIp ?? 'unknown', 60, 60 * 1000);
    const input = parseBody(tokenSchema, raw);
    if (input.grant_type === 'authorization_code') return this.exchangeAuthorizationCode(input);
    return this.refresh(input);
  }

  async revoke(raw: unknown, requestIp: string | undefined): Promise<void> {
    this.limit('revoke', requestIp ?? 'unknown', 60, 60 * 1000);
    const input = parseBody(z.object({ token: z.string().min(1).max(512), client_id: z.string().uuid().optional() }).passthrough(), raw);
    await this.database.db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.tokenHash, hashToken(input.token)), input.client_id ? eq(oauthTokens.clientId, input.client_id) : undefined));
  }

  async authenticateMcp(authorization: string | undefined): Promise<McpPrincipal> {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,512})$/);
    if (!match?.[1]) throw new UnauthorizedException('A bearer access token is required.');
    const [row] = await this.database.db.select({ token: oauthTokens, grant: oauthGrants, client: oauthClients, user: users })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id))
      .innerJoin(oauthClients, eq(oauthTokens.clientId, oauthClients.id))
      .innerJoin(users, eq(oauthTokens.userId, users.id))
      .where(and(eq(oauthTokens.tokenHash, hashToken(match[1])), eq(oauthTokens.kind, 'access'), isNull(oauthTokens.revokedAt), isNull(oauthGrants.revokedAt), gt(oauthTokens.expiresAt, new Date()), gt(oauthClients.expiresAt, new Date()), eq(users.active, true)))
      .limit(1);
    if (!row || row.token.resource !== this.mcpUrl()) throw new UnauthorizedException('The access token is invalid, expired, or not valid for this MCP endpoint.');
    const grants = await this.database.db.select({ workspaceId: oauthGrantWorkspaces.workspaceId }).from(oauthGrantWorkspaces).where(eq(oauthGrantWorkspaces.grantId, row.grant.id));
    await this.database.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, row.token.id));
      await tx.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grant.id));
      await tx.update(oauthClients).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + CLIENT_INACTIVITY_TTL_MS) }).where(eq(oauthClients.id, row.client.id));
    });
    return {
      user: { id: row.user.id, email: row.user.email, displayName: row.user.displayName, instanceRole: row.user.instanceRole, theme: row.user.theme as AuthUser['theme'], mcpClient: { id: row.client.id, name: row.client.name } },
      client: { id: row.client.id, name: row.client.name },
      grantId: row.grant.id,
      scopes: new Set(splitScopes(row.token.scopes)),
      workspaceIds: new Set(grants.map((entry) => entry.workspaceId)),
    };
  }

  async listGrants(user: AuthUser) {
    const rows = await this.database.db.select({ grant: oauthGrants, client: oauthClients }).from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
      .where(and(eq(oauthGrants.userId, user.id), isNull(oauthGrants.revokedAt))).orderBy(oauthGrants.createdAt);
    return Promise.all(rows.map(async ({ grant, client }) => ({
      id: grant.id, client: { id: client.id, name: client.name }, scopes: splitScopes(grant.scopes), createdAt: grant.createdAt, lastUsedAt: grant.lastUsedAt,
      workspaceIds: (await this.database.db.select({ workspaceId: oauthGrantWorkspaces.workspaceId }).from(oauthGrantWorkspaces).where(eq(oauthGrantWorkspaces.grantId, grant.id))).map((entry) => entry.workspaceId),
    })));
  }

  async revokeGrant(user: AuthUser, grantId: string): Promise<void> {
    const [grant] = await this.database.db.select({ id: oauthGrants.id }).from(oauthGrants).where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.userId, user.id), isNull(oauthGrants.revokedAt))).limit(1);
    if (!grant) throw new NotFoundException('Connected client grant not found.');
    await this.revokeGrantTokens(grantId);
  }

  private async exchangeAuthorizationCode(input: z.infer<typeof tokenSchema>) {
    if (!input.code || !input.redirect_uri || !input.code_verifier) throw oauthError('invalid_request', 'code, redirect_uri, and code_verifier are required.');
    const [row] = await this.database.db.select({ code: oauthAuthorizationCodes, client: oauthClients, grant: oauthGrants })
      .from(oauthAuthorizationCodes).innerJoin(oauthClients, eq(oauthAuthorizationCodes.clientId, oauthClients.id)).innerJoin(oauthGrants, eq(oauthAuthorizationCodes.grantId, oauthGrants.id))
      .where(and(eq(oauthAuthorizationCodes.codeHash, hashToken(input.code)), eq(oauthAuthorizationCodes.clientId, input.client_id))).limit(1);
    if (!row || row.code.usedAt || row.code.expiresAt <= new Date() || row.grant.revokedAt || row.client.expiresAt <= new Date()) throw oauthError('invalid_grant', 'The authorization code is invalid or expired.');
    if (row.code.redirectUri !== input.redirect_uri || row.code.resource !== this.mcpUrl() || (input.resource && input.resource !== row.code.resource) || !verifyPkce(input.code_verifier, row.code.codeChallenge)) throw oauthError('invalid_grant', 'The authorization code cannot be used with these parameters.');
    const response = await this.database.db.transaction(async (tx) => {
      const [used] = await tx.update(oauthAuthorizationCodes).set({ usedAt: new Date() }).where(and(eq(oauthAuthorizationCodes.id, row.code.id), isNull(oauthAuthorizationCodes.usedAt))).returning();
      if (!used) throw oauthError('invalid_grant', 'The authorization code has already been used.');
      return this.mintTokens(tx, row.code.grantId, row.code.clientId, row.code.userId, row.code.scopes, row.code.resource, randomUUID());
    });
    await this.touchClient(row.client.id);
    return response;
  }

  private async refresh(input: z.infer<typeof tokenSchema>) {
    if (!input.refresh_token) throw oauthError('invalid_request', 'refresh_token is required.');
    const [row] = await this.database.db.select({ token: oauthTokens, grant: oauthGrants, client: oauthClients })
      .from(oauthTokens).innerJoin(oauthGrants, eq(oauthTokens.grantId, oauthGrants.id)).innerJoin(oauthClients, eq(oauthTokens.clientId, oauthClients.id))
      .where(and(eq(oauthTokens.tokenHash, hashToken(input.refresh_token)), eq(oauthTokens.clientId, input.client_id), eq(oauthTokens.kind, 'refresh'))).limit(1);
    if (!row || row.token.expiresAt <= new Date() || row.grant.revokedAt || row.client.expiresAt <= new Date() || row.token.resource !== this.mcpUrl() || (input.resource && input.resource !== row.token.resource)) throw oauthError('invalid_grant', 'The refresh token is invalid or expired.');
    if (row.token.replacedAt || row.token.revokedAt) {
      await this.revokeTokenFamily(row.token.familyId);
      throw oauthError('invalid_grant', 'Refresh-token replay was detected. The connected client has been revoked.');
    }
    const response = await this.database.db.transaction(async (tx) => {
      const [rotated] = await tx.update(oauthTokens).set({ replacedAt: new Date(), lastUsedAt: new Date() }).where(and(eq(oauthTokens.id, row.token.id), isNull(oauthTokens.replacedAt), isNull(oauthTokens.revokedAt))).returning();
      if (!rotated) {
        await this.revokeTokenFamily(row.token.familyId);
        throw oauthError('invalid_grant', 'Refresh-token replay was detected. The connected client has been revoked.');
      }
      return this.mintTokens(tx, row.token.grantId, row.token.clientId, row.token.userId, row.token.scopes, row.token.resource, row.token.familyId);
    });
    await this.touchClient(row.client.id);
    return response;
  }

  private async mintTokens(tx: any, grantId: string, clientId: string, userId: string, scopes: string, resource: string, familyId: string) {
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const now = new Date();
    await tx.insert(oauthTokens).values([
      { tokenHash: hashToken(accessToken), kind: 'access', familyId, grantId, clientId, userId, scopes, resource, expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS), lastUsedAt: now },
      { tokenHash: hashToken(refreshToken), kind: 'refresh', familyId, grantId, clientId, userId, scopes, resource, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS), lastUsedAt: now },
    ]);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refreshToken, scope: scopes, resource };
  }

  private async activeClient(clientId: string) {
    const [client] = await this.database.db.select().from(oauthClients).where(and(eq(oauthClients.id, clientId), gt(oauthClients.expiresAt, new Date()))).limit(1);
    if (!client) throw oauthError('invalid_client', 'The OAuth client is unknown or inactive.');
    return client;
  }

  private async pendingRequest(id: string) {
    const [pending] = await this.database.db.select().from(oauthAuthorizationRequests).where(and(eq(oauthAuthorizationRequests.id, id), gt(oauthAuthorizationRequests.expiresAt, new Date()))).limit(1);
    if (!pending) throw new NotFoundException('The authorization request is invalid or expired.');
    return pending;
  }

  private async touchClient(clientId: string): Promise<void> {
    const now = new Date();
    await this.database.db.update(oauthClients).set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + CLIENT_INACTIVITY_TTL_MS) }).where(eq(oauthClients.id, clientId));
  }

  private async revokeTokenFamily(familyId: string): Promise<void> {
    await this.database.db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
  }

  private async revokeGrantTokens(grantId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.update(oauthGrants).set({ revokedAt: new Date() }).where(eq(oauthGrants.id, grantId));
      await tx.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
    });
  }

  private limit(bucket: string, key: string, maximum: number, windowMs: number): void {
    const now = Date.now();
    const mapKey = `${bucket}:${key}`;
    const current = this.rateLimits.get(mapKey);
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(mapKey, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= maximum) throw oauthError('slow_down', 'Too many requests. Try again later.');
    current.count += 1;
  }

  private clientMetadata(client: typeof oauthClients.$inferSelect) {
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(client.clientIdIssuedAt.getTime() / 1_000),
    };
  }
}

@Controller()
export class OAuthMetadataController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('.well-known/oauth-protected-resource')
  protectedResource(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-protected-resource/mcp')
  protectedResourceAtMcp(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-authorization-server')
  authorizationServer(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.authorizationServerMetadata();
  }
}

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post('register')
  register(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.register(body, request.ip);
  }

  @Get('authorize')
  async authorize(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    const pending = await this.oauth.beginAuthorization(query);
    return reply.code(302).redirect(`${this.oauth.appOrigin()}/oauth/consent?request=${encodeURIComponent(pending.id)}`);
  }

  @Post('token')
  async token(@Body() body: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    try {
      const result = await this.oauth.exchangeToken(body, request.ip);
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      return reply.send(result);
    } catch (error) {
      const result = oauthResult(error);
      reply.code(result.status).header('cache-control', 'no-store').header('pragma', 'no-cache');
      return reply.send(result.body);
    }
  }

  @Post('revoke')
  async revoke(@Body() body: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    await this.oauth.revoke(body, request.ip);
    return reply.code(200).send();
  }
}

@UseGuards(SessionGuard)
@Controller('api/v1/oauth')
export class OAuthSettingsController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('requests/:requestId')
  request(@Param('requestId') requestId: string, @Req() request: AuthedRequest) {
    return this.oauth.consentRequest(requestId, request.user);
  }

  @Post('requests/:requestId/decision')
  decide(@Param('requestId') requestId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(z.object({ approve: z.boolean(), workspaceIds: z.array(z.string().uuid()).max(100).default([]) }), body);
    return this.oauth.decideConsent(requestId, request.user, input);
  }

  @Get('grants')
  grants(@Req() request: AuthedRequest) { return this.oauth.listGrants(request.user); }

  @Delete('grants/:grantId')
  async revokeGrant(@Param('grantId') grantId: string, @Req() request: AuthedRequest) {
    await this.oauth.revokeGrant(request.user, grantId);
    return { ok: true };
  }
}

function validateRegistration(input: Registration): void {
  if (input.grant_types && (!sameSet(input.grant_types, ['authorization_code', 'refresh_token']) && !sameSet(input.grant_types, ['authorization_code']))) throw oauthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  if (input.response_types && !sameSet(input.response_types, ['code'])) throw oauthError('invalid_client_metadata', 'Only the code response type is supported.');
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') throw oauthError('invalid_client_metadata', 'Only public clients without a client secret are supported.');
  for (const redirectUri of input.redirect_uris) if (!isAllowedRedirectUri(redirectUri)) throw oauthError('invalid_redirect_uri', 'Redirect URIs must be HTTPS or an HTTP loopback URI without fragments, userinfo, or wildcards.');
}

export function isAllowedRedirectUri(value: string): boolean {
  if (value.includes('*')) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch { return false; }
}

function normalizeScopes(raw: string): string[] {
  const scopes = [...new Set(raw.trim().split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.length > OAUTH_SCOPES.length || scopes.some((scope) => !OAUTH_SCOPES.includes(scope as typeof OAUTH_SCOPES[number])) || !scopes.includes(OAUTH_READ_SCOPE)) throw oauthError('invalid_scope', 'Request anklav:read and optionally anklav:write.');
  return scopes.sort();
}

function splitScopes(scopes: string): string[] { return scopes.split(' ').filter(Boolean); }
function hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function opaqueToken(): string { return randomBytes(32).toString('base64url'); }
function verifyPkce(verifier: string, challenge: string): boolean {
  const actual = createHash('sha256').update(verifier).digest('base64url');
  return actual.length === challenge.length && timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}
function redirectWith(base: string, values: Record<string, string | null | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}
function sameSet(values: string[], allowed: string[]): boolean { return values.length === allowed.length && values.every((value) => allowed.includes(value)); }
function oauthError(error: string, description: string): BadRequestException { return new BadRequestException({ oauthError: error, error_description: description }); }
function oauthResult(error: unknown): { status: number; body: Record<string, string> } {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'oauthError' in response) {
      const body = response as { oauthError: string; error_description: string };
      return { status: body.oauthError === 'slow_down' ? 429 : 400, body: { error: body.oauthError, error_description: body.error_description } };
    }
  }
  return { status: 400, body: { error: 'invalid_request', error_description: 'The token request is invalid.' } };
}
