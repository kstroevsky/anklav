import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, evidenceArtifacts, evidenceEventLinks, gitSliceEvidence, gitSlices, githubConnections, githubRepositories, knowledgeArtifacts, nativeSessionEvidence, nativeSessionIngestions, nativeSessionItems, nativeSessions, nativeSessionTurns, repositories, repositoryLocalAliases, runCheckpoints, runEvents, taskLeases, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import type { AppendRunEventInput, CheckpointInput, ClaimLeaseInput, FinishRunInput, GitSliceInput, NativeSessionIngestionInput, NativeSessionInput, StartRunInput } from './inputs';
import { handoffBlockers } from './handoff';

@Injectable()
export class ExecutionService {
  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService) {}

  async listTaskRuns(workspaceId: string, user: AuthUser, taskId: string) {
    await this.requireTask(workspaceId, user, taskId);
    const runs = await this.database.db.select().from(agentRuns).where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.taskId, taskId))).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id));
    if (!runs.length) return [];
    const sessions = await this.database.db.select().from(nativeSessions).where(inArray(nativeSessions.runId, runs.map((run) => run.id))).orderBy(asc(nativeSessions.createdAt));
    return runs.map((run) => ({ ...run, nativeSessions: sessions.filter((session) => session.runId === run.id) }));
  }

  async getTaskOperations(workspaceId: string, user: AuthUser, taskId: string) {
    const task = await this.requireTask(workspaceId, user, taskId);
    const now = new Date();
    const [latestCheckpoint, latestSlice, activeLeases] = await Promise.all([
      this.database.db.select().from(runCheckpoints).where(and(eq(runCheckpoints.workspaceId, workspaceId), eq(runCheckpoints.taskId, taskId))).orderBy(desc(runCheckpoints.createdAt), desc(runCheckpoints.id)).limit(1),
      this.database.db.select().from(gitSlices).where(and(eq(gitSlices.workspaceId, workspaceId), eq(gitSlices.taskId, taskId))).orderBy(desc(gitSlices.capturedAt), desc(gitSlices.id)).limit(1),
      this.database.db.select().from(taskLeases).where(and(eq(taskLeases.workspaceId, workspaceId), eq(taskLeases.taskId, taskId), isNull(taskLeases.releasedAt), gt(taskLeases.expiresAt, now))).orderBy(asc(taskLeases.expiresAt)),
    ]);
    const checkpoint = latestCheckpoint[0] ?? null;
    const slice = latestSlice[0] ?? null;
    const patchEvidence = slice ? await this.database.db.select().from(gitSliceEvidence).where(and(eq(gitSliceEvidence.gitSliceId, slice.id), eq(gitSliceEvidence.role, 'dirty_patch'))).limit(1) : [];
    const run = checkpoint ? await this.database.db.select().from(agentRuns).where(eq(agentRuns.id, checkpoint.runId)).limit(1) : [];
    const conflicts = activeLeases.filter((lease) => lease.writeAccess);
    const blockers = handoffBlockers({ checkpointPresent: Boolean(checkpoint), gitSlice: slice, patchEvidenceArtifactId: patchEvidence[0]?.evidenceArtifactId, activeWriteLeaseCount: conflicts.length });
    return { ready: blockers.length === 0, blockers, checkpoint, gitSlice: slice ? { ...slice, patchEvidenceArtifactId: patchEvidence[0]?.evidenceArtifactId ?? null } : null, run: run[0] ?? null, activeLeases, command: `anklav continue ${task.identifier}` };
  }

  async listWorkspaceNativeSessions(workspaceId: string, user: AuthUser, offset = 0, limit = 100) {
    await this.workspaces.requireMembership(workspaceId, user);
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const totals = await this.database.db.select({ count: sql<number>`count(*)::int` }).from(nativeSessions).where(eq(nativeSessions.workspaceId, workspaceId));
    const count = totals[0]?.count ?? 0;
    const rows = await this.database.db.select({ session: nativeSessions, run: agentRuns, task: tasks }).from(nativeSessions).innerJoin(agentRuns, eq(nativeSessions.runId, agentRuns.id)).innerJoin(tasks, eq(agentRuns.taskId, tasks.id)).where(eq(nativeSessions.workspaceId, workspaceId)).orderBy(desc(nativeSessions.updatedAt), desc(nativeSessions.id)).limit(safeLimit).offset(Math.max(offset, 0));
    return { items: rows.map((row) => ({ ...row.session, run: row.run, task: row.task })), total: count ?? 0, nextOffset: offset + rows.length < (count ?? 0) ? offset + rows.length : null };
  }

  async listMachines(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [runs, leases, aliases] = await Promise.all([
      this.database.db.select({ run: agentRuns, task: tasks }).from(agentRuns).innerJoin(tasks, eq(agentRuns.taskId, tasks.id)).where(eq(agentRuns.workspaceId, workspaceId)).orderBy(desc(agentRuns.startedAt)),
      this.database.db.select({ lease: taskLeases, task: tasks }).from(taskLeases).innerJoin(tasks, eq(taskLeases.taskId, tasks.id)).where(and(eq(taskLeases.workspaceId, workspaceId), isNull(taskLeases.releasedAt), gt(taskLeases.expiresAt, new Date()))),
      this.database.db.select({ alias: repositoryLocalAliases, repository: repositories }).from(repositoryLocalAliases).innerJoin(repositories, eq(repositoryLocalAliases.repositoryId, repositories.id)).where(eq(repositories.workspaceId, workspaceId)).orderBy(asc(repositoryLocalAliases.machineIdentity)),
    ]);
    const identities = new Set([...runs.map((entry) => entry.run.machineIdentity), ...leases.map((entry) => entry.lease.machineIdentity), ...aliases.map((entry) => entry.alias.machineIdentity)]);
    return [...identities].map((machineIdentity) => {
      const machineRuns = runs.filter((entry) => entry.run.machineIdentity === machineIdentity);
      const active = machineRuns.find((entry) => entry.run.status === 'running') ?? null;
      const last = machineRuns[0] ?? null;
      const machineAliases = aliases.filter((entry) => entry.alias.machineIdentity === machineIdentity);
      const machineLeases = leases.filter((entry) => entry.lease.machineIdentity === machineIdentity);
      const lastSeenAt = machineLeases[0]?.lease.lastRenewedAt ?? last?.run.endedAt ?? last?.run.startedAt ?? machineAliases[0]?.alias.updatedAt ?? null;
      return { machineIdentity, lastSeenAt, activeRun: active?.run ?? null, activeTask: active?.task ?? null, leases: machineLeases.map((entry) => ({ ...entry.lease, task: entry.task })), aliases: machineAliases.map((entry) => ({ ...entry.alias, repository: entry.repository })), lastSyncAt: null };
    }).sort((left, right) => Date.parse(String(right.lastSeenAt ?? 0)) - Date.parse(String(left.lastSeenAt ?? 0)));
  }

  async getRun(workspaceId: string, user: AuthUser, runId: string) {
    const run = await this.requireRun(workspaceId, user, runId);
    const [slices, sessions, events, checkpoints] = await Promise.all([
      this.database.db.select().from(gitSlices).where(eq(gitSlices.runId, runId)).orderBy(asc(gitSlices.capturedAt), asc(gitSlices.id)),
      this.database.db.select().from(nativeSessions).where(eq(nativeSessions.runId, runId)).orderBy(asc(nativeSessions.createdAt)),
      this.database.db.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.sequence)).limit(1_000),
      this.database.db.select().from(runCheckpoints).where(eq(runCheckpoints.runId, runId)).orderBy(asc(runCheckpoints.sequence)),
    ]);
    const sliceEvidence = slices.length ? await this.database.db.select().from(gitSliceEvidence).where(inArray(gitSliceEvidence.gitSliceId, slices.map((slice) => slice.id))) : [];
    return { ...run, gitSlices: slices.map((slice) => ({ ...slice, patchEvidenceArtifactId: sliceEvidence.find((entry) => entry.gitSliceId === slice.id && entry.role === 'dirty_patch')?.evidenceArtifactId ?? null })), nativeSessions: sessions, events, checkpoints };
  }

  async listRunEvents(workspaceId: string, user: AuthUser, runId: string, after?: number) {
    await this.requireRun(workspaceId, user, runId);
    const rows = await this.database.db.select().from(runEvents).where(and(eq(runEvents.runId, runId), after ? gt(runEvents.sequence, after) : undefined)).orderBy(asc(runEvents.sequence)).limit(501);
    const hasMore = rows.length > 500;
    const items = rows.slice(0, 500);
    return { items, nextAfter: hasMore ? items.at(-1)!.sequence : null };
  }

  async getNativeSession(workspaceId: string, user: AuthUser, nativeSessionId: string) {
    const session = await this.requireNativeSession(workspaceId, user, nativeSessionId);
    const [turns, ingestions, archiveEvidence] = await Promise.all([
      this.database.db.select().from(nativeSessionTurns).where(eq(nativeSessionTurns.nativeSessionId, nativeSessionId)).orderBy(asc(nativeSessionTurns.sequence)),
      this.database.db.select().from(nativeSessionIngestions).where(eq(nativeSessionIngestions.nativeSessionId, nativeSessionId)).orderBy(desc(nativeSessionIngestions.ingestedAt)),
      this.database.db.select({ evidenceArtifactId: nativeSessionEvidence.evidenceArtifactId, role: nativeSessionEvidence.role }).from(nativeSessionEvidence).where(eq(nativeSessionEvidence.nativeSessionId, nativeSessionId)),
    ]);
    return { ...session, turns, ingestions, archiveEvidence };
  }

  async listNativeSessionItems(workspaceId: string, user: AuthUser, nativeSessionId: string, after?: number) {
    await this.requireNativeSession(workspaceId, user, nativeSessionId);
    const rows = await this.database.db.select().from(nativeSessionItems).where(and(eq(nativeSessionItems.nativeSessionId, nativeSessionId), after ? gt(nativeSessionItems.sequence, after) : undefined)).orderBy(asc(nativeSessionItems.sequence)).limit(501);
    const hasMore = rows.length > 500;
    const items = rows.slice(0, 500).map((item) => item.redactionStatus === 'safe' || item.redactionStatus === 'redacted' ? { ...item, contentWithheld: false } : { ...item, summary: '', redactedContent: {}, metadata: {}, contentWithheld: true });
    return { items, nextAfter: hasMore ? items.at(-1)!.sequence : null };
  }

  async listNativeSessionIngestions(workspaceId: string, user: AuthUser, nativeSessionId: string) {
    await this.requireNativeSession(workspaceId, user, nativeSessionId);
    return this.database.db.select().from(nativeSessionIngestions).where(eq(nativeSessionIngestions.nativeSessionId, nativeSessionId)).orderBy(desc(nativeSessionIngestions.ingestedAt));
  }

  async ingestNativeSession(workspaceId: string, user: AuthUser, nativeSessionId: string, input: NativeSessionIngestionInput) {
    await this.requireNativeSession(workspaceId, user, nativeSessionId);
    const payloadHash = nativeSessionIngestionHash(input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${workspaceId}:${input.idempotencyKey}`}))`);
      const [idempotent] = await tx.select().from(nativeSessionIngestions).where(and(eq(nativeSessionIngestions.workspaceId, workspaceId), eq(nativeSessionIngestions.idempotencyKey, input.idempotencyKey))).limit(1);
      if (idempotent) {
        if (idempotent.nativeSessionId !== nativeSessionId || idempotent.payloadHash !== payloadHash) throw new ConflictException('The ingestion idempotency key is already associated with different content.');
        return { ingestion: idempotent, replayed: true };
      }
      await tx.execute(sql`SELECT id FROM native_sessions WHERE id = ${nativeSessionId}::uuid FOR UPDATE`);
      const [lockedSession] = await tx.select().from(nativeSessions).where(eq(nativeSessions.id, nativeSessionId)).limit(1);
      if (!lockedSession) throw new NotFoundException('Native session not found.');
      const [revision] = await tx.select().from(nativeSessionIngestions).where(and(eq(nativeSessionIngestions.nativeSessionId, nativeSessionId), eq(nativeSessionIngestions.sourceRevision, input.sourceRevision))).limit(1);
      if (revision) {
        if (revision.payloadHash !== payloadHash) throw new ConflictException('The source revision is already associated with different content.');
        return { ingestion: revision, replayed: true };
      }

      const existingTurns = await tx.select().from(nativeSessionTurns).where(eq(nativeSessionTurns.nativeSessionId, nativeSessionId));
      const turnsByNativeId = new Map(existingTurns.map((turn) => [turn.nativeTurnId, turn]));
      const turnsBySequence = new Map(existingTurns.map((turn) => [turn.sequence, turn]));
      for (const turn of input.turns) {
        const byId = turnsByNativeId.get(turn.nativeTurnId);
        const bySequence = turnsBySequence.get(turn.sequence);
        if ((byId && (byId.sequence !== turn.sequence || byId.parentNativeTurnId !== (turn.parentNativeTurnId ?? null))) || (bySequence && bySequence.nativeTurnId !== turn.nativeTurnId)) throw new ConflictException(`Native turn ${turn.nativeTurnId} conflicts with previously ingested structure.`);
        if (byId) {
          if (['completed', 'interrupted', 'failed'].includes(byId.status) && byId.status !== turn.status) throw new ConflictException(`Native turn ${turn.nativeTurnId} cannot change after reaching a terminal status.`);
          const [updated] = await tx.update(nativeSessionTurns).set({ status: turn.status, startedAt: turn.startedAt ? new Date(turn.startedAt) : null, completedAt: turn.completedAt ? new Date(turn.completedAt) : null, metadata: turn.metadata, updatedAt: new Date() }).where(eq(nativeSessionTurns.id, byId.id)).returning();
          turnsByNativeId.set(turn.nativeTurnId, updated!);
        } else {
          const [created] = await tx.insert(nativeSessionTurns).values({ workspaceId, nativeSessionId, nativeTurnId: turn.nativeTurnId, parentNativeTurnId: turn.parentNativeTurnId ?? null, sequence: turn.sequence, status: turn.status, startedAt: turn.startedAt ? new Date(turn.startedAt) : null, completedAt: turn.completedAt ? new Date(turn.completedAt) : null, metadata: turn.metadata }).returning();
          turnsByNativeId.set(turn.nativeTurnId, created!);
          turnsBySequence.set(turn.sequence, created!);
        }
      }
      for (const turn of input.turns) if (turn.parentNativeTurnId && !turnsByNativeId.has(turn.parentNativeTurnId)) throw new BadRequestException(`Native turn ${turn.nativeTurnId} references an unknown parent turn.`);

      const existingItems = await tx.select().from(nativeSessionItems).where(eq(nativeSessionItems.nativeSessionId, nativeSessionId));
      const itemsByNativeId = new Map(existingItems.map((item) => [item.nativeItemId, item]));
      const itemsBySequence = new Map(existingItems.map((item) => [item.sequence, item]));
      const newItemIds = new Set<string>();
      for (const item of [...input.items].sort((left, right) => left.sequence - right.sequence)) {
        const byId = itemsByNativeId.get(item.nativeItemId);
        const bySequence = itemsBySequence.get(item.sequence);
        const turn = item.nativeTurnId ? turnsByNativeId.get(item.nativeTurnId) : null;
        if (item.nativeTurnId && !turn) throw new BadRequestException(`Native item ${item.nativeItemId} references an unknown turn.`);
        const immutable = { turnId: turn?.id ?? null, parentNativeItemId: item.parentNativeItemId ?? null, sequence: item.sequence, type: item.type, role: item.role ?? null, status: item.status, summary: item.summary, redactedContent: item.redactedContent, contentHash: item.contentHash, redactionStatus: item.redactionStatus, correlationId: item.correlationId ?? null, occurredAt: new Date(item.occurredAt), metadata: item.metadata };
        if (bySequence && bySequence.nativeItemId !== item.nativeItemId) throw new ConflictException(`Native item sequence ${item.sequence} is already occupied.`);
        if (byId) {
          const comparable = { turnId: byId.turnId, parentNativeItemId: byId.parentNativeItemId, sequence: byId.sequence, type: byId.type, role: byId.role, status: byId.status, summary: byId.summary, redactedContent: byId.redactedContent, contentHash: byId.contentHash, redactionStatus: byId.redactionStatus, correlationId: byId.correlationId, occurredAt: byId.occurredAt, metadata: byId.metadata };
          if (canonicalJson(comparable) !== canonicalJson(immutable)) throw new ConflictException(`Native item ${item.nativeItemId} conflicts with previously ingested immutable content.`);
        } else {
          const [created] = await tx.insert(nativeSessionItems).values({ workspaceId, nativeSessionId, nativeItemId: item.nativeItemId, ...immutable }).returning();
          itemsByNativeId.set(item.nativeItemId, created!);
          itemsBySequence.set(item.sequence, created!);
          newItemIds.add(created!.id);
        }
      }
      for (const item of input.items) {
        const stored = itemsByNativeId.get(item.nativeItemId)!;
        if (item.parentNativeItemId && !itemsByNativeId.has(item.parentNativeItemId)) throw new BadRequestException(`Native item ${item.nativeItemId} references an unknown parent item.`);
        const related = item.relatedNativeItemId ? itemsByNativeId.get(item.relatedNativeItemId) : null;
        if (item.relatedNativeItemId && !related) throw new BadRequestException(`Native item ${item.nativeItemId} references an unknown related item.`);
        if (!newItemIds.has(stored.id)) {
          if (stored.relatedItemId !== (related?.id ?? null) || stored.relationshipType !== (item.relationshipType ?? null)) throw new ConflictException(`Native item ${item.nativeItemId} conflicts with its previously ingested relationship.`);
        } else if (related) {
          await tx.update(nativeSessionItems).set({ relatedItemId: related.id, relationshipType: item.relationshipType ?? null }).where(eq(nativeSessionItems.id, stored.id));
        }
      }

      const status = input.parseErrors.length ? 'partial' : input.complete ? 'complete' : 'ingesting';
      const [ingestion] = await tx.insert(nativeSessionIngestions).values({ workspaceId, nativeSessionId, idempotencyKey: input.idempotencyKey, payloadHash, sourceRevision: input.sourceRevision, parserVersion: input.parserVersion, fromCursor: input.fromCursor ?? null, toCursor: input.toCursor ?? null, status, turnCount: input.turns.length, itemCount: input.items.length, errors: input.parseErrors, manifest: input.manifest }).returning();
      const [itemTotal] = await tx.select({ count: sql<number>`count(*)::int` }).from(nativeSessionItems).where(eq(nativeSessionItems.nativeSessionId, nativeSessionId));
      await tx.update(nativeSessions).set({ parserVersion: input.parserVersion, sourceRevision: input.sourceRevision, ingestionStatus: status, lastNativeCursor: input.toCursor ?? lockedSession.lastNativeCursor, lastIngestedAt: new Date(), recordCount: itemTotal?.count ?? 0, manifest: { ...lockedSession.manifest, ...input.manifest }, pathMappings: { ...lockedSession.pathMappings, ...input.pathMappings }, parseErrors: input.parseErrors, updatedAt: new Date() }).where(eq(nativeSessions.id, nativeSessionId));
      return { ingestion: ingestion!, replayed: false };
    });
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
    await this.validateGitSliceReferences(workspaceId, input.startingGitSlice, undefined, taskId);
    await this.validateNativeSessionReferences(workspaceId, input.nativeSession, undefined, taskId);
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
    await this.validateGitSliceReferences(workspaceId, input, runId, run.taskId);
    return this.insertGitSlice(this.database.db, workspaceId, run.taskId, runId, 'checkpoint', user.id, input);
  }

  async attachNativeSession(workspaceId: string, user: AuthUser, runId: string, input: NativeSessionInput) {
    const run = await this.requireRun(workspaceId, user, runId);
    if (run.status !== 'running') throw new ConflictException('A native session cannot be attached after a run has ended.');
    await this.validateNativeSessionReferences(workspaceId, input, runId, run.taskId);
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
    await this.validateGitSliceReferences(workspaceId, input.endingGitSlice, runId, run.taskId);
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

  private async requireNativeSession(workspaceId: string, user: AuthUser, nativeSessionId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [session] = await this.database.db.select().from(nativeSessions).where(and(eq(nativeSessions.id, nativeSessionId), eq(nativeSessions.workspaceId, workspaceId))).limit(1);
    if (!session) throw new NotFoundException('Native session not found.');
    return session;
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

  private async validateGitSliceReferences(workspaceId: string, input?: GitSliceInput, runId?: string, taskId?: string) {
    if (input?.patchArtifactId) await this.requireArtifacts(workspaceId, [input.patchArtifactId]);
    if (input?.patchEvidenceArtifactId) await this.requireEvidenceArtifacts(workspaceId, [input.patchEvidenceArtifactId], runId, taskId);
    if (input?.githubRepositoryId) {
      const [repository] = await this.database.db.select({ fullName: githubRepositories.fullName }).from(githubRepositories).innerJoin(githubConnections, eq(githubRepositories.connectionId, githubConnections.id)).where(and(eq(githubRepositories.id, input.githubRepositoryId), eq(githubConnections.workspaceId, workspaceId))).limit(1);
      if (!repository || repository.fullName !== input.repositoryFullName) throw new BadRequestException('The Git slice repository must belong to this workspace and match repositoryFullName.');
    }
  }

  private async validateNativeSessionReferences(workspaceId: string, input?: NativeSessionInput, runId?: string, taskId?: string) {
    if (input?.archiveArtifactId) await this.requireArtifacts(workspaceId, [input.archiveArtifactId]);
    if (input?.archiveEvidenceArtifactId) await this.requireEvidenceArtifacts(workspaceId, [input.archiveEvidenceArtifactId], runId, taskId);
  }

  private async insertGitSlice(executor: any, workspaceId: string, taskId: string, runId: string, phase: 'start' | 'end' | 'checkpoint', userId: string, input: GitSliceInput) {
    const [slice] = await executor.insert(gitSlices).values({ workspaceId, taskId, runId, phase, githubRepositoryId: input.githubRepositoryId ?? null, repositoryFullName: input.repositoryFullName, baseCommitSha: input.baseCommitSha, headCommitSha: input.headCommitSha, mergeBaseSha: input.mergeBaseSha ?? null, branchName: input.branchName ?? null, includedPaths: input.includedPaths, excludedPaths: input.excludedPaths, diffHash: input.diffHash ?? null, worktreeIdentity: input.worktreeIdentity ?? null, dirtyState: input.dirtyState, patchArtifactId: input.patchArtifactId ?? null, submoduleStates: input.submoduleStates, dependencyLockHashes: input.dependencyLockHashes, createdByUserId: userId }).returning();
    if (input.patchEvidenceArtifactId) await executor.insert(gitSliceEvidence).values({ gitSliceId: slice!.id, evidenceArtifactId: input.patchEvidenceArtifactId, role: 'dirty_patch' }).onConflictDoNothing();
    return slice!;
  }

  private async insertNativeSession(executor: any, workspaceId: string, runId: string, provider: StartRunInput['provider'], input: NativeSessionInput) {
    const [session] = await executor.insert(nativeSessions).values({ workspaceId, runId, provider, nativeSessionId: input.nativeSessionId, parentNativeSessionId: input.parentNativeSessionId ?? null, clientVersion: input.clientVersion ?? null, protocolVersion: input.protocolVersion ?? null, archiveArtifactId: input.archiveArtifactId ?? null, resumability: input.resumability, sourceKind: input.sourceKind, manifest: input.manifest, pathMappings: input.pathMappings, metadata: input.metadata }).onConflictDoNothing().returning();
    const stored = session ?? (await executor.select().from(nativeSessions).where(and(eq(nativeSessions.workspaceId, workspaceId), eq(nativeSessions.provider, provider), eq(nativeSessions.nativeSessionId, input.nativeSessionId))).limit(1))[0];
    if (!stored || stored.runId !== runId) throw new ConflictException('This provider session is already attached to a different execution attempt.');
    if (input.archiveEvidenceArtifactId) await executor.insert(nativeSessionEvidence).values({ nativeSessionId: stored.id, evidenceArtifactId: input.archiveEvidenceArtifactId, role: 'source_archive' }).onConflictDoNothing();
    return stored;
  }

  private overlapWarnings(active: Array<typeof taskLeases.$inferSelect>, input: Pick<ClaimLeaseInput, 'writeAccess' | 'pathScope'>) {
    if (!input.writeAccess) return [];
    const requestedPaths = normalizedPaths(input.pathScope);
    return active.filter((lease) => lease.writeAccess && pathsOverlap(requestedPaths, lease.pathScope)).map((lease) => ({ leaseId: lease.id, runId: lease.runId, machineIdentity: lease.machineIdentity, activity: lease.activity, pathScope: lease.pathScope }));
  }
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function nativeSessionIngestionHash(value: unknown): string {
  const { idempotencyKey: _idempotencyKey, ...content } = value as NativeSessionIngestionInput;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

export function normalizedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean))].sort();
}

export function pathsOverlap(left: string[], right: string[]): boolean {
  if (!left.length || !right.length) return true;
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a.includes('*') || b.includes('*')));
}
