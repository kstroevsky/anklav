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

import { GitHubWorkService } from './work.service';

export abstract class GitHubJobService extends GitHubWorkService {
  protected abstract processWebhook(connection: typeof githubConnections.$inferSelect, event: string, payload: GitHubPayload): Promise<void>;
  protected abstract upsertPullRequest(connection: typeof githubConnections.$inferSelect, repository: typeof githubRepositories.$inferSelect, pullRequest: GitHubPayload, reviewActivity?: boolean): Promise<unknown>;
  protected override async processJobs() {
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
  protected async refreshRepositories(connection: typeof githubConnections.$inferSelect) {
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

  protected async reconcile(connection: typeof githubConnections.$inferSelect) {
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

}
