import { BadRequestException, ConflictException, Controller, Get, Injectable, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Body, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser, AuthedRequest } from './auth';
import { SessionGuard } from './auth';
import { slugify, uuidv7 } from './common/ids';
import { parseBody } from './common/http';
import { DatabaseService } from './db/database.service';
import {
  githubConnections,
  githubIssueLinks,
  githubOauthStates,
  githubProjectRepositories,
  githubPullRequests,
  githubRepositories,
  githubTaskPullRequests,
  githubUserConnections,
  githubWebhookDeliveries,
  integrationJobs,
  notifications,
  projectTaskCounters,
  projects,
  taskIdentifierAliases,
  tasks,
  workflowStates,
  workspaceMemberships,
} from './db/schema';
import { WorkspaceService } from './workspace.service';

const GITHUB_API = 'https://api.github.com';
const stateInput = z.object({ organizationLogin: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9-]+$/) });
const mappingInput = z.object({
  repositoryId: z.string().uuid(), projectId: z.string().uuid(), syncMode: z.enum(['none', 'inbound', 'bidirectional']).default('none'),
  defaultInbound: z.boolean().default(false), defaultOutbound: z.boolean().default(false), openStateId: z.string().uuid().nullable().optional(), closedStateId: z.string().uuid().nullable().optional(),
});
const issueInput = z.object({ repositoryId: z.string().uuid(), syncMode: z.enum(['manual', 'inbound', 'bidirectional']).default('manual') });
const reviewInput = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(65_000).optional().default(''), comments: z.array(z.object({ path: z.string().min(1), line: z.number().int().positive(), side: z.enum(['LEFT', 'RIGHT']), body: z.string().min(1).max(65_000) })).max(100).default([]) });
const mergeInput = z.object({ method: z.enum(['merge', 'squash', 'rebase']).default('squash'), commitTitle: z.string().max(300).optional(), commitMessage: z.string().max(65_000).optional() });
const pullRequestCommentInput = z.object({ body: z.string().trim().min(1).max(65_000), path: z.string().min(1).optional(), line: z.number().int().positive().optional(), side: z.enum(['LEFT', 'RIGHT']).optional() });

type GitHubCredentials = { appId: number; clientId: string; clientSecret: string; privateKey: string; webhookSecret: string };
type GitHubPayload = Record<string, any>;

export function githubFeatureEnabled() { return process.env.GITHUB_INTEGRATION_ENABLED === 'true'; }

export function taskBranchName(identifier: string, title: string, template = '{identifier}-{slug}') {
  const slug = slugify(title) || 'task';
  return template.replaceAll('{identifier}', identifier.toLowerCase()).replaceAll('{slug}', slug).slice(0, 240);
}

export function githubReferences(text: string, identifiers: string[]) {
  const lookup = new Map(identifiers.map((identifier) => [identifier.toUpperCase(), identifier]));
  const found = new Map<string, 'closing' | 'reference' | 'ignored'>();
  const pattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/gi;
  for (const match of text.matchAll(pattern)) {
    const identifier = lookup.get(match[0]!.toUpperCase());
    if (!identifier) continue;
    const prefix = text.slice(Math.max(0, match.index! - 48), match.index!);
    found.set(identifier, githubLinkKindForPrefix(prefix));
  }
  return [...found].map(([identifier, linkKind]) => ({ identifier, linkKind }));
}

/** Exponential retry with bounded jitter avoids synchronized GitHub retry storms. */
export function githubRetryDelay(attempt: number, random = Math.random) {
  const capped = Math.min(60 * 60_000, 2 ** Math.max(0, attempt - 1) * 1_000);
  return Math.round(capped * (0.75 + random() * 0.5));
}

function githubLinkKindForPrefix(prefix: string): 'closing' | 'reference' | 'ignored' {
  const candidates: Array<{ kind: 'closing' | 'reference' | 'ignored'; index: number }> = [];
  for (const [kind, pattern] of [
    ['closing', /\b(close|closes|closed|closing|fix|fixes|fixed|fixing|resolve|resolves|resolved|resolving|complete|completes|completed|completing|implement|implements|implemented|implementing)\b/gi],
    ['reference', /\b(ref|refs|reference|references|part of|related to|relates to|contributes to|toward|towards)\b/gi],
    ['ignored', /\b(skip|ignore)\b/gi],
  ] as const) for (const match of prefix.matchAll(pattern)) candidates.push({ kind, index: match.index! });
  return candidates.sort((left, right) => right.index - left.index)[0]?.kind ?? 'closing';
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function publicBaseUrl() {
  const value = process.env.PUBLIC_BASE_URL ?? process.env.APP_ORIGIN;
  if (!value) throw new BadRequestException('PUBLIC_BASE_URL is required before GitHub can be configured.');
  if (!value.startsWith('https://') && process.env.NODE_ENV === 'production') throw new BadRequestException('PUBLIC_BASE_URL must use HTTPS in production.');
  return value.replace(/\/$/, '');
}

function encryptionKey() {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY is required before GitHub can be configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptIntegrationSecret(value: string) {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Malformed encrypted integration secret.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function verifyGitHubWebhookSignature(raw: Buffer, secret: string, signature: string) {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function appJwt(appId: number, privateKey: string) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (entry: unknown) => Buffer.from(JSON.stringify(entry)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 540, iss: appId })}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

@Injectable()
export class GitHubService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private lastMaintenanceAt = 0;

  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService) {}

  onModuleInit() {
    if (githubFeatureEnabled()) this.timer = setInterval(() => void this.processJobs(), 4_000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private ensureEnabled() { if (!githubFeatureEnabled()) throw new NotFoundExceptionLike(); }
  private async owner(workspaceId: string, user: AuthUser) { await this.workspaces.requireMembership(workspaceId, user, 'admin'); }

  private async connection(workspaceId: string) {
    const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.workspaceId, workspaceId)).limit(1);
    if (!connection) throw new BadRequestException('GitHub is not connected to this workspace.');
    return connection;
  }
  private credentials(connection: typeof githubConnections.$inferSelect) {
    if (!connection.encryptedCredentials) throw new BadRequestException('GitHub App credentials are not available.');
    return JSON.parse(decryptIntegrationSecret(connection.encryptedCredentials)) as GitHubCredentials;
  }

  async status(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    if (!githubFeatureEnabled()) return { enabled: false, status: 'disabled' };
    const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.workspaceId, workspaceId)).limit(1);
    if (!connection) return { enabled: true, status: 'disconnected' };
    const repositories = await this.database.db.select().from(githubRepositories).where(eq(githubRepositories.connectionId, connection.id)).orderBy(asc(githubRepositories.fullName));
    const mappings = await this.database.db.select().from(githubProjectRepositories).where(inArray(githubProjectRepositories.repositoryId, repositories.map((repository) => repository.id).length ? repositories.map((repository) => repository.id) : ['00000000-0000-0000-0000-000000000000']));
    return { enabled: true, connection: { ...connection, encryptedCredentials: undefined }, repositories, mappings };
  }

  async startManifest(workspaceId: string, user: AuthUser, body: unknown) {
    this.ensureEnabled(); await this.owner(workspaceId, user);
    const input = parseBody(stateInput, body); const state = await this.createState(workspaceId, user.id, 'manifest', { organizationLogin: input.organizationLogin });
    return { redirectUrl: `${publicBaseUrl()}/api/v1/github/manifest/redirect?state=${encodeURIComponent(state)}` };
  }

  async manifestRedirect(state: string, reply: FastifyReply) {
    this.ensureEnabled();
    const record = await this.readState(state, 'manifest', false);
    const organizationLogin = String(record.metadata.organizationLogin ?? '');
    if (!organizationLogin) throw new BadRequestException('GitHub manifest state is missing the organization.');
    const callback = `${publicBaseUrl()}/api/v1/github/manifest/callback`;
    const setup = `${publicBaseUrl()}/api/v1/github/manifest/setup?state=${encodeURIComponent(state)}`;
    const manifest = {
      name: `Anklav ${organizationLogin}`,
      url: publicBaseUrl(), description: 'Anklav GitHub integration', public: false,
      redirect_url: callback, callback_urls: [`${publicBaseUrl()}/api/v1/github/oauth/callback`], setup_url: setup,
      request_oauth_on_install: true,
      hook_attributes: { url: `${publicBaseUrl()}/api/v1/github/webhook`, active: true },
      default_permissions: { metadata: 'read', contents: 'read', members: 'read', checks: 'read', statuses: 'read', actions: 'read', deployments: 'read', issues: 'write', pull_requests: 'write' },
      default_events: ['installation', 'installation_repositories', 'push', 'issues', 'issue_comment', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread', 'check_run', 'check_suite', 'status', 'deployment_status', 'merge_group'],
    };
    const action = `https://github.com/organizations/${encodeURIComponent(organizationLogin)}/settings/apps/new`;
    reply.type('text/html').send(`<!doctype html><title>Connecting GitHub…</title><form id="github-manifest" method="post" action="${action}"><input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"></form><script>document.getElementById('github-manifest').submit()</script>`);
  }

  async completeManifest(code: string, state: string) {
    this.ensureEnabled(); const record = await this.readState(state, 'manifest', false);
    const response = await fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST', headers: githubHeaders() });
    if (!response.ok) throw new BadRequestException(`GitHub App registration failed (${response.status}).`);
    const converted = await response.json() as any;
    const credentials: GitHubCredentials = { appId: Number(converted.id), clientId: String(converted.client_id), clientSecret: String(converted.client_secret), privateKey: String(converted.pem), webhookSecret: String(converted.webhook_secret) };
    const workspaceId = record.workspaceId;
    await this.database.db.insert(githubConnections).values({ id: uuidv7(), workspaceId, organizationLogin: String(record.metadata.organizationLogin), appId: credentials.appId, clientId: credentials.clientId, encryptedCredentials: encryptIntegrationSecret(JSON.stringify(credentials)), status: 'app_created', createdByUserId: record.userId }).onConflictDoUpdate({ target: githubConnections.workspaceId, set: { organizationLogin: String(record.metadata.organizationLogin), appId: credentials.appId, clientId: credentials.clientId, encryptedCredentials: encryptIntegrationSecret(JSON.stringify(credentials)), status: 'app_created', lastError: null, updatedAt: new Date() } });
    return `${publicBaseUrl()}/w/${workspaceId}/settings?github=app-created`;
  }

  async completeSetup(state: string, installationId: string | undefined) {
    this.ensureEnabled(); const record = await this.readState(state, 'manifest', true);
    if (!installationId || !/^\d+$/.test(installationId)) throw new BadRequestException('GitHub did not provide an installation ID.');
    const connection = await this.connection(record.workspaceId);
    await this.database.db.update(githubConnections).set({ installationId: Number(installationId), status: 'installed', updatedAt: new Date(), lastError: null }).where(eq(githubConnections.id, connection.id));
    await this.enqueue(record.workspaceId, connection.id, 'refresh-repositories', {});
    return `${publicBaseUrl()}/w/${record.workspaceId}/settings?github=installed`;
  }

  async startUserOAuth(workspaceId: string, user: AuthUser) {
    this.ensureEnabled(); await this.workspaces.requireMembership(workspaceId, user);
    const connection = await this.connection(workspaceId); const credentials = this.credentials(connection);
    const state = await this.createState(workspaceId, user.id, 'user_oauth', {});
    const redirectUri = `${publicBaseUrl()}/api/v1/github/oauth/callback`;
    return { redirectUrl: `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(credentials.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}` };
  }

  async completeUserOAuth(code: string, state: string) {
    this.ensureEnabled(); const record = await this.readState(state, 'user_oauth', true); const connection = await this.connection(record.workspaceId); const credentials = this.credentials(connection);
    const redirectUri = `${publicBaseUrl()}/api/v1/github/oauth/callback`;
    const exchange = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, redirect_uri: redirectUri }) });
    if (!exchange.ok) throw new BadRequestException('GitHub authorization could not be completed.');
    const token = await exchange.json() as any; if (!token.access_token) throw new BadRequestException(token.error_description ?? 'GitHub did not issue an access token.');
    const profileResponse = await fetch(`${GITHUB_API}/user`, { headers: githubHeaders(token.access_token) });
    if (!profileResponse.ok) throw new BadRequestException('GitHub account details could not be loaded.');
    const profile = await profileResponse.json() as any;
    await this.database.db.insert(githubUserConnections).values({ id: uuidv7(), workspaceId: record.workspaceId, userId: record.userId!, githubUserId: Number(profile.id), login: String(profile.login), avatarUrl: String(profile.avatar_url ?? ''), encryptedToken: encryptIntegrationSecret(String(token.access_token)), tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1_000) : null, encryptedRefreshToken: token.refresh_token ? encryptIntegrationSecret(String(token.refresh_token)) : null, refreshTokenExpiresAt: token.refresh_token_expires_in ? new Date(Date.now() + Number(token.refresh_token_expires_in) * 1_000) : null }).onConflictDoUpdate({ target: [githubUserConnections.workspaceId, githubUserConnections.userId], set: { githubUserId: Number(profile.id), login: String(profile.login), avatarUrl: String(profile.avatar_url ?? ''), encryptedToken: encryptIntegrationSecret(String(token.access_token)), tokenExpiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1_000) : null, encryptedRefreshToken: token.refresh_token ? encryptIntegrationSecret(String(token.refresh_token)) : null, refreshTokenExpiresAt: token.refresh_token_expires_in ? new Date(Date.now() + Number(token.refresh_token_expires_in) * 1_000) : null, updatedAt: new Date() } });
    return `${publicBaseUrl()}/w/${record.workspaceId}/settings?github=account-connected`;
  }

  async mapRepository(workspaceId: string, user: AuthUser, body: unknown) {
    this.ensureEnabled(); await this.owner(workspaceId, user); const input = parseBody(mappingInput, body);
    const [repository] = await this.database.db.select({ id: githubRepositories.id, connectionId: githubRepositories.connectionId }).from(githubRepositories).where(eq(githubRepositories.id, input.repositoryId)).limit(1);
    const connection = await this.connection(workspaceId);
    if (!repository || repository.connectionId !== connection.id) throw new BadRequestException('Repository does not belong to this workspace GitHub connection.');
    const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, workspaceId))).limit(1);
    if (!project) throw new BadRequestException('Project does not belong to this workspace.');
    for (const stateId of [input.openStateId, input.closedStateId].filter((id): id is string => Boolean(id))) {
      const [state] = await this.database.db.select({ id: workflowStates.id }).from(workflowStates).where(and(eq(workflowStates.id, stateId), eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, 'task'), isNull(workflowStates.archivedAt))).limit(1);
      if (!state) throw new BadRequestException('Issue workflow states must be active task states in this workspace.');
    }
    if (input.defaultOutbound && input.syncMode !== 'bidirectional') throw new BadRequestException('A default outbound repository requires bidirectional issue sync.');
    if (input.defaultInbound) await this.database.db.update(githubProjectRepositories).set({ defaultInbound: false, updatedAt: new Date() }).where(eq(githubProjectRepositories.repositoryId, input.repositoryId));
    if (input.defaultOutbound) await this.database.db.update(githubProjectRepositories).set({ defaultOutbound: false, updatedAt: new Date() }).where(eq(githubProjectRepositories.projectId, input.projectId));
    const [mapping] = await this.database.db.insert(githubProjectRepositories).values({ id: uuidv7(), ...input, openStateId: input.openStateId ?? null, closedStateId: input.closedStateId ?? null }).onConflictDoUpdate({ target: [githubProjectRepositories.repositoryId, githubProjectRepositories.projectId], set: { syncMode: input.syncMode, defaultInbound: input.defaultInbound, defaultOutbound: input.defaultOutbound, openStateId: input.openStateId ?? null, closedStateId: input.closedStateId ?? null, updatedAt: new Date() } }).returning();
    return mapping;
  }

  async branch(workspaceId: string, user: AuthUser, taskRef: string) {
    await this.workspaces.requireMembership(workspaceId, user); const task = await this.taskForRef(workspaceId, taskRef); const connection = await this.connectionOrNull(workspaceId);
    return { identifier: task.identifier, branch: taskBranchName(task.identifier, task.title, connection?.branchTemplate ?? '{identifier}-{slug}') };
  }

  /**
   * Server-side, installation-authenticated file retrieval for knowledge artifact
   * verification. Callers supply an immutable commit SHA; they never supply proof.
   */
  async fetchRepositoryFile(workspaceId: string, user: AuthUser, input: { githubRepositoryId?: string | null; repositoryFullName: string; path: string; commitSha: string }) {
    this.ensureEnabled();
    await this.workspaces.requireMembership(workspaceId, user);
    if (!/^[^/\s]+\/[^/\s]+$/.test(input.repositoryFullName) || !input.commitSha.trim() || input.path.startsWith('/') || input.path.split('/').includes('..')) throw new BadRequestException('Repository artifact reference is invalid.');
    const connection = await this.connection(workspaceId);
    const [repository] = await this.database.db.select().from(githubRepositories).where(and(
      eq(githubRepositories.connectionId, connection.id),
      input.githubRepositoryId ? eq(githubRepositories.id, input.githubRepositoryId) : eq(githubRepositories.fullName, input.repositoryFullName),
    )).limit(1);
    if (!repository || repository.fullName !== input.repositoryFullName || !repository.installed) throw new BadRequestException('Repository is not installed for this workspace GitHub App connection.');
    const encodedPath = input.path.split('/').map(encodeURIComponent).join('/');
    const response = await this.githubFetch(connection, `/repos/${repository.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(input.commitSha)}`);
    if (response.status === 404) return { found: false as const, repositoryId: repository.id, message: 'The requested path does not exist at the specified commit.' };
    if (!response.ok) throw new BadRequestException(`GitHub file verification request failed (${response.status}).`);
    const payload = await response.json() as { type?: string; encoding?: string; content?: string; sha?: string; path?: string };
    if (payload.type !== 'file' || payload.encoding !== 'base64' || typeof payload.content !== 'string') throw new BadRequestException('The requested repository reference is not a file.');
    return { found: true as const, repositoryId: repository.id, path: payload.path ?? input.path, blobSha: payload.sha ?? null, content: Buffer.from(payload.content.replace(/\s/g, ''), 'base64') };
  }

  async createIssue(workspaceId: string, user: AuthUser, taskRef: string, body: unknown) {
    this.ensureEnabled(); await this.workspaces.requireMembership(workspaceId, user); const input = parseBody(issueInput, body); const task = await this.taskForRef(workspaceId, taskRef);
    const [repository] = await this.database.db.select().from(githubRepositories).where(eq(githubRepositories.id, input.repositoryId)).limit(1); if (!repository) throw new BadRequestException('Repository not found.');
    const connection = await this.connection(workspaceId); if (repository.connectionId !== connection.id) throw new BadRequestException('Repository does not belong to this workspace.');
    const issue = await this.githubRequest(connection, `/repos/${repository.fullName}/issues`, { method: 'POST', body: { title: `${task.identifier} ${task.title}`, body: task.description } }) as any;
    const [link] = await this.database.db.insert(githubIssueLinks).values({ id: uuidv7(), taskId: task.id, repositoryId: repository.id, githubIssueId: Number(issue.id), nodeId: String(issue.node_id), issueNumber: Number(issue.number), htmlUrl: String(issue.html_url), syncMode: input.syncMode, syncStatus: 'synced', lastSyncedSnapshot: this.snapshotTask(task) }).onConflictDoUpdate({ target: [githubIssueLinks.taskId, githubIssueLinks.repositoryId], set: { githubIssueId: Number(issue.id), nodeId: String(issue.node_id), issueNumber: Number(issue.number), htmlUrl: String(issue.html_url), syncMode: input.syncMode, syncStatus: 'synced', lastSyncedSnapshot: this.snapshotTask(task), lastError: null, updatedAt: new Date() } }).returning();
    return link;
  }

  async linkPullRequest(workspaceId: string, user: AuthUser, taskRef: string, pullRequestId: string, linkKind = 'closing') {
    this.ensureEnabled(); await this.workspaces.requireMembership(workspaceId, user); const task = await this.taskForRef(workspaceId, taskRef);
    const [pullRequest] = await this.database.db.select({ id: githubPullRequests.id, repositoryId: githubPullRequests.repositoryId }).from(githubPullRequests).where(eq(githubPullRequests.id, pullRequestId)).limit(1); if (!pullRequest) throw new BadRequestException('Pull request not found.');
    const connection = await this.connection(workspaceId); const [repository] = await this.database.db.select({ connectionId: githubRepositories.connectionId }).from(githubRepositories).where(eq(githubRepositories.id, pullRequest.repositoryId)).limit(1); if (!repository || repository.connectionId !== connection.id) throw new BadRequestException('Pull request does not belong to this workspace.');
    await this.database.db.insert(githubTaskPullRequests).values({ id: uuidv7(), taskId: task.id, pullRequestId, linkKind, source: 'manual' }).onConflictDoUpdate({ target: [githubTaskPullRequests.taskId, githubTaskPullRequests.pullRequestId], set: { linkKind, ignored: false } });
    return { ok: true };
  }

  async listReviews(workspaceId: string, user: AuthUser, mode: 'for-me' | 'created' = 'for-me') {
    await this.workspaces.requireMembership(workspaceId, user); const connection = await this.connection(workspaceId);
    const repositories = await this.database.db.select({ id: githubRepositories.id, fullName: githubRepositories.fullName }).from(githubRepositories).where(eq(githubRepositories.connectionId, connection.id));
    const pullRequests = await this.database.db.select().from(githubPullRequests).where(inArray(githubPullRequests.repositoryId, repositories.map((item) => item.id).length ? repositories.map((item) => item.id) : ['00000000-0000-0000-0000-000000000000'])).orderBy(asc(githubPullRequests.updatedAt));
    const account = await this.database.db.select().from(githubUserConnections).where(and(eq(githubUserConnections.workspaceId, workspaceId), eq(githubUserConnections.userId, user.id))).limit(1);
    const items = mode === 'created' && account[0] ? pullRequests.filter((pullRequest) => pullRequest.authorGithubUserId === account[0]!.githubUserId) : pullRequests;
    return items.map((pullRequest) => ({ ...pullRequest, repository: repositories.find((repository) => repository.id === pullRequest.repositoryId) }));
  }

  async reviewDetail(workspaceId: string, user: AuthUser, pullRequestId: string) {
    await this.workspaces.requireMembership(workspaceId, user); const [pullRequest] = await this.database.db.select().from(githubPullRequests).where(eq(githubPullRequests.id, pullRequestId)).limit(1); if (!pullRequest) throw new BadRequestException('Pull request not found.');
    const [repository] = await this.database.db.select().from(githubRepositories).where(eq(githubRepositories.id, pullRequest.repositoryId)).limit(1); const connection = await this.connection(workspaceId); if (!repository || repository.connectionId !== connection.id) throw new BadRequestException('Pull request not found.');
    const links = await this.database.db.select({ link: githubTaskPullRequests, task: tasks }).from(githubTaskPullRequests).innerJoin(tasks, eq(githubTaskPullRequests.taskId, tasks.id)).where(eq(githubTaskPullRequests.pullRequestId, pullRequestId));
    return { ...pullRequest, repository, tasks: links };
  }

  async diff(workspaceId: string, user: AuthUser, pullRequestId: string) {
    await this.workspaces.requireMembership(workspaceId, user); const detail = await this.reviewDetail(workspaceId, user, pullRequestId) as any; const connection = await this.connection(workspaceId);
    const response = await this.githubFetch(connection, `/repos/${detail.repository.fullName}/pulls/${detail.number}`, { headers: { Accept: 'application/vnd.github.v3.diff' } });
    if (!response.ok) throw new BadRequestException(`GitHub diff could not be loaded (${response.status}).`);
    return { diff: await response.text(), headSha: detail.headSha };
  }

  async submitReview(workspaceId: string, user: AuthUser, pullRequestId: string, body: unknown) {
    this.ensureEnabled(); const input = parseBody(reviewInput, body); const detail = await this.reviewDetail(workspaceId, user, pullRequestId) as any; const token = await this.userToken(workspaceId, user.id);
    return this.githubUserRequest(token, `/repos/${detail.repository.fullName}/pulls/${detail.number}/reviews`, { method: 'POST', body: { event: input.event, body: input.body || undefined, comments: input.comments } });
  }

  async merge(workspaceId: string, user: AuthUser, pullRequestId: string, body: unknown) {
    this.ensureEnabled(); const input = parseBody(mergeInput, body); const detail = await this.reviewDetail(workspaceId, user, pullRequestId) as any; const token = await this.userToken(workspaceId, user.id);
    return this.githubUserRequest(token, `/repos/${detail.repository.fullName}/pulls/${detail.number}/merge`, { method: 'PUT', body: { merge_method: input.method, commit_title: input.commitTitle, commit_message: input.commitMessage } });
  }

  async commentOnPullRequest(workspaceId: string, user: AuthUser, pullRequestId: string, body: unknown) {
    this.ensureEnabled(); const input = parseBody(pullRequestCommentInput, body); const detail = await this.reviewDetail(workspaceId, user, pullRequestId) as any; const token = await this.userToken(workspaceId, user.id);
    if (input.path || input.line || input.side) {
      if (!input.path || !input.line || !input.side) throw new BadRequestException('Inline comments require a file path, line, and side.');
      return this.githubUserRequest(token, `/repos/${detail.repository.fullName}/pulls/${detail.number}/comments`, { method: 'POST', body: input });
    }
    return this.githubUserRequest(token, `/repos/${detail.repository.fullName}/issues/${detail.number}/comments`, { method: 'POST', body: { body: input.body } });
  }

  async markPullRequestReady(workspaceId: string, user: AuthUser, pullRequestId: string) {
    this.ensureEnabled(); const detail = await this.reviewDetail(workspaceId, user, pullRequestId) as any; const token = await this.userToken(workspaceId, user.id);
    return this.githubUserRequest(token, `/repos/${detail.repository.fullName}/pulls/${detail.number}`, { method: 'PATCH', body: { draft: false } });
  }

  async listNotifications(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user); return this.database.db.select().from(notifications).where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, user.id))).orderBy(asc(notifications.createdAt)).limit(100);
  }
  async markNotificationRead(workspaceId: string, user: AuthUser, notificationId: string) {
    await this.workspaces.requireMembership(workspaceId, user); await this.database.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.workspaceId, workspaceId), eq(notifications.userId, user.id))); return { ok: true };
  }

  async notificationCount(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [result] = await this.database.db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { unread: result?.count ?? 0 };
  }

  async health(workspaceId: string, user: AuthUser) {
    await this.owner(workspaceId, user);
    const connection = await this.connectionOrNull(workspaceId);
    const jobs = await this.database.db.select({ status: integrationJobs.status, count: sql<number>`count(*)::int` }).from(integrationJobs).where(eq(integrationJobs.workspaceId, workspaceId)).groupBy(integrationJobs.status);
    return { connection: connection ? { status: connection.status, lastWebhookAt: connection.lastWebhookAt, lastReconciledAt: connection.lastReconciledAt, lastError: connection.lastError } : null, jobs: Object.fromEntries(jobs.map((job) => [job.status, job.count])) };
  }

  async retryJob(workspaceId: string, user: AuthUser, jobId: string) {
    await this.owner(workspaceId, user);
    const [job] = await this.database.db.update(integrationJobs).set({ status: 'queued', runAfter: new Date(), lockedAt: null, lastError: null, updatedAt: new Date() }).where(and(eq(integrationJobs.id, jobId), eq(integrationJobs.workspaceId, workspaceId))).returning();
    if (!job) throw new BadRequestException('Integration job not found.');
    return job;
  }

  async disconnect(workspaceId: string, user: AuthUser) {
    await this.owner(workspaceId, user);
    const [connection] = await this.database.db.update(githubConnections).set({ status: 'disconnected', installationId: null, encryptedCredentials: null, lastError: null, updatedAt: new Date() }).where(eq(githubConnections.workspaceId, workspaceId)).returning();
    if (!connection) throw new BadRequestException('GitHub is not connected to this workspace.');
    await this.database.db.delete(githubUserConnections).where(eq(githubUserConnections.workspaceId, workspaceId));
    return { ok: true };
  }

  async webhook(request: FastifyRequest, reply: FastifyReply) {
    this.ensureEnabled(); const deliveryId = String(request.headers['x-github-delivery'] ?? ''); const event = String(request.headers['x-github-event'] ?? ''); const signature = String(request.headers['x-hub-signature-256'] ?? '');
    if (!deliveryId || !event || !signature) throw new UnauthorizedException('GitHub webhook headers are required.');
    const raw = (request as any).rawBody as Buffer | undefined; if (!raw) throw new UnauthorizedException('GitHub webhook raw body is unavailable.');
    const payload = request.body as GitHubPayload; const installationId = Number(payload.installation?.id ?? 0);
    const [connection] = installationId ? await this.database.db.select().from(githubConnections).where(eq(githubConnections.installationId, installationId)).limit(1) : [];
    if (!connection) throw new UnauthorizedException('Unknown GitHub installation.');
    if (!verifyGitHubWebhookSignature(raw, this.credentials(connection).webhookSecret, signature)) throw new UnauthorizedException('Invalid GitHub webhook signature.');
    await this.database.db.insert(githubWebhookDeliveries).values({ id: uuidv7(), connectionId: connection.id, deliveryId, event, payload }).onConflictDoNothing();
    await this.database.db.update(githubConnections).set({ lastWebhookAt: new Date(), updatedAt: new Date() }).where(eq(githubConnections.id, connection.id));
    await this.enqueue(connection.workspaceId, connection.id, 'process-webhook', { deliveryId });
    reply.code(202).send({ accepted: true });
  }

  private async createState(workspaceId: string, userId: string | null, purpose: string, metadata: Record<string, unknown>) {
    const state = randomBytes(32).toString('base64url');
    await this.database.db.insert(githubOauthStates).values({ id: uuidv7(), workspaceId, userId, purpose, stateHash: hash(state), metadata, expiresAt: new Date(Date.now() + 10 * 60 * 1_000) });
    return state;
  }
  private async readState(state: string, purpose: string, consume: boolean) {
    const [record] = await this.database.db.select().from(githubOauthStates).where(and(eq(githubOauthStates.stateHash, hash(state)), eq(githubOauthStates.purpose, purpose), isNull(githubOauthStates.usedAt), gte(githubOauthStates.expiresAt, new Date()))).limit(1);
    if (!record) throw new BadRequestException('GitHub authorization state is invalid or expired.');
    if (consume) await this.database.db.update(githubOauthStates).set({ usedAt: new Date() }).where(eq(githubOauthStates.id, record.id));
    return record;
  }
  private async connectionOrNull(workspaceId: string) { const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.workspaceId, workspaceId)).limit(1); return connection ?? null; }
  private async taskForRef(workspaceId: string, ref: string) {
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), or(eq(tasks.identifier, ref), sql`${tasks.id}::text = ${ref}`), isNull(tasks.deletedAt))).limit(1);
    if (task) return task;
    const [aliased] = await this.database.db.select({ task: tasks }).from(taskIdentifierAliases).innerJoin(tasks, eq(taskIdentifierAliases.taskId, tasks.id))
      .where(and(eq(taskIdentifierAliases.workspaceId, workspaceId), eq(taskIdentifierAliases.identifier, ref), isNull(tasks.deletedAt))).limit(1);
    if (!aliased) throw new BadRequestException('Task not found.'); return aliased.task;
  }
  private snapshotTask(task: typeof tasks.$inferSelect) { return { title: task.title, description: task.description, workflowStateId: task.workflowStateId, assigneeMembershipId: task.assigneeMembershipId, identifier: task.identifier }; }
  private async enqueue(workspaceId: string, connectionId: string | null, type: string, payload: Record<string, unknown>) { await this.database.db.insert(integrationJobs).values({ id: uuidv7(), workspaceId, connectionId, type, payload }); }

  /** Queue eventual GitHub Issue synchronization without holding up a local task mutation. */
  async queueTaskSync(workspaceId: string, taskId: string, reason: 'created' | 'updated') {
    if (!githubFeatureEnabled()) return;
    const [connection] = await this.database.db.select().from(githubConnections).where(and(eq(githubConnections.workspaceId, workspaceId), eq(githubConnections.status, 'installed'))).limit(1);
    if (!connection) return;
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt))).limit(1);
    if (!task) return;
    const existing = await this.database.db.select({ id: githubIssueLinks.id }).from(githubIssueLinks).where(and(eq(githubIssueLinks.taskId, task.id), eq(githubIssueLinks.syncMode, 'bidirectional')));
    if (existing.length) {
      await Promise.all(existing.map((link) => this.enqueue(workspaceId, connection.id, 'sync-outbound-issue', { taskId: task.id, issueLinkId: link.id, reason })));
      return;
    }
    const [mapping] = await this.database.db.select().from(githubProjectRepositories).where(and(eq(githubProjectRepositories.projectId, task.projectId), eq(githubProjectRepositories.defaultOutbound, true), eq(githubProjectRepositories.syncMode, 'bidirectional'))).limit(1);
    if (mapping) await this.enqueue(workspaceId, connection.id, 'create-outbound-issue', { taskId: task.id, repositoryId: mapping.repositoryId, syncMode: mapping.syncMode, reason });
  }
  private async installationToken(connection: typeof githubConnections.$inferSelect) {
    if (!connection.installationId) throw new BadRequestException('GitHub App is not installed.'); const credentials = this.credentials(connection);
    const response = await fetch(`${GITHUB_API}/app/installations/${connection.installationId}/access_tokens`, { method: 'POST', headers: githubHeaders(appJwt(credentials.appId, credentials.privateKey)) });
    if (!response.ok) throw new BadRequestException(`GitHub installation token request failed (${response.status}).`); return String((await response.json() as any).token);
  }
  private async githubFetch(connection: typeof githubConnections.$inferSelect, path: string, init: RequestInit = {}) {
    const token = await this.installationToken(connection); return fetch(`${GITHUB_API}${path}`, { ...init, headers: { ...githubHeaders(token), ...(init.headers ?? {}) } });
  }
  private async githubRequest(connection: typeof githubConnections.$inferSelect, path: string, init: { method: string; body?: unknown }) {
    const response = await this.githubFetch(connection, path, { method: init.method, headers: { 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    if (!response.ok) throw new BadRequestException(`GitHub request failed (${response.status}).`); return response.json();
  }
  private async userToken(workspaceId: string, userId: string) {
    const [account] = await this.database.db.select().from(githubUserConnections).where(and(eq(githubUserConnections.workspaceId, workspaceId), eq(githubUserConnections.userId, userId))).limit(1); if (!account) throw new BadRequestException('Connect your personal GitHub account before performing review actions.'); return decryptIntegrationSecret(account.encryptedToken);
  }
  private async githubUserRequest(token: string, path: string, init: { method: string; body?: unknown }) {
    const response = await fetch(`${GITHUB_API}${path}`, { method: init.method, headers: { ...githubHeaders(token), 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new BadRequestException(result.message ?? `GitHub request failed (${response.status}).`); return result;
  }
  private async processJobs() {
    await this.scheduleMaintenance();
    await this.database.db.update(integrationJobs).set({ status: 'queued', lockedAt: null, runAfter: new Date(), updatedAt: new Date() })
      .where(and(eq(integrationJobs.status, 'running'), lte(integrationJobs.lockedAt, new Date(Date.now() - 10 * 60_000))));
    const result = await this.database.db.execute(sql`
      WITH claimable AS (
        SELECT id FROM integration_jobs
        WHERE status = 'queued' AND run_after <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 10
      )
      UPDATE integration_jobs
      SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id IN (SELECT id FROM claimable)
      RETURNING *
    `);
    const claimedJobs = (result as any).rows as Array<typeof integrationJobs.$inferSelect>;
    for (const claimed of claimedJobs) {
      try { await this.processJob(claimed); await this.database.db.update(integrationJobs).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(integrationJobs.id, claimed.id)); }
      catch (error) { const terminal = claimed.attempts >= 8; await this.database.db.update(integrationJobs).set({ status: terminal ? 'dead' : 'queued', lockedAt: null, runAfter: new Date(Date.now() + githubRetryDelay(claimed.attempts)), lastError: error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown integration job failure', updatedAt: new Date() }).where(eq(integrationJobs.id, claimed.id)); }
    }
  }

  private async scheduleMaintenance() {
    const now = Date.now();
    if (now - this.lastMaintenanceAt < 60_000) return;
    this.lastMaintenanceAt = now;
    await this.database.db.delete(githubWebhookDeliveries).where(lte(githubWebhookDeliveries.receivedAt, new Date(now - 30 * 24 * 60 * 60_000)));
    await this.database.db.delete(githubOauthStates).where(lte(githubOauthStates.expiresAt, new Date(now - 24 * 60 * 60_000)));
    const connections = await this.database.db.select().from(githubConnections).where(eq(githubConnections.status, 'installed'));
    for (const connection of connections) {
      if (connection.lastReconciledAt && now - connection.lastReconciledAt.getTime() < 15 * 60_000) continue;
      const [queued] = await this.database.db.select({ id: integrationJobs.id }).from(integrationJobs).where(and(eq(integrationJobs.connectionId, connection.id), eq(integrationJobs.type, 'reconcile'), inArray(integrationJobs.status, ['queued', 'running']))).limit(1);
      if (!queued) await this.enqueue(connection.workspaceId, connection.id, 'reconcile', {});
    }
  }
  private async processJob(job: typeof integrationJobs.$inferSelect) {
    if (!job.connectionId) return;
    const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.id, job.connectionId)).limit(1); if (!connection) return;
    if (job.type === 'refresh-repositories') return this.refreshRepositories(connection);
    if (job.type === 'reconcile') return this.reconcile(connection);
    if (job.type === 'create-outbound-issue') return this.createOutboundIssue(connection, String((job.payload as any).taskId), String((job.payload as any).repositoryId));
    if (job.type === 'sync-outbound-issue') return this.syncOutboundIssue(connection, String((job.payload as any).issueLinkId));
    if (job.type === 'process-webhook') { const deliveryId = String((job.payload as any).deliveryId); const [delivery] = await this.database.db.select().from(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, deliveryId)).limit(1); if (delivery && !delivery.processedAt) { await this.processWebhook(connection, delivery.event, delivery.payload); await this.database.db.update(githubWebhookDeliveries).set({ processedAt: new Date() }).where(eq(githubWebhookDeliveries.id, delivery.id)); } }
  }

  private async taskIssuePayload(task: typeof tasks.$inferSelect) {
    const [state] = await this.database.db.select({ taskSemantic: workflowStates.taskSemantic }).from(workflowStates).where(eq(workflowStates.id, task.workflowStateId)).limit(1);
    return {
      title: `${task.identifier} ${task.title}`,
      body: task.description,
      state: state?.taskSemantic === 'done' ? 'closed' : 'open',
    };
  }

  private async createOutboundIssue(connection: typeof githubConnections.$inferSelect, taskId: string, repositoryId: string) {
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, connection.workspaceId), isNull(tasks.deletedAt))).limit(1);
    if (!task) return;
    const [existing] = await this.database.db.select({ id: githubIssueLinks.id }).from(githubIssueLinks).where(and(eq(githubIssueLinks.taskId, task.id), eq(githubIssueLinks.repositoryId, repositoryId))).limit(1);
    if (existing) return;
    const [repository] = await this.database.db.select().from(githubRepositories).where(and(eq(githubRepositories.id, repositoryId), eq(githubRepositories.connectionId, connection.id), eq(githubRepositories.installed, true))).limit(1);
    if (!repository) throw new BadRequestException('The default outbound GitHub repository is no longer installed.');
    const payload = await this.taskIssuePayload(task);
    const issue = await this.githubRequest(connection, `/repos/${repository.fullName}/issues`, { method: 'POST', body: { title: payload.title, body: payload.body } }) as any;
    const [link] = await this.database.db.insert(githubIssueLinks).values({
      id: uuidv7(), taskId: task.id, repositoryId: repository.id, githubIssueId: Number(issue.id), nodeId: String(issue.node_id), issueNumber: Number(issue.number), htmlUrl: String(issue.html_url), syncMode: 'bidirectional', syncStatus: 'synced', lastSyncedSnapshot: this.snapshotTask(task),
    }).onConflictDoNothing().returning();
    if (!link) return;
    if (payload.state === 'closed') await this.syncOutboundIssue(connection, link.id);
  }

  private async syncOutboundIssue(connection: typeof githubConnections.$inferSelect, issueLinkId: string) {
    const [link] = await this.database.db.select().from(githubIssueLinks).where(and(eq(githubIssueLinks.id, issueLinkId), eq(githubIssueLinks.syncMode, 'bidirectional'))).limit(1);
    if (!link) return;
    try {
      const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, link.taskId), eq(tasks.workspaceId, connection.workspaceId), isNull(tasks.deletedAt))).limit(1);
      const [repository] = await this.database.db.select().from(githubRepositories).where(and(eq(githubRepositories.id, link.repositoryId), eq(githubRepositories.connectionId, connection.id), eq(githubRepositories.installed, true))).limit(1);
      if (!task || !repository) throw new BadRequestException('The linked task or repository is unavailable.');
      const payload = await this.taskIssuePayload(task);
      await this.githubRequest(connection, `/repos/${repository.fullName}/issues/${link.issueNumber}`, { method: 'PATCH', body: payload });
      await this.database.db.update(githubIssueLinks).set({ syncStatus: 'synced', lastSyncedSnapshot: this.snapshotTask(task), lastError: null, updatedAt: new Date() }).where(eq(githubIssueLinks.id, link.id));
    } catch (error) {
      await this.database.db.update(githubIssueLinks).set({ syncStatus: 'error', lastError: error instanceof Error ? error.message.slice(0, 2_000) : 'GitHub Issue sync failed.', updatedAt: new Date() }).where(eq(githubIssueLinks.id, link.id));
      throw error;
    }
  }
  private async refreshRepositories(connection: typeof githubConnections.$inferSelect) {
    const existing = await this.database.db.select({ id: githubRepositories.id, githubRepositoryId: githubRepositories.githubRepositoryId }).from(githubRepositories).where(eq(githubRepositories.connectionId, connection.id));
    const seen = new Set<number>();
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.githubRequest(connection, `/installation/repositories?per_page=100&page=${page}`, { method: 'GET' }) as any;
      const repositories = result.repositories ?? [];
      for (const repository of repositories) {
        seen.add(Number(repository.id));
        await this.database.db.insert(githubRepositories).values({ id: uuidv7(), connectionId: connection.id, githubRepositoryId: Number(repository.id), nodeId: String(repository.node_id), ownerLogin: String(repository.owner?.login ?? connection.organizationLogin ?? ''), name: String(repository.name), fullName: String(repository.full_name), htmlUrl: String(repository.html_url), defaultBranch: String(repository.default_branch ?? 'main'), private: Boolean(repository.private), installed: true }).onConflictDoUpdate({ target: [githubRepositories.connectionId, githubRepositories.githubRepositoryId], set: { nodeId: String(repository.node_id), ownerLogin: String(repository.owner?.login ?? connection.organizationLogin ?? ''), name: String(repository.name), fullName: String(repository.full_name), htmlUrl: String(repository.html_url), defaultBranch: String(repository.default_branch ?? 'main'), private: Boolean(repository.private), installed: true, updatedAt: new Date() } });
      }
      if (repositories.length < 100) break;
    }
    for (const repository of existing) if (!seen.has(repository.githubRepositoryId)) await this.database.db.update(githubRepositories).set({ installed: false, updatedAt: new Date() }).where(eq(githubRepositories.id, repository.id));
  }

  private async reconcile(connection: typeof githubConnections.$inferSelect) {
    await this.refreshRepositories(connection);
    const repositories = await this.database.db.select().from(githubRepositories).where(and(eq(githubRepositories.connectionId, connection.id), eq(githubRepositories.installed, true)));
    for (const repository of repositories) {
      for (let page = 1; page <= 100; page += 1) {
        const pullRequests = await this.githubRequest(connection, `/repos/${repository.fullName}/pulls?state=open&per_page=100&page=${page}`, { method: 'GET' }) as GitHubPayload[];
        for (const pullRequest of pullRequests) await this.upsertPullRequest(connection, repository, pullRequest);
        if (pullRequests.length < 100) break;
      }
    }
    await this.database.db.update(githubConnections).set({ lastReconciledAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(githubConnections.id, connection.id));
  }
  private async processWebhook(connection: typeof githubConnections.$inferSelect, event: string, payload: GitHubPayload) {
    if (event === 'installation_repositories' || event === 'installation') { await this.refreshRepositories(connection); return; }
    const repositoryPayload = payload.repository; if (!repositoryPayload) return;
    const [repository] = await this.database.db.select().from(githubRepositories).where(and(eq(githubRepositories.connectionId, connection.id), eq(githubRepositories.githubRepositoryId, Number(repositoryPayload.id)))).limit(1); if (!repository) return;
    if ((event === 'pull_request' || event === 'pull_request_review') && payload.pull_request) {
      const pullRequest = await this.upsertPullRequest(connection, repository, { ...payload.pull_request, number: payload.number }, event === 'pull_request_review' || payload.action === 'review_requested');
      if (payload.action === 'review_requested' && payload.requested_reviewer?.id) await this.notifyReviewRequest(connection, Number(payload.requested_reviewer.id), pullRequest);
    }
    if (event === 'issues' && payload.issue && !payload.issue.pull_request) await this.syncIncomingIssue(connection, repository, payload.action, payload.issue);
  }

  private async allocateTaskIdentity(tx: any, workspaceId: string, projectId: string) {
    const [project] = await tx.select({ issueKey: projects.issueKey }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
    if (!project) throw new BadRequestException('Inbound GitHub issue project no longer exists.');
    await tx.insert(projectTaskCounters).values({ projectId, nextNumber: 1 }).onConflictDoNothing();
    const [counter] = await tx.update(projectTaskCounters).set({ nextNumber: sql`${projectTaskCounters.nextNumber} + 1`, updatedAt: new Date() }).where(eq(projectTaskCounters.projectId, projectId)).returning();
    return { taskNumber: counter!.nextNumber - 1, identifier: `${project.issueKey}-${counter!.nextNumber - 1}` };
  }

  private async syncIncomingIssue(connection: typeof githubConnections.$inferSelect, repository: typeof githubRepositories.$inferSelect, action: string, issue: GitHubPayload) {
    const [mapping] = await this.database.db.select().from(githubProjectRepositories).where(and(eq(githubProjectRepositories.repositoryId, repository.id), eq(githubProjectRepositories.defaultInbound, true), inArray(githubProjectRepositories.syncMode, ['inbound', 'bidirectional']))).limit(1);
    if (!mapping) return;
    const [existing] = await this.database.db.select().from(githubIssueLinks).where(and(eq(githubIssueLinks.repositoryId, repository.id), eq(githubIssueLinks.githubIssueId, Number(issue.id)))).limit(1);
    const desiredStateId = action === 'closed' ? mapping.closedStateId : action === 'reopened' || action === 'opened' ? mapping.openStateId : null;
    if (existing) {
      const set: Record<string, unknown> = { title: String(issue.title), description: String(issue.body ?? ''), updatedAt: new Date(), version: sql`${tasks.version} + 1` };
      if (desiredStateId) set.workflowStateId = desiredStateId;
      await this.database.db.update(tasks).set(set as any).where(eq(tasks.id, existing.taskId));
      await this.database.db.update(githubIssueLinks).set({ syncStatus: 'synced', lastSyncedSnapshot: { title: String(issue.title), description: String(issue.body ?? ''), state: String(issue.state) }, lastError: null, updatedAt: new Date() }).where(eq(githubIssueLinks.id, existing.id));
      return;
    }
    if (!['opened', 'reopened'].includes(action)) return;
    const [defaultState] = await this.database.db.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, connection.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.isInitial, true), isNull(workflowStates.archivedAt))).limit(1);
    const workflowStateId = mapping.openStateId ?? defaultState?.id;
    if (!workflowStateId) throw new BadRequestException('Workspace does not have an initial task state for GitHub Issues sync.');
    await this.database.db.transaction(async (tx) => {
      const identity = await this.allocateTaskIdentity(tx, connection.workspaceId, mapping.projectId);
      const [task] = await tx.insert(tasks).values({ workspaceId: connection.workspaceId, projectId: mapping.projectId, title: String(issue.title), description: String(issue.body ?? ''), workflowStateId, priority: 'none', ...identity }).returning();
      await tx.insert(githubIssueLinks).values({ id: uuidv7(), taskId: task!.id, repositoryId: repository.id, githubIssueId: Number(issue.id), nodeId: String(issue.node_id), issueNumber: Number(issue.number), htmlUrl: String(issue.html_url), syncMode: mapping.syncMode, syncStatus: 'synced', lastSyncedSnapshot: { title: String(issue.title), description: String(issue.body ?? ''), state: String(issue.state) } });
    });
  }
  private async notifyReviewRequest(connection: typeof githubConnections.$inferSelect, githubUserId: number, pullRequest: typeof githubPullRequests.$inferSelect | undefined) {
    if (!pullRequest) return;
    const [recipient] = await this.database.db.select().from(githubUserConnections).where(and(eq(githubUserConnections.workspaceId, connection.workspaceId), eq(githubUserConnections.githubUserId, githubUserId))).limit(1);
    if (!recipient) return;
    await this.database.db.insert(notifications).values({ id: uuidv7(), workspaceId: connection.workspaceId, userId: recipient.userId, type: 'github_review_request', title: `Review requested: #${pullRequest.number} ${pullRequest.title}`, body: pullRequest.authorLogin, href: `/w/${connection.workspaceId}/reviews/${pullRequest.id}`, metadata: { pullRequestId: pullRequest.id } });
  }

  private async applyDefaultPullRequestAutomation(connection: typeof githubConnections.$inferSelect, pullRequest: typeof githubPullRequests.$inferSelect, reviewActivity: boolean) {
    const links = await this.database.db.select({ task: tasks }).from(githubTaskPullRequests).innerJoin(tasks, eq(githubTaskPullRequests.taskId, tasks.id))
      .where(and(eq(githubTaskPullRequests.pullRequestId, pullRequest.id), eq(githubTaskPullRequests.linkKind, 'closing'), eq(githubTaskPullRequests.ignored, false), isNull(tasks.deletedAt)));
    for (const { task } of links) {
      const closingPullRequests = await this.database.db.select({ state: githubPullRequests.state }).from(githubTaskPullRequests).innerJoin(githubPullRequests, eq(githubTaskPullRequests.pullRequestId, githubPullRequests.id))
        .where(and(eq(githubTaskPullRequests.taskId, task.id), eq(githubTaskPullRequests.linkKind, 'closing'), eq(githubTaskPullRequests.ignored, false)));
      const [current] = await this.database.db.select({ taskSemantic: workflowStates.taskSemantic }).from(workflowStates).where(eq(workflowStates.id, task.workflowStateId)).limit(1);
      const semantic = closingPullRequests.length && closingPullRequests.every((entry) => entry.state === 'merged')
        ? 'done'
        : reviewActivity
          ? 'human_review'
          : closingPullRequests.some((entry) => entry.state === 'open') && current?.taskSemantic !== 'human_review'
            ? 'in_progress'
            : null;
      if (!semantic) continue;
      const [target] = await this.database.db.select({ id: workflowStates.id }).from(workflowStates).where(and(eq(workflowStates.workspaceId, connection.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.taskSemantic, semantic), isNull(workflowStates.archivedAt))).orderBy(asc(workflowStates.position)).limit(1);
      if (target && target.id !== task.workflowStateId) await this.database.db.update(tasks).set({ workflowStateId: target.id, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(eq(tasks.id, task.id));
    }
  }

  private async upsertPullRequest(connection: typeof githubConnections.$inferSelect, repository: typeof githubRepositories.$inferSelect, pullRequest: GitHubPayload, reviewActivity = false) {
    const [stored] = await this.database.db.insert(githubPullRequests).values({ id: uuidv7(), repositoryId: repository.id, githubPullRequestId: Number(pullRequest.id), nodeId: String(pullRequest.node_id), number: Number(pullRequest.number), title: String(pullRequest.title), body: String(pullRequest.body ?? ''), htmlUrl: String(pullRequest.html_url), state: String(pullRequest.merged ? 'merged' : pullRequest.state), draft: Boolean(pullRequest.draft), headRef: String(pullRequest.head?.ref ?? ''), baseRef: String(pullRequest.base?.ref ?? ''), headSha: String(pullRequest.head?.sha ?? ''), authorLogin: String(pullRequest.user?.login ?? ''), authorGithubUserId: pullRequest.user?.id ? Number(pullRequest.user.id) : null, updatedAtGithub: pullRequest.updated_at ? new Date(pullRequest.updated_at) : null }).onConflictDoUpdate({ target: [githubPullRequests.repositoryId, githubPullRequests.githubPullRequestId], set: { title: String(pullRequest.title), body: String(pullRequest.body ?? ''), htmlUrl: String(pullRequest.html_url), state: String(pullRequest.merged ? 'merged' : pullRequest.state), draft: Boolean(pullRequest.draft), headRef: String(pullRequest.head?.ref ?? ''), baseRef: String(pullRequest.base?.ref ?? ''), headSha: String(pullRequest.head?.sha ?? ''), authorLogin: String(pullRequest.user?.login ?? ''), authorGithubUserId: pullRequest.user?.id ? Number(pullRequest.user.id) : null, updatedAtGithub: pullRequest.updated_at ? new Date(pullRequest.updated_at) : null, updatedAt: new Date() } }).returning();
    const candidates = await this.database.db.select({ id: tasks.id, identifier: tasks.identifier }).from(tasks).where(and(eq(tasks.workspaceId, connection.workspaceId), isNull(tasks.deletedAt)));
    const refs = githubReferences([pullRequest.head?.ref, pullRequest.title, pullRequest.body].filter(Boolean).join('\n'), candidates.map((candidate) => candidate.identifier));
    for (const ref of refs) { const task = candidates.find((candidate) => candidate.identifier === ref.identifier); if (task) await this.database.db.insert(githubTaskPullRequests).values({ id: uuidv7(), taskId: task.id, pullRequestId: stored!.id, linkKind: ref.linkKind === 'ignored' ? 'closing' : ref.linkKind, source: 'github', ignored: ref.linkKind === 'ignored' }).onConflictDoUpdate({ target: [githubTaskPullRequests.taskId, githubTaskPullRequests.pullRequestId], set: { linkKind: ref.linkKind === 'ignored' ? 'closing' : ref.linkKind, ignored: ref.linkKind === 'ignored' } }); }
    await this.applyDefaultPullRequestAutomation(connection, stored!, reviewActivity);
    return stored;
  }
}

/** Avoid exposing a disabled feature as a permission failure. */
class NotFoundExceptionLike extends BadRequestException { constructor() { super('GitHub integration is disabled.'); } }
function githubHeaders(token?: string) { return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }
function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

@Controller('api/v1/github')
export class GitHubPublicController {
  constructor(private readonly github: GitHubService) {}
  @Get('manifest/redirect') redirect(@Query('state') state: string, @Res() reply: FastifyReply) { return this.github.manifestRedirect(state, reply); }
  @Get('manifest/callback') async callback(@Query('code') code: string, @Query('state') state: string, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeManifest(code, state)); }
  @Get('manifest/setup') async setup(@Query('state') state: string, @Query('installation_id') installationId: string | undefined, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeSetup(state, installationId)); }
  @Get('oauth/callback') async oauth(@Query('code') code: string, @Query('state') state: string, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeUserOAuth(code, state)); }
  @Post('webhook') webhook(@Req() request: FastifyRequest, @Res() reply: FastifyReply) { return this.github.webhook(request, reply); }
}

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/github')
export class GitHubController {
  constructor(private readonly github: GitHubService) {}
  @Get() status(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.status(workspaceId, request.user); }
  @Post('manifest') manifest(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.startManifest(workspaceId, request.user, body); }
  @Post('account') account(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.startUserOAuth(workspaceId, request.user); }
  @Post('repositories/mappings') mapping(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.mapRepository(workspaceId, request.user, body); }
  @Get('tasks/:taskRef/branch') branch(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Req() request: AuthedRequest) { return this.github.branch(workspaceId, request.user, taskRef); }
  @Post('tasks/:taskRef/issues') issue(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.createIssue(workspaceId, request.user, taskRef, body); }
  @Post('tasks/:taskRef/pull-requests/:pullRequestId') pullRequest(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: any) { return this.github.linkPullRequest(workspaceId, request.user, taskRef, pullRequestId, body?.linkKind); }
  @Get('reviews') reviews(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('mode') mode: 'for-me' | 'created' | undefined) { return this.github.listReviews(workspaceId, request.user, mode === 'created' ? 'created' : 'for-me'); }
  @Get('reviews/:pullRequestId') review(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.reviewDetail(workspaceId, request.user, pullRequestId); }
  @Get('reviews/:pullRequestId/diff') diff(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.diff(workspaceId, request.user, pullRequestId); }
  @Post('reviews/:pullRequestId/reviews') submitReview(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.submitReview(workspaceId, request.user, pullRequestId, body); }
  @Post('reviews/:pullRequestId/comments') comment(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.commentOnPullRequest(workspaceId, request.user, pullRequestId, body); }
  @Post('reviews/:pullRequestId/ready') ready(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.markPullRequestReady(workspaceId, request.user, pullRequestId); }
  @Post('reviews/:pullRequestId/merge') merge(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.merge(workspaceId, request.user, pullRequestId, body); }
  @Get('notifications') notifications(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.listNotifications(workspaceId, request.user); }
  @Get('notifications/unread-count') unreadCount(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.notificationCount(workspaceId, request.user); }
  @Patch('notifications/:notificationId/read') read(@Param('workspaceId') workspaceId: string, @Param('notificationId') notificationId: string, @Req() request: AuthedRequest) { return this.github.markNotificationRead(workspaceId, request.user, notificationId); }
  @Get('health') health(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.health(workspaceId, request.user); }
  @Post('jobs/:jobId/retry') retryJob(@Param('workspaceId') workspaceId: string, @Param('jobId') jobId: string, @Req() request: AuthedRequest) { return this.github.retryJob(workspaceId, request.user, jobId); }
  @Post('disconnect') disconnect(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.disconnect(workspaceId, request.user); }
}
