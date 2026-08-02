import { BadRequestException, ConflictException, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AuthUser, AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseBody } from '../common/http';
import { slugify, uuidv7 } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import { WorkspaceService } from '../workspace.service';
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
import { decryptIntegrationSecret, GITHUB_API, appJwt, githubFeatureEnabled, githubHeaders, hash } from './helpers';
import { NotFoundExceptionLike } from './errors';
import { TaskEventService } from '../resource/task-event.service';
import { GitHubCredentials, GitHubPayload, issueInput, mappingInput, mergeInput, pullRequestCommentInput, reviewInput, stateInput } from './inputs';

export abstract class GitHubBaseService implements OnModuleInit, OnModuleDestroy {
  protected timer?: NodeJS.Timeout;
  protected lastMaintenanceAt = 0;
  protected abstract processJobs(): Promise<void>;
  constructor(protected readonly database: DatabaseService, protected readonly workspaces: WorkspaceService, protected readonly taskEvents: TaskEventService) {}

  onModuleInit() {
    if (githubFeatureEnabled()) this.timer = setInterval(() => void this.processJobs(), 4_000).unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  protected ensureEnabled() { if (!githubFeatureEnabled()) throw new NotFoundExceptionLike(); }
  protected async owner(workspaceId: string, user: AuthUser) { await this.workspaces.requireMembership(workspaceId, user, 'admin'); }

  protected async connection(workspaceId: string) {
    const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.workspaceId, workspaceId)).limit(1);
    if (!connection) throw new BadRequestException('GitHub is not connected to this workspace.');
    return connection;
  }
  protected credentials(connection: typeof githubConnections.$inferSelect) {
    if (!connection.encryptedCredentials) throw new BadRequestException('GitHub App credentials are not available.');
    return JSON.parse(decryptIntegrationSecret(connection.encryptedCredentials)) as GitHubCredentials;
  }

  protected async createState(workspaceId: string, userId: string | null, purpose: string, metadata: Record<string, unknown>) {
    const state = randomBytes(32).toString('base64url');
    await this.database.db.insert(githubOauthStates).values({ id: uuidv7(), workspaceId, userId, purpose, stateHash: hash(state), metadata, expiresAt: new Date(Date.now() + 10 * 60 * 1_000) });
    return state;
  }
  protected async readState(state: string, purpose: string, consume: boolean) {
    const [record] = await this.database.db.select().from(githubOauthStates).where(and(eq(githubOauthStates.stateHash, hash(state)), eq(githubOauthStates.purpose, purpose), isNull(githubOauthStates.usedAt), gte(githubOauthStates.expiresAt, new Date()))).limit(1);
    if (!record) throw new BadRequestException('GitHub authorization state is invalid or expired.');
    if (consume) await this.database.db.update(githubOauthStates).set({ usedAt: new Date() }).where(eq(githubOauthStates.id, record.id));
    return record;
  }
  protected async connectionOrNull(workspaceId: string) { const [connection] = await this.database.db.select().from(githubConnections).where(eq(githubConnections.workspaceId, workspaceId)).limit(1); return connection ?? null; }
  protected async taskForRef(workspaceId: string, ref: string) {
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), or(eq(tasks.identifier, ref), sql`${tasks.id}::text = ${ref}`), isNull(tasks.deletedAt))).limit(1);
    if (task) return task;
    const [aliased] = await this.database.db.select({ task: tasks }).from(taskIdentifierAliases).innerJoin(tasks, eq(taskIdentifierAliases.taskId, tasks.id))
      .where(and(eq(taskIdentifierAliases.workspaceId, workspaceId), eq(taskIdentifierAliases.identifier, ref), isNull(tasks.deletedAt))).limit(1);
    if (!aliased) throw new BadRequestException('Task not found.'); return aliased.task;
  }
  protected snapshotTask(task: typeof tasks.$inferSelect) { return { title: task.title, description: task.description, workflowStateId: task.workflowStateId, assigneeMembershipId: task.assigneeMembershipId, identifier: task.identifier }; }
  protected async enqueue(workspaceId: string, connectionId: string | null, type: string, payload: Record<string, unknown>) { await this.database.db.insert(integrationJobs).values({ id: uuidv7(), workspaceId, connectionId, type, payload }); }

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

  /** Queue eventual GitHub Issue synchronization without holding up a local task mutation. */
  protected async installationToken(connection: typeof githubConnections.$inferSelect) {
    if (!connection.installationId) throw new BadRequestException('GitHub App is not installed.'); const credentials = this.credentials(connection);
    const response = await fetch(`${GITHUB_API}/app/installations/${connection.installationId}/access_tokens`, { method: 'POST', headers: githubHeaders(appJwt(credentials.appId, credentials.privateKey)) });
    if (!response.ok) throw new BadRequestException(`GitHub installation token request failed (${response.status}).`); return String((await response.json() as any).token);
  }
  protected async githubFetch(connection: typeof githubConnections.$inferSelect, path: string, init: RequestInit = {}) {
    const token = await this.installationToken(connection); return fetch(`${GITHUB_API}${path}`, { ...init, headers: { ...githubHeaders(token), ...(init.headers ?? {}) } });
  }
  protected async githubRequest(connection: typeof githubConnections.$inferSelect, path: string, init: { method: string; body?: unknown }) {
    const response = await this.githubFetch(connection, path, { method: init.method, headers: { 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    if (!response.ok) throw new BadRequestException(`GitHub request failed (${response.status}).`); return response.json();
  }
  protected async userToken(workspaceId: string, userId: string) {
    const [account] = await this.database.db.select().from(githubUserConnections).where(and(eq(githubUserConnections.workspaceId, workspaceId), eq(githubUserConnections.userId, userId))).limit(1); if (!account) throw new BadRequestException('Connect your personal GitHub account before performing review actions.'); return decryptIntegrationSecret(account.encryptedToken);
  }
  protected async githubUserRequest(token: string, path: string, init: { method: string; body?: unknown }) {
    const response = await fetch(`${GITHUB_API}${path}`, { method: init.method, headers: { ...githubHeaders(token), 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new BadRequestException(result.message ?? `GitHub request failed (${response.status}).`); return result;
  }

}
