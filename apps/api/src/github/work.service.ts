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

import { GitHubSetupService } from './setup.service';

export abstract class GitHubWorkService extends GitHubSetupService {
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


}
