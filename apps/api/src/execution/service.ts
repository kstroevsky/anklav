import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, gitSlices, githubConnections, githubRepositories, knowledgeArtifacts, nativeSessions, runCheckpoints, runEvents, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import type { AppendRunEventInput, CheckpointInput, FinishRunInput, GitSliceInput, NativeSessionInput, StartRunInput } from './inputs';

@Injectable()
export class ExecutionService {
  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService) {}

  async listTaskRuns(workspaceId: string, user: AuthUser, taskId: string) {
    await this.requireTask(workspaceId, user, taskId);
    return this.database.db.select().from(agentRuns).where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.taskId, taskId))).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id));
  }

  async getRun(workspaceId: string, user: AuthUser, runId: string) {
    const run = await this.requireRun(workspaceId, user, runId);
    const [slices, sessions, events, checkpoints] = await Promise.all([
      this.database.db.select().from(gitSlices).where(eq(gitSlices.runId, runId)).orderBy(asc(gitSlices.capturedAt), asc(gitSlices.id)),
      this.database.db.select().from(nativeSessions).where(eq(nativeSessions.runId, runId)).orderBy(asc(nativeSessions.createdAt)),
      this.database.db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.sequence)).limit(1_000),
      this.database.db.select().from(runCheckpoints).where(eq(runCheckpoints.runId, runId)).orderBy(asc(runCheckpoints.sequence)),
    ]);
    return { ...run, gitSlices: slices, nativeSessions: sessions, events, checkpoints };
  }

  async listRunEvents(workspaceId: string, user: AuthUser, runId: string, after?: number) {
    await this.requireRun(workspaceId, user, runId);
    const rows = await this.database.db.select().from(runEvents).where(and(eq(runEvents.runId, runId), after ? gt(runEvents.sequence, after) : undefined)).orderBy(asc(runEvents.sequence)).limit(501);
    const hasMore = rows.length > 500;
    const items = rows.slice(0, 500);
    return { items, nextAfter: hasMore ? items.at(-1)!.sequence : null };
  }

  async startRun(workspaceId: string, user: AuthUser, taskId: string, input: StartRunInput) {
    await this.requireTask(workspaceId, user, taskId);
    if (input.modifiesCode && !input.startingGitSlice) throw new BadRequestException('A modifying run requires an immutable starting Git slice.');
    if (input.parentRunId) {
      const parent = await this.requireRun(workspaceId, user, input.parentRunId);
      if (parent.taskId !== taskId) throw new BadRequestException('A parent run must execute the same task. Use a child task for delegated work with a different objective.');
    }
    await this.validateGitSliceReferences(workspaceId, input.startingGitSlice);
    await this.validateNativeSessionReferences(workspaceId, input.nativeSession);
    return this.database.db.transaction(async (tx) => {
      const [run] = await tx.insert(agentRuns).values({ workspaceId, taskId, parentRunId: input.parentRunId ?? null, provider: input.provider, client: input.client, agentType: input.agentType, model: input.model ?? null, reasoningConfig: input.reasoningConfig, machineIdentity: input.machineIdentity, modifiesCode: input.modifiesCode, permissions: input.permissions, createdByUserId: user.id }).returning();
      const startingGitSlice = input.startingGitSlice ? await this.insertGitSlice(tx, workspaceId, taskId, run!.id, 'start', user.id, input.startingGitSlice) : null;
      const nativeSession = input.nativeSession ? await this.insertNativeSession(tx, workspaceId, run!.id, input.provider, input.nativeSession) : null;
      return { ...run!, startingGitSlice, nativeSession };
    });
  }

  async appendEvent(workspaceId: string, user: AuthUser, runId: string, input: AppendRunEventInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('Events cannot be appended after a run has ended.');
    await this.requireArtifacts(workspaceId, input.artifactId ? [input.artifactId] : []);
    const [created] = await this.database.db.insert(runEvents).values({ workspaceId, runId, type: input.type, idempotencyKey: input.idempotencyKey, payload: input.payload, artifactId: input.artifactId ?? null, occurredAt: new Date(input.occurredAt) }).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await this.database.db.select().from(runEvents).where(and(eq(runEvents.workspaceId, workspaceId), eq(runEvents.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!existing || existing.runId !== runId || existing.type !== input.type) throw new ConflictException('The idempotency key is already associated with a different run event.');
    return existing;
  }

  async captureGitSlice(workspaceId: string, user: AuthUser, runId: string, input: GitSliceInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('Git state cannot be captured after a run has ended.');
    await this.validateGitSliceReferences(workspaceId, input);
    return this.insertGitSlice(this.database.db, workspaceId, run.taskId, runId, 'checkpoint', user.id, input);
  }

  async attachNativeSession(workspaceId: string, user: AuthUser, runId: string, input: NativeSessionInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('A native session cannot be attached after a run has ended.');
    await this.validateNativeSessionReferences(workspaceId, input);
    return this.insertNativeSession(this.database.db, workspaceId, runId, run.provider, input);
  }

  async createCheckpoint(workspaceId: string, user: AuthUser, runId: string, input: CheckpointInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    await this.requireArtifacts(workspaceId, input.artifactIds);
    await this.requireActiveDecisions(workspaceId, input.activeDecisionIds);
    if (input.gitSliceId) {
      const [slice] = await this.database.db.select().from(gitSlices).where(and(eq(gitSlices.id, input.gitSliceId), eq(gitSlices.workspaceId, workspaceId), eq(gitSlices.runId, runId))).limit(1);
      if (!slice) throw new BadRequestException('The checkpoint Git slice must belong to this run.');
    }
    if (input.coveredEventSequenceStart && input.coveredEventSequenceEnd) {
      const bounds = await this.database.db.select({ sequence: runEvents.sequence }).from(runEvents).where(and(eq(runEvents.runId, runId), inArray(runEvents.sequence, [input.coveredEventSequenceStart, input.coveredEventSequenceEnd])));
      if (new Set(bounds.map((entry) => entry.sequence)).size !== (input.coveredEventSequenceStart === input.coveredEventSequenceEnd ? 1 : 2)) throw new BadRequestException('Checkpoint event coverage must reference events from this run.');
    }
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM agent_runs WHERE id = ${runId}::uuid FOR UPDATE`);
      const [latest] = await tx.select({ sequence: runCheckpoints.sequence }).from(runCheckpoints).where(eq(runCheckpoints.runId, runId)).orderBy(desc(runCheckpoints.sequence)).limit(1);
      const [checkpoint] = await tx.insert(runCheckpoints).values({ workspaceId, taskId: run.taskId, runId, sequence: (latest?.sequence ?? 0) + 1, gitSliceId: input.gitSliceId ?? null, objective: input.objective, summary: input.summary, completedWork: input.completedWork, remainingWork: input.remainingWork, activeDecisionIds: input.activeDecisionIds, relevantPaths: input.relevantPaths, failures: input.failures, lastVerified: input.lastVerified, nextAction: input.nextAction, artifactIds: input.artifactIds, assumptions: input.assumptions, coveredEventSequenceStart: input.coveredEventSequenceStart ?? null, coveredEventSequenceEnd: input.coveredEventSequenceEnd ?? null, contextPackHash: input.contextPackHash ?? null, createdByUserId: user.id }).returning();
      return checkpoint!;
    });
  }

  async finishRun(workspaceId: string, user: AuthUser, runId: string, input: FinishRunInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('Run has already ended.');
    if (run.modifiesCode && !input.endingGitSlice) throw new BadRequestException('A modifying run must capture its ending Git slice before it can end.');
    await this.validateGitSliceReferences(workspaceId, input.endingGitSlice);
    return this.database.db.transaction(async (tx) => {
      const endingGitSlice = input.endingGitSlice ? await this.insertGitSlice(tx, workspaceId, run.taskId, runId, 'end', user.id, input.endingGitSlice) : null;
      const [updated] = await tx.update(agentRuns).set({ status: input.status, outcomeSummary: input.outcomeSummary, tokenUsage: input.tokenUsage, costMicros: input.costMicros ?? null, endedAt: new Date() }).where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.status, 'running'))).returning();
      if (!updated) throw new ConflictException('Run has already ended.');
      return { ...updated, endingGitSlice };
    });
  }

  private async requireTask(workspaceId: string, user: AuthUser, taskId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!task || task.deletedAt) throw new NotFoundException('Task not found.');
    return task;
  }

  private async requireRun(workspaceId: string, user: AuthUser, runId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [run] = await this.database.db.select().from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.workspaceId, workspaceId))).limit(1);
    if (!run) throw new NotFoundException('Run not found.');
    return run;
  }

  private async requireArtifacts(workspaceId: string, artifactIds: string[]) {
    const uniqueIds = [...new Set(artifactIds)];
    if (!uniqueIds.length) return;
    const rows = await this.database.db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), inArray(knowledgeArtifacts.id, uniqueIds)));
    if (rows.length !== uniqueIds.length) throw new BadRequestException('Every referenced artifact or decision must exist in this workspace.');
  }

  private async requireActiveDecisions(workspaceId: string, decisionIds: string[]) {
    const uniqueIds = [...new Set(decisionIds)];
    if (!uniqueIds.length) return;
    const rows = await this.database.db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), inArray(knowledgeArtifacts.id, uniqueIds), eq(knowledgeArtifacts.type, 'decision'), eq(knowledgeArtifacts.canonicality, 'canonical'), eq(knowledgeArtifacts.verification, 'verified'), isNull(knowledgeArtifacts.deletedAt)));
    if (rows.length !== uniqueIds.length) throw new BadRequestException('Every active decision must be a current, verified canonical decision in this workspace.');
  }

  private async validateGitSliceReferences(workspaceId: string, input?: GitSliceInput) {
    if (input?.patchArtifactId) await this.requireArtifacts(workspaceId, [input.patchArtifactId]);
    if (input?.githubRepositoryId) {
      const [repository] = await this.database.db.select({ fullName: githubRepositories.fullName }).from(githubRepositories).innerJoin(githubConnections, eq(githubRepositories.connectionId, githubConnections.id)).where(and(eq(githubRepositories.id, input.githubRepositoryId), eq(githubConnections.workspaceId, workspaceId))).limit(1);
      if (!repository || repository.fullName !== input.repositoryFullName) throw new BadRequestException('The Git slice repository must belong to this workspace and match repositoryFullName.');
    }
  }

  private async validateNativeSessionReferences(workspaceId: string, input?: NativeSessionInput) {
    if (input?.archiveArtifactId) await this.requireArtifacts(workspaceId, [input.archiveArtifactId]);
  }

  private async insertGitSlice(executor: any, workspaceId: string, taskId: string, runId: string, phase: 'start' | 'end' | 'checkpoint', userId: string, input: GitSliceInput) {
    const [slice] = await executor.insert(gitSlices).values({ workspaceId, taskId, runId, phase, githubRepositoryId: input.githubRepositoryId ?? null, repositoryFullName: input.repositoryFullName, baseCommitSha: input.baseCommitSha, headCommitSha: input.headCommitSha, mergeBaseSha: input.mergeBaseSha ?? null, branchName: input.branchName ?? null, includedPaths: input.includedPaths, excludedPaths: input.excludedPaths, diffHash: input.diffHash ?? null, worktreeIdentity: input.worktreeIdentity ?? null, dirtyState: input.dirtyState, patchArtifactId: input.patchArtifactId ?? null, submoduleStates: input.submoduleStates, dependencyLockHashes: input.dependencyLockHashes, createdByUserId: userId }).returning();
    return slice!;
  }

  private async insertNativeSession(executor: any, workspaceId: string, runId: string, provider: StartRunInput['provider'], input: NativeSessionInput) {
    const [session] = await executor.insert(nativeSessions).values({ workspaceId, runId, provider, nativeSessionId: input.nativeSessionId, parentNativeSessionId: input.parentNativeSessionId ?? null, clientVersion: input.clientVersion ?? null, protocolVersion: input.protocolVersion ?? null, archiveArtifactId: input.archiveArtifactId ?? null, resumability: input.resumability, metadata: input.metadata }).onConflictDoNothing().returning();
    if (session) return session;
    const [existing] = await executor.select().from(nativeSessions).where(and(eq(nativeSessions.runId, runId), eq(nativeSessions.provider, provider), eq(nativeSessions.nativeSessionId, input.nativeSessionId))).limit(1);
    return existing!;
  }
}
