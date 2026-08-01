import { BadRequestException, ConflictException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActivityService } from '../activity.service';
import type { AuthUser } from '../auth';
import { flowSemantics, priorities, projectStatuses, taskSemantics } from '../common/domain';
import { slugify } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import {
  activityEvents,
  checklistItems,
  comments,
  convergenceCriteria,
  flowAllowedProjects,
  flowRelations,
  flows,
  githubIssueLinks,
  githubPullRequests,
  githubRepositories,
  githubTaskPullRequests,
  labelAssignments,
  labels,
  projects,
  projectTaskCounters,
  taskIdentifierAliases,
  taskFlows,
  taskRelations,
  tasks,
  users,
  workflowStates,
  workspaceMemberships,
} from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import { GitHubService } from '../github';
import {
  checklistInput,
  commentInput,
  criterionInput,
  flowInput,
  labelInput,
  projectInput,
  relationInput,
  reviewInput,
  taskInput,
  type FlowListFilters,
  type ProjectListFilters,
  type TaskListFilters,
} from './inputs';
import {
  beforeUpdatedCursor,
  canonicalPair,
  countBy,
  decodeUpdatedCursor,
  paginate,
  requestedLimit,
  selectChanged,
  taskTimestamps,
  type ListPage,
} from './pagination';

import { ResourceCollaborationService } from './collaboration.service';

export class ResourceRelationService extends ResourceCollaborationService {  async createRelation(workspaceId: string, user: AuthUser, kind: 'task' | 'flow', input: z.infer<typeof relationInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    if (input.sourceId === input.targetId) throw new BadRequestException('An item cannot be related to itself.');
    const allowed = kind === 'task' ? ['blocks', 'related', 'duplicate_of'] : ['blocks', 'related', 'replaces', 'merged_into'];
    if (!allowed.includes(input.type)) throw new BadRequestException('Unknown relation type.');
    if (kind === 'task') {
      await this.task(workspaceId, input.sourceId); await this.task(workspaceId, input.targetId);
      const [sourceTaskId, targetTaskId] = input.type === 'related' ? canonicalPair(input.sourceId, input.targetId) : [input.sourceId, input.targetId];
      return this.database.db.transaction(async (tx) => {
        if (input.type === 'blocks') {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`task-blocks:${workspaceId}`}))`);
          if (await this.hasPath(workspaceId, 'task', targetTaskId, sourceTaskId)) throw new BadRequestException('This blocking relation would create a cycle.');
        }
        try {
          const [relation] = await tx.insert(taskRelations).values({ workspaceId, sourceTaskId, targetTaskId, type: input.type as 'blocks' | 'related' | 'duplicate_of', explanation: input.explanation, createdByUserId: user.id }).returning();
          await this.activityService.append(tx, { workspaceId, subjectType: 'task_relation', subjectId: relation!.id, action: 'created', actor: user, after: { sourceTaskId, targetTaskId, type: input.type } });
          return relation;
        } catch (error) {
          throw new ConflictException('That task relation already exists.', { cause: error });
        }
      });
    }
    await this.flow(workspaceId, input.sourceId); await this.flow(workspaceId, input.targetId);
    const [sourceFlowId, targetFlowId] = input.type === 'related' ? canonicalPair(input.sourceId, input.targetId) : [input.sourceId, input.targetId];
    return this.database.db.transaction(async (tx) => {
      if (input.type === 'blocks') {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`flow-blocks:${workspaceId}`}))`);
        if (await this.hasPath(workspaceId, 'flow', targetFlowId, sourceFlowId)) throw new BadRequestException('This blocking relation would create a cycle.');
      }
      try {
        const [relation] = await tx.insert(flowRelations).values({ workspaceId, sourceFlowId, targetFlowId, type: input.type as 'blocks' | 'related' | 'replaces' | 'merged_into', explanation: input.explanation, createdByUserId: user.id }).returning();
        await this.activityService.append(tx, { workspaceId, subjectType: 'flow_relation', subjectId: relation!.id, action: 'created', actor: user, after: { sourceFlowId, targetFlowId, type: input.type } });
        return relation;
      } catch (error) {
        throw new ConflictException('That flow relation already exists.', { cause: error });
      }
    });
  }

  private async hasPath(workspaceId: string, kind: 'task' | 'flow', start: string, goal: string): Promise<boolean> {
    let frontier = [start];
    const visited = new Set<string>();
    for (let depth = 0; frontier.length && depth < 100; depth += 1) {
      if (frontier.includes(goal)) return true;
      frontier = frontier.filter((id) => !visited.has(id));
      frontier.forEach((id) => visited.add(id));
      if (!frontier.length) return false;
      const rows = kind === 'task'
        ? await this.database.db.select({ target: taskRelations.targetTaskId }).from(taskRelations).where(and(eq(taskRelations.workspaceId, workspaceId), eq(taskRelations.type, 'blocks'), inArray(taskRelations.sourceTaskId, frontier)))
        : await this.database.db.select({ target: flowRelations.targetFlowId }).from(flowRelations).where(and(eq(flowRelations.workspaceId, workspaceId), eq(flowRelations.type, 'blocks'), inArray(flowRelations.sourceFlowId, frontier)));
      frontier = rows.map((row) => row.target);
    }
    return false;
  }

  async deleteRelation(workspaceId: string, user: AuthUser, kind: 'task' | 'flow', relationId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const table = kind === 'task' ? taskRelations : flowRelations;
    const deletedRows: any = await this.database.db.delete(table as any).where(and(eq((table as any).id, relationId), eq((table as any).workspaceId, workspaceId))).returning();
    const relation = deletedRows[0];
    if (!relation) throw new NotFoundException('Relation not found.');
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind === 'task' ? 'task_relation' : 'flow_relation', subjectId: relationId, action: 'removed', actor: user, before: relation });
    return { ok: true };
  }

  async softDelete(workspaceId: string, user: AuthUser, kind: 'project' | 'flow' | 'task' | 'label' | 'comment', id: string, version: number) {
    const minimum = kind === 'label' ? 'admin' : 'member';
    await this.workspaces.requireMembership(workspaceId, user, minimum);
    const table = kind === 'project' ? projects : kind === 'flow' ? flows : kind === 'task' ? tasks : kind === 'label' ? labels : comments;
    const [before] = await (this.database.db as any).select().from(table).where(and(eq((table as any).id, id), eq((table as any).workspaceId, workspaceId), isNull((table as any).deletedAt))).limit(1);
    if (!before) throw new NotFoundException(`${kind} not found.`);
    const [deleted] = await (this.database.db as any).update(table).set({ deletedAt: new Date(), deletedByUserId: user.id, version: sql`${(table as any).version} + 1`, updatedAt: new Date() }).where(and(eq((table as any).id, id), eq((table as any).version, version))).returning();
    if (!deleted) throw new PreconditionFailedException({ title: `${kind} was updated elsewhere`, current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind, subjectId: id, action: 'soft_deleted', actor: user, before: { name: before.name ?? before.title ?? before.id } });
    return deleted;
  }

  async restore(workspaceId: string, user: AuthUser, kind: 'project' | 'flow' | 'task' | 'label' | 'comment', id: string, version: number) {
    const minimum = kind === 'label' ? 'admin' : 'member';
    await this.workspaces.requireMembership(workspaceId, user, minimum);
    const table = kind === 'project' ? projects : kind === 'flow' ? flows : kind === 'task' ? tasks : kind === 'label' ? labels : comments;
    const [before] = await (this.database.db as any).select().from(table).where(and(eq((table as any).id, id), eq((table as any).workspaceId, workspaceId))).limit(1);
    if (!before || !before.deletedAt) throw new NotFoundException(`Deleted ${kind} not found.`);
    const [restored] = await (this.database.db as any).update(table).set({ deletedAt: null, deletedByUserId: null, version: sql`${(table as any).version} + 1`, updatedAt: new Date() }).where(and(eq((table as any).id, id), eq((table as any).version, version))).returning();
    if (!restored) throw new PreconditionFailedException({ title: `${kind} was updated elsewhere`, current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind, subjectId: id, action: 'restored', actor: user });
    return restored;
  }

  async listTrash(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const [projectRows, flowRows, taskRows, labelRows, commentRows] = await Promise.all([
      this.database.db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), sql`${projects.deletedAt} IS NOT NULL`)),
      this.database.db.select().from(flows).where(and(eq(flows.workspaceId, workspaceId), sql`${flows.deletedAt} IS NOT NULL`)),
      this.database.db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), sql`${tasks.deletedAt} IS NOT NULL`)),
      this.database.db.select().from(labels).where(and(eq(labels.workspaceId, workspaceId), sql`${labels.deletedAt} IS NOT NULL`)),
      this.database.db.select().from(comments).where(and(eq(comments.workspaceId, workspaceId), sql`${comments.deletedAt} IS NOT NULL`)),
    ]);
    return { projects: projectRows, flows: flowRows, tasks: taskRows, labels: labelRows, comments: commentRows };
  }

  async activity(workspaceId: string, user: AuthUser, after?: number) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(activityEvents).where(and(eq(activityEvents.workspaceId, workspaceId), after ? sql`${activityEvents.sequence} > ${after}` : undefined)).orderBy(asc(activityEvents.sequence)).limit(200);
  }

  async search(workspaceId: string, user: AuthUser, query: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const term = `%${query.trim()}%`;
    if (!query.trim()) return { projects: [], flows: [], tasks: [] };
    const [projectRows, flowRows, taskRows] = await Promise.all([
      this.database.db.select({ id: projects.id, name: projects.name, kind: sql<string>`'project'` }).from(projects).where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt), or(sql`${projects.name} ILIKE ${term}`, sql`${projects.description} ILIKE ${term}`))).limit(20),
      this.database.db.select({ id: flows.id, name: flows.name, kind: sql<string>`'flow'` }).from(flows).where(and(eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt), or(sql`${flows.name} ILIKE ${term}`, sql`${flows.purpose} ILIKE ${term}`))).limit(20),
      this.database.db.select({ id: tasks.id, name: tasks.title, kind: sql<string>`'task'` }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt), or(sql`${tasks.title} ILIKE ${term}`, sql`${tasks.description} ILIKE ${term}`))).limit(20),
    ]);
    return { projects: projectRows, flows: flowRows, tasks: taskRows };
  }

  protected override async taskWarnings(workspaceId: string, task: typeof tasks.$inferSelect, semantic: string): Promise<string[]> {
    const warnings: string[] = [];
    const criteria = await this.database.db.select().from(checklistItems).where(eq(checklistItems.taskId, task.id));
    if (semantic === 'ready') {
      if (!task.description.trim()) warnings.push('The task has no written scope or description.');
      if (!criteria.some((item) => item.kind === 'acceptance')) warnings.push('The task has no acceptance criteria.');
      if (criteria.some((item) => item.kind === 'readiness' && !item.completed)) warnings.push('Not all readiness criteria are complete.');
    }
    if (semantic === 'done') {
      if (criteria.some((item) => item.kind === 'acceptance' && !item.completed) || !criteria.some((item) => item.kind === 'acceptance')) warnings.push('Acceptance criteria are incomplete or absent.');
      if (!task.verificationPerformed.trim()) warnings.push('Verification performed has not been recorded.');
      if (!task.completionEvidence.trim()) warnings.push('Completion evidence has not been recorded.');
      if (task.humanReviewRequired && task.reviewStatus !== 'approved') warnings.push('Required human review is not approved.');
    }
    const blockers = await this.database.db.select({ state: workflowStates }).from(taskRelations).innerJoin(tasks, eq(taskRelations.sourceTaskId, tasks.id)).innerJoin(workflowStates, eq(tasks.workflowStateId, workflowStates.id))
      .where(and(eq(taskRelations.workspaceId, workspaceId), eq(taskRelations.targetTaskId, task.id), eq(taskRelations.type, 'blocks'), isNull(tasks.deletedAt)));
    if (semantic !== 'blocked' && blockers.some((row) => row.state.taskSemantic !== 'done')) warnings.push('The task has unresolved blocking tasks.');
    return warnings;
  }

  protected override async flowWarnings(workspaceId: string, flow: typeof flows.$inferSelect, semantic: string): Promise<string[]> {
    if (semantic !== 'converged') return [];
    const warnings: string[] = [];
    const criteria = await this.database.db.select().from(convergenceCriteria).where(eq(convergenceCriteria.flowId, flow.id));
    if (!criteria.length || criteria.some((criterion) => !criterion.completed)) warnings.push('Flow convergence criteria are incomplete or absent.');
    const blockers = await this.database.db.select({ state: workflowStates }).from(flowRelations).innerJoin(flows, eq(flowRelations.sourceFlowId, flows.id)).innerJoin(workflowStates, eq(flows.workflowStateId, workflowStates.id))
      .where(and(eq(flowRelations.workspaceId, workspaceId), eq(flowRelations.targetFlowId, flow.id), eq(flowRelations.type, 'blocks'), isNull(flows.deletedAt)));
    if (blockers.some((row) => row.state.flowSemantic !== 'converged')) warnings.push('Required blocking flows are unresolved.');
    return warnings;
  }
}

