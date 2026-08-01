import { BadRequestException, ConflictException, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseBody } from '../common/http';
import { slugify, uuidv7 } from '../common/ids';
import { DatabaseService } from '../db/database.service';
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
} from '../db/schema';
import { decryptIntegrationSecret, encryptIntegrationSecret, GITHUB_API, appJwt, escapeHtml, githubFeatureEnabled, githubHeaders, githubReferences, githubRetryDelay, publicBaseUrl, taskBranchName, verifyGitHubWebhookSignature } from './helpers';
import { GitHubCredentials, GitHubPayload, issueInput, mappingInput, mergeInput, pullRequestCommentInput, reviewInput, stateInput } from './inputs';

import { GitHubBaseService } from './base.service';

export abstract class GitHubSetupService extends GitHubBaseService {
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

  async disconnect(workspaceId: string, user: AuthUser) {
    await this.owner(workspaceId, user);
    const [connection] = await this.database.db.update(githubConnections).set({ status: 'disconnected', installationId: null, encryptedCredentials: null, lastError: null, updatedAt: new Date() }).where(eq(githubConnections.workspaceId, workspaceId)).returning();
    if (!connection) throw new BadRequestException('GitHub is not connected to this workspace.');
    await this.database.db.delete(githubUserConnections).where(eq(githubUserConnections.workspaceId, workspaceId));
    return { ok: true };
  }


}
