import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, evidenceArtifacts, evidenceEventLinks, gitSlices, githubConnections, githubRepositories, knowledgeArtifacts, nativeSessions, runCheckpoints, runEvents, taskLeases, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import type { AppendRunEventInput, CheckpointInput, ClaimLeaseInput, FinishRunInput, GitSliceInput, NativeSessionInput, StartRunInput } from './inputs';

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

  async listTaskLeases(workspaceId: string, user: AuthUser, taskId: string) {
    await this.requireTask(workspaceId, user, taskId);
    return this.database.db.select().from(taskLeases).where(and(eq(taskLeases.workspaceId, workspaceId), eq(taskLeases.taskId, taskId), isNull(taskLeases.releasedAt), gt(taskLeases.expiresAt, new Date()))).orderBy(asc(taskLeases.createdAt));
  }

  async claimLease(workspaceId: string, user: AuthUser, runId: string, input: ClaimLeaseInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('Only a running execution attempt may hold a task lease.');
    if (run.modifiesCode && !input.writeAccess) throw new BadRequestException('A modifying run requires a write lease.');
    const now = new Date();
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM tasks WHERE id = ${run.taskId}::uuid FOR UPDATE`);
      await tx.update(taskLeases).set({ releasedAt: now }).where(and(eq(taskLeases.taskId, run.taskId), isNull(taskLeases.releasedAt), lte(taskLeases.expiresAt, now)));
      const active = await tx.select().from(taskLeases).where(and(eq(taskLeases.taskId, run.taskId), isNull(taskLeases.releasedAt), gt(taskLeases.expiresAt, now)));
      const sameRun = active.find((lease) => lease.runId === runId);
      if (sameRun) {
        if (sameRun.activity !== input.activity || sameRun.writeAccess !== input.writeAccess || sameRun.exclusive !== input.exclusive || canonicalJson(sameRun.pathScope) !== canonicalJson(normalizedPaths(input.pathScope))) throw new ConflictException('This run already holds a lease with a different scope. Release it before claiming another.');
        return { lease: sameRun, overlapWarnings: this.overlapWarnings(active.filter((lease) => lease.id !== sameRun.id), input) };
      }
      const overlapWarnings = this.overlapWarnings(active, input);
      if (input.exclusive && overlapWarnings.length) throw new ConflictException({ message: 'Exclusive task lease overlaps active modifying work.', overlapWarnings });
      const [lease] = await tx.insert(taskLeases).values({ workspaceId, taskId: run.taskId, runId, activity: input.activity, writeAccess: input.writeAccess, exclusive: input.exclusive, pathScope: normalizedPaths(input.pathScope), machineIdentity: run.machineIdentity, expiresAt: new Date(now.getTime() + input.ttlSeconds * 1_000), createdByUserId: user.id }).returning();
      return { lease: lease!, overlapWarnings };
    });
  }

  async renewLease(workspaceId: string, user: AuthUser, leaseId: string, ttlSeconds: number) {
    await this.workspaces.requireMembership(workspaceId, user);
    const now = new Date();
    const [lease] = await this.database.db.update(taskLeases).set({ expiresAt: new Date(now.getTime() + ttlSeconds * 1_000), lastRenewedAt: now }).where(and(eq(taskLeases.id, leaseId), eq(taskLeases.workspaceId, workspaceId), eq(taskLeases.createdByUserId, user.id), isNull(taskLeases.releasedAt), gt(taskLeases.expiresAt, now))).returning();
    if (!lease) throw new ConflictException('Lease is missing, expired, released, or owned by another user.');
    return lease;
  }

  async releaseLease(workspaceId: string, user: AuthUser, leaseId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [lease] = await this.database.db.update(taskLeases).set({ releasedAt: new Date() }).where(and(eq(taskLeases.id, leaseId), eq(taskLeases.workspaceId, workspaceId), eq(taskLeases.createdByUserId, user.id), isNull(taskLeases.releasedAt))).returning();
    if (!lease) throw new NotFoundException('Active lease not found or owned by another user.');
    return lease;
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
    await this.requireEvidenceArtifacts(workspaceId, input.evidenceArtifactId ? [input.evidenceArtifactId] : [], runId, run.taskId);
    const [created] = await this.database.db.transaction(async (tx) => {
      const created = await tx.insert(runEvents).values({ workspaceId, runId, type: input.type, idempotencyKey: input.idempotencyKey, payload: input.payload, artifactId: input.artifactId ?? null, occurredAt: new Date(input.occurredAt) }).onConflictDoNothing().returning();
      if (created[0] && input.evidenceArtifactId) await tx.insert(evidenceEventLinks).values({ evidenceArtifactId: input.evidenceArtifactId, runEventId: created[0].id }).onConflictDoNothing();
      return created;
    });
    if (created) return created;
    const [existing] = await this.database.db.select().from(runEvents).where(and(eq(runEvents.workspaceId, workspaceId), eq(runEvents.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!existing || existing.runId !== runId || existing.type !== input.type || existing.artifactId !== (input.artifactId ?? null) || existing.occurredAt.getTime() !== new Date(input.occurredAt).getTime() || canonicalJson(existing.payload) !== canonicalJson(input.payload)) throw new ConflictException('The idempotency key is already associated with a different run event.');
    if (input.evidenceArtifactId) {
      const [link] = await this.database.db.select().from(evidenceEventLinks).where(and(eq(evidenceEventLinks.evidenceArtifactId, input.evidenceArtifactId), eq(evidenceEventLinks.runEventId, existing.id))).limit(1);
      if (!link) throw new ConflictException('The idempotency key is already associated with a run event that has different evidence.');
    }
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
    await this.requireEvidenceArtifacts(workspaceId, input.evidenceArtifactIds, runId, run.taskId);
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
      const [checkpoint] = await tx.insert(runCheckpoints).values({ workspaceId, taskId: run.taskId, runId, sequence: (latest?.sequence ?? 0) + 1, gitSliceId: input.gitSliceId ?? null, objective: input.objective, summary: input.summary, completedWork: input.completedWork, remainingWork: input.remainingWork, activeDecisionIds: input.activeDecisionIds, relevantPaths: input.relevantPaths, failures: input.failures, lastVerified: input.lastVerified, nextAction: input.nextAction, artifactIds: input.artifactIds, evidenceArtifactIds: input.evidenceArtifactIds, assumptions: input.assumptions, coveredEventSequenceStart: input.coveredEventSequenceStart ?? null, coveredEventSequenceEnd: input.coveredEventSequenceEnd ?? null, contextPackHash: input.contextPackHash ?? null, createdByUserId: user.id }).returning();
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
      await tx.update(taskLeases).set({ releasedAt: new Date() }).where(and(eq(taskLeases.runId, runId), isNull(taskLeases.releasedAt)));
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

  private async requireEvidenceArtifacts(workspaceId: string, artifactIds: string[], runId?: string, taskId?: string) {
    const uniqueIds = [...new Set(artifactIds)];
    if (!uniqueIds.length) return;
    const rows = await this.database.db.select({ id: evidenceArtifacts.id, runId: evidenceArtifacts.runId, taskId: evidenceArtifacts.taskId }).from(evidenceArtifacts).where(and(eq(evidenceArtifacts.workspaceId, workspaceId), inArray(evidenceArtifacts.id, uniqueIds)));
    if (rows.length !== uniqueIds.length || (runId && rows.some((entry) => entry.runId && entry.runId !== runId)) || (taskId && rows.some((entry) => entry.taskId && entry.taskId !== taskId))) throw new BadRequestException('Every exact evidence artifact must exist in this workspace and be compatible with the run and task.');
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

  private overlapWarnings(active: Array<typeof taskLeases.$inferSelect>, input: Pick<ClaimLeaseInput, 'writeAccess' | 'pathScope'>) {
    if (!input.writeAccess) return [];
    const requestedPaths = normalizedPaths(input.pathScope);
    return active.filter((lease) => lease.writeAccess && pathsOverlap(requestedPaths, lease.pathScope)).map((lease) => ({ leaseId: lease.id, runId: lease.runId, machineIdentity: lease.machineIdentity, activity: lease.activity, pathScope: lease.pathScope }));
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean))].sort();
}

export function pathsOverlap(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return true;
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a.includes('*') || b.includes('*')));
}
