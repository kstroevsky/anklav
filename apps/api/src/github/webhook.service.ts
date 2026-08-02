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

import { GitHubJobService } from './job.service';

export abstract class GitHubWebhookService extends GitHubJobService {
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

  protected override async processWebhook(connection: typeof githubConnections.$inferSelect, event: string, payload: GitHubPayload) {
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
      await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, {
        workspaceId: connection.workspaceId,
        idempotencyKey: `github:issue:${repository.id}:${String(issue.id)}:${action}:${String(issue.updated_at ?? '')}`,
        command: { type: 'github.issue_sync', repositoryId: repository.id, issueId: Number(issue.id), action, updatedAt: issue.updated_at ?? null },
        source: { type: 'github', repositoryId: repository.id, issueId: Number(issue.id) },
        operation: async () => {
          const [before] = await tx.select().from(tasks).where(eq(tasks.id, existing.taskId)).limit(1);
          if (!before) throw new NotFoundException('Linked task no longer exists.');
          const set: Record<string, unknown> = { title: String(issue.title), description: String(issue.body ?? ''), updatedAt: new Date(), version: sql`${tasks.version} + 1` };
          if (desiredStateId) set.workflowStateId = desiredStateId;
          const [updated] = await tx.update(tasks).set(set as any).where(eq(tasks.id, existing.taskId)).returning();
          await tx.update(githubIssueLinks).set({ syncStatus: 'synced', lastSyncedSnapshot: { title: String(issue.title), description: String(issue.body ?? ''), state: String(issue.state) }, lastError: null, updatedAt: new Date() }).where(eq(githubIssueLinks.id, existing.id));
          return { aggregateId: updated!.id, aggregateVersion: updated!.version, eventType: desiredStateId && desiredStateId !== before.workflowStateId ? 'task.status_changed' : 'task.updated', state: updated!, result: updated! };
        },
      }));
      return;
    }
    if (!['opened', 'reopened'].includes(action)) return;
    const [defaultState] = await this.database.db.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, connection.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.isInitial, true), isNull(workflowStates.archivedAt))).limit(1);
    const workflowStateId = mapping.openStateId ?? defaultState?.id;
    if (!workflowStateId) throw new BadRequestException('Workspace does not have an initial task state for GitHub Issues sync.');
    await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, {
      workspaceId: connection.workspaceId,
      idempotencyKey: `github:issue:${repository.id}:${String(issue.id)}:created`,
      command: { type: 'github.issue_create', repositoryId: repository.id, issueId: Number(issue.id), projectId: mapping.projectId },
      source: { type: 'github', repositoryId: repository.id, issueId: Number(issue.id) },
      operation: async () => {
        const identity = await this.allocateTaskIdentity(tx, connection.workspaceId, mapping.projectId);
        const [task] = await tx.insert(tasks).values({ workspaceId: connection.workspaceId, projectId: mapping.projectId, title: String(issue.title), description: String(issue.body ?? ''), workflowStateId, priority: 'none', ...identity }).returning();
        await tx.insert(githubIssueLinks).values({ id: uuidv7(), taskId: task!.id, repositoryId: repository.id, githubIssueId: Number(issue.id), nodeId: String(issue.node_id), issueNumber: Number(issue.number), htmlUrl: String(issue.html_url), syncMode: mapping.syncMode, syncStatus: 'synced', lastSyncedSnapshot: { title: String(issue.title), description: String(issue.body ?? ''), state: String(issue.state) } });
        return { aggregateId: task!.id, aggregateVersion: task!.version, eventType: 'task.created', state: task!, result: task! };
      },
    }));
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
      if (target && target.id !== task.workflowStateId) await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, {
        workspaceId: connection.workspaceId,
        idempotencyKey: `github:pull-request:${pullRequest.id}:task:${task.id}:state:${target.id}:${pullRequest.updatedAt.getTime()}`,
        command: { type: 'github.pull_request_automation', pullRequestId: pullRequest.id, taskId: task.id, workflowStateId: target.id },
        source: { type: 'github', pullRequestId: pullRequest.id },
        operation: async () => {
          const [updated] = await tx.update(tasks).set({ workflowStateId: target.id, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(eq(tasks.id, task.id)).returning();
          return { aggregateId: updated!.id, aggregateVersion: updated!.version, eventType: 'task.status_changed', state: updated!, result: updated! };
        },
      }));
    }
  }

  protected override async upsertPullRequest(connection: typeof githubConnections.$inferSelect, repository: typeof githubRepositories.$inferSelect, pullRequest: GitHubPayload, reviewActivity = false) {
    const [stored] = await this.database.db.insert(githubPullRequests).values({ id: uuidv7(), repositoryId: repository.id, githubPullRequestId: Number(pullRequest.id), nodeId: String(pullRequest.node_id), number: Number(pullRequest.number), title: String(pullRequest.title), body: String(pullRequest.body ?? ''), htmlUrl: String(pullRequest.html_url), state: String(pullRequest.merged ? 'merged' : pullRequest.state), draft: Boolean(pullRequest.draft), headRef: String(pullRequest.head?.ref ?? ''), baseRef: String(pullRequest.base?.ref ?? ''), headSha: String(pullRequest.head?.sha ?? ''), authorLogin: String(pullRequest.user?.login ?? ''), authorGithubUserId: pullRequest.user?.id ? Number(pullRequest.user.id) : null, updatedAtGithub: pullRequest.updated_at ? new Date(pullRequest.updated_at) : null }).onConflictDoUpdate({ target: [githubPullRequests.repositoryId, githubPullRequests.githubPullRequestId], set: { title: String(pullRequest.title), body: String(pullRequest.body ?? ''), htmlUrl: String(pullRequest.html_url), state: String(pullRequest.merged ? 'merged' : pullRequest.state), draft: Boolean(pullRequest.draft), headRef: String(pullRequest.head?.ref ?? ''), baseRef: String(pullRequest.base?.ref ?? ''), headSha: String(pullRequest.head?.sha ?? ''), authorLogin: String(pullRequest.user?.login ?? ''), authorGithubUserId: pullRequest.user?.id ? Number(pullRequest.user.id) : null, updatedAtGithub: pullRequest.updated_at ? new Date(pullRequest.updated_at) : null, updatedAt: new Date() } }).returning();
    const candidates = await this.database.db.select({ id: tasks.id, identifier: tasks.identifier }).from(tasks).where(and(eq(tasks.workspaceId, connection.workspaceId), isNull(tasks.deletedAt)));
    const refs = githubReferences([pullRequest.head?.ref, pullRequest.title, pullRequest.body].filter(Boolean).join('\n'), candidates.map((candidate) => candidate.identifier));
    for (const ref of refs) { const task = candidates.find((candidate) => candidate.identifier === ref.identifier); if (task) await this.database.db.insert(githubTaskPullRequests).values({ id: uuidv7(), taskId: task.id, pullRequestId: stored!.id, linkKind: ref.linkKind === 'ignored' ? 'closing' : ref.linkKind, source: 'github', ignored: ref.linkKind === 'ignored' }).onConflictDoUpdate({ target: [githubTaskPullRequests.taskId, githubTaskPullRequests.pullRequestId], set: { linkKind: ref.linkKind === 'ignored' ? 'closing' : ref.linkKind, ignored: ref.linkKind === 'ignored' } }); }
    await this.applyDefaultPullRequestAutomation(connection, stored!, reviewActivity);
    return stored;
  }
}
