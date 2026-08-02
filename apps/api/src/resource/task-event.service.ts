import { createHash } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { uuidv7 } from '../common/ids';
import { domainEvents, tasks } from '../db/schema';

type TaskState = typeof tasks.$inferSelect;
type StoredTaskEvent = typeof domainEvents.$inferSelect;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

export function taskCommandHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function reduceTaskEvents(events: Array<Pick<StoredTaskEvent, 'aggregateVersion' | 'payload'>>): Record<string, unknown> {
  if (!events.length) throw new Error('A task projection requires at least one domain event.');
  let state: Record<string, unknown> | null = null;
  let version: number | null = null;
  for (const event of events) {
    if (version !== null && event.aggregateVersion !== version + 1) throw new Error(`Task event versions are not contiguous at version ${event.aggregateVersion}.`);
    const next = event.payload.state;
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`Task event version ${event.aggregateVersion} has no projection state.`);
    state = next as Record<string, unknown>;
    version = event.aggregateVersion;
  }
  return state!;
}

@Injectable()
export class TaskEventService {
  async execute<T>(
    executor: any,
    input: {
      workspaceId: string;
      idempotencyKey?: string;
      command: unknown;
      actor?: AuthUser;
      source?: Record<string, unknown>;
      operation: () => Promise<{
        aggregateId: string;
        aggregateVersion: number;
        eventType: string;
        state: TaskState;
        result: T;
      }>;
    },
  ): Promise<{ result: T; replayed: boolean }> {
    const idempotencyKey = input.idempotencyKey?.trim() || `server:${uuidv7()}`;
    const commandHash = taskCommandHash(input.command);
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`task-command:${input.workspaceId}:${idempotencyKey}`}))`);
    const [existing] = await executor
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.workspaceId, input.workspaceId), eq(domainEvents.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      if (existing.aggregateType !== 'task' || existing.commandHash !== commandHash) throw new ConflictException('The idempotency key is already associated with a different task command.');
      return {
        result: (existing.payload as { result: T }).result,
        replayed: true,
      };
    }

    const produced = await input.operation();
    await executor.insert(domainEvents).values({
      workspaceId: input.workspaceId,
      aggregateType: 'task',
      aggregateId: produced.aggregateId,
      aggregateVersion: produced.aggregateVersion,
      eventType: produced.eventType,
      idempotencyKey,
      commandHash,
      actorUserId: input.actor?.id ?? null,
      source:
        input.source ??
        (input.actor?.mcpClient
          ? {
              type: 'mcp',
              clientId: input.actor.mcpClient.id,
              clientName: input.actor.mcpClient.name,
            }
          : { type: 'http' }),
      payload: {
        state: canonical(produced.state),
        result: canonical(produced.result),
      },
    });
    return { result: produced.result, replayed: false };
  }

  async list(executor: any, workspaceId: string, taskId: string) {
    return executor
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.workspaceId, workspaceId), eq(domainEvents.aggregateType, 'task'), eq(domainEvents.aggregateId, taskId)))
      .orderBy(asc(domainEvents.aggregateVersion));
  }

  async rebuild(executor: any, workspaceId: string, taskId: string): Promise<TaskState> {
    const events = await this.list(executor, workspaceId, taskId);
    if (!events.length) throw new NotFoundException('Task event stream not found.');
    const state = reduceTaskEvents(events);
    await executor.execute(sql`SELECT set_config('anklav.projection_rebuild', 'on', true)`);
    const date = (value: unknown) => (typeof value === 'string' ? new Date(value) : (value as Date | null));
    const [rebuilt] = await executor
      .update(tasks)
      .set({
        projectId: String(state.projectId),
        parentTaskId: state.parentTaskId ? String(state.parentTaskId) : null,
        title: String(state.title),
        taskNumber: Number(state.taskNumber),
        identifier: String(state.identifier),
        description: String(state.description ?? ''),
        objective: String(state.objective ?? ''),
        constraints: Array.isArray(state.constraints) ? state.constraints.map(String) : [],
        riskLevel: String(state.riskLevel ?? 'medium'),
        expectedArtifacts: Array.isArray(state.expectedArtifacts) ? state.expectedArtifacts.map(String) : [],
        targetRepositoryId: state.targetRepositoryId ? String(state.targetRepositoryId) : null,
        targetBranch: String(state.targetBranch ?? ''),
        includedPaths: Array.isArray(state.includedPaths) ? state.includedPaths.map(String) : [],
        excludedPaths: Array.isArray(state.excludedPaths) ? state.excludedPaths.map(String) : [],
        contextPolicy: state.contextPolicy && typeof state.contextPolicy === 'object' && !Array.isArray(state.contextPolicy) ? state.contextPolicy : {},
        memoryMode: String(state.memoryMode ?? 'project'),
        requiredApprovals: Array.isArray(state.requiredApprovals) ? state.requiredApprovals.map(String) : [],
        coordinatingMembershipId: state.coordinatingMembershipId ? String(state.coordinatingMembershipId) : null,
        workflowStateId: String(state.workflowStateId),
        priority: state.priority as TaskState['priority'],
        assigneeMembershipId: state.assigneeMembershipId ? String(state.assigneeMembershipId) : null,
        dueDate: state.dueDate ? String(state.dueDate) : null,
        humanReviewRequired: Boolean(state.humanReviewRequired),
        reviewStatus: state.reviewStatus as TaskState['reviewStatus'],
        reviewerMembershipId: state.reviewerMembershipId ? String(state.reviewerMembershipId) : null,
        reviewDecidedAt: date(state.reviewDecidedAt),
        reviewNote: String(state.reviewNote ?? ''),
        verificationPerformed: String(state.verificationPerformed ?? ''),
        verificationRequirements: String(state.verificationRequirements ?? ''),
        completionEvidence: String(state.completionEvidence ?? ''),
        nonGoals: String(state.nonGoals ?? ''),
        remainingLimitations: String(state.remainingLimitations ?? ''),
        followUpWork: String(state.followUpWork ?? ''),
        startedAt: date(state.startedAt),
        completedAt: date(state.completedAt),
        cancelledAt: date(state.cancelledAt),
        version: Number(state.version),
        deletedAt: date(state.deletedAt),
        deletedByUserId: state.deletedByUserId ? String(state.deletedByUserId) : null,
        updatedAt: date(state.updatedAt) ?? new Date(),
      })
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId)))
      .returning();
    if (!rebuilt) throw new NotFoundException('Task projection not found.');
    return rebuilt;
  }
}
