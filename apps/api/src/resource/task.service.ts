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

import { ResourceProjectFlowService } from './project-flow.service';

export abstract class ResourceTaskService extends ResourceProjectFlowService {  async listTasks(workspaceId: string, user: AuthUser, filters: TaskListFilters): Promise<ListPage<{ task: typeof tasks.$inferSelect; project: typeof projects.$inferSelect; state: typeof workflowStates.$inferSelect }>> {
    await this.workspaces.requireMembership(workspaceId, user);
    const cursor = decodeUpdatedCursor(filters.cursor);
    const terms = [eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)];
    if (filters.q?.trim()) terms.push(or(sql`${tasks.title} ILIKE ${`%${filters.q.trim()}%`}`, sql`${tasks.description} ILIKE ${`%${filters.q.trim()}%`}`)!);
    if (filters.projectId) terms.push(eq(tasks.projectId, filters.projectId));
    if (filters.stateId) terms.push(eq(tasks.workflowStateId, filters.stateId));
    if (filters.priority && priorities.includes(filters.priority as any)) terms.push(eq(tasks.priority, filters.priority as any));
    if (filters.assigneeMembershipId) terms.push(eq(tasks.assigneeMembershipId, filters.assigneeMembershipId));
    let base = this.database.db.select({ task: tasks, project: projects, state: workflowStates }).from(tasks).innerJoin(projects, eq(tasks.projectId, projects.id)).innerJoin(workflowStates, eq(tasks.workflowStateId, workflowStates.id));
    if (filters.flowId) base = base.innerJoin(taskFlows, eq(tasks.id, taskFlows.taskId)) as any;
    if (filters.labelId) base = base.innerJoin(labelAssignments, eq(tasks.id, labelAssignments.taskId)) as any;
    const rows = await (base as any).where(and(
      ...terms,
      filters.flowId ? eq(taskFlows.flowId, filters.flowId) : undefined,
      filters.labelId ? eq(labelAssignments.labelId, filters.labelId) : undefined,
      beforeUpdatedCursor(tasks.updatedAt, tasks.id, cursor),
    )).orderBy(desc(tasks.updatedAt), desc(tasks.id)).limit(requestedLimit(filters.limit) + 1);
    return paginate(rows, requestedLimit(filters.limit), (row) => row.task);
  }

  async getTask(workspaceId: string, user: AuthUser, taskId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const task = await this.task(workspaceId, taskId);
    const [project] = await this.database.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1);
    const [state] = await this.database.db.select().from(workflowStates).where(eq(workflowStates.id, task.workflowStateId)).limit(1);
    const links = await this.database.db.select({ link: taskFlows, flow: flows }).from(taskFlows).innerJoin(flows, eq(taskFlows.flowId, flows.id)).where(and(eq(taskFlows.taskId, task.id), isNull(flows.deletedAt)));
    const checklists = await this.database.db.select().from(checklistItems).where(eq(checklistItems.taskId, task.id)).orderBy(asc(checklistItems.kind), asc(checklistItems.position));
    const relations = await this.database.db.select().from(taskRelations).where(and(eq(taskRelations.workspaceId, workspaceId), or(eq(taskRelations.sourceTaskId, task.id), eq(taskRelations.targetTaskId, task.id))));
    const aliases = await this.database.db.select({ identifier: taskIdentifierAliases.identifier }).from(taskIdentifierAliases).where(eq(taskIdentifierAliases.taskId, task.id));
    const githubIssues = await this.database.db.select({ link: githubIssueLinks, repository: githubRepositories }).from(githubIssueLinks).innerJoin(githubRepositories, eq(githubIssueLinks.repositoryId, githubRepositories.id)).where(eq(githubIssueLinks.taskId, task.id));
    const githubPullRequestLinks = await this.database.db.select({ link: githubTaskPullRequests, pullRequest: githubPullRequests, repository: githubRepositories }).from(githubTaskPullRequests).innerJoin(githubPullRequests, eq(githubTaskPullRequests.pullRequestId, githubPullRequests.id)).innerJoin(githubRepositories, eq(githubPullRequests.repositoryId, githubRepositories.id)).where(eq(githubTaskPullRequests.taskId, task.id));
    return { ...task, identifierAliases: aliases.map((entry) => entry.identifier), project, state, flows: links, checklists, relations, githubIssues: githubIssues.map(({ link, repository }) => ({ ...link, repository })), githubPullRequests: githubPullRequestLinks.map(({ link, pullRequest, repository }) => ({ ...link, pullRequest: { ...pullRequest, repository } })), labels: await this.labelsFor('task', task.id), comments: await this.commentsFor('task', task.id), activity: await this.activityFor(workspaceId, task.id), transitionWarnings: await this.taskWarnings(workspaceId, task, state?.taskSemantic ?? 'inbox') };
  }

  async listTaskEvents(workspaceId: string, user: AuthUser, taskId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const task = await this.task(workspaceId, taskId, true);
    return this.taskEvents.list(this.database.db, workspaceId, task.id);
  }

  async createTask(workspaceId: string, user: AuthUser, input: z.infer<typeof taskInput>, idempotencyKey?: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const outcome = await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, { workspaceId, idempotencyKey, command: { type: 'task.create', input }, actor: user, operation: async () => {
      await this.project(workspaceId, input.projectId);
      const state = await this.state(workspaceId, input.workflowStateId, 'task');
      await this.membership(workspaceId, input.assigneeMembershipId);
      await this.membership(workspaceId, input.reviewerMembershipId);
      if (input.parentTaskId) await this.task(workspaceId, input.parentTaskId);
      const { primaryFlowId, relatedFlowIds, workflowStateId: _, ...values } = input;
      const identity = await this.allocateTaskIdentifier(tx, workspaceId, input.projectId);
      const [task] = await tx.insert(tasks).values({ workspaceId, ...values, ...identity, workflowStateId: state.id, reviewStatus: values.humanReviewRequired ? 'pending' : 'not_required' }).returning();
      await this.linkTaskFlows(workspaceId, task!, user.id, primaryFlowId, relatedFlowIds ?? [], tx);
      await this.activityService.append(tx, { workspaceId, subjectType: 'task', subjectId: task!.id, action: 'created', actor: user, after: { title: task!.title, projectId: task!.projectId } });
      return { aggregateId: task!.id, aggregateVersion: task!.version, eventType: 'task.created', state: task!, result: task! };
    } }));
    const task = outcome.result;
    if (!outcome.replayed) {
      // GitHub writes are asynchronous so a task is never held hostage by a remote outage.
      void this.github.queueTaskSync(workspaceId, task.id, 'created').catch(() => undefined);
    }
    return task;
  }

  async updateTask(workspaceId: string, user: AuthUser, taskId: string, version: number, input: Partial<z.infer<typeof taskInput>>, idempotencyKey?: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const outcome = await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, { workspaceId, idempotencyKey, command: { type: 'task.update', taskId, version, input }, actor: user, operation: async () => {
      const before = await this.task(workspaceId, taskId);
      if (input.projectId) await this.project(workspaceId, input.projectId);
      if (input.workflowStateId) await this.state(workspaceId, input.workflowStateId, 'task');
      await this.membership(workspaceId, input.assigneeMembershipId);
      await this.membership(workspaceId, input.reviewerMembershipId);
      if (input.parentTaskId) await this.ensureValidParent(workspaceId, before.id, input.parentTaskId);
      const { primaryFlowId, relatedFlowIds, workflowStateId: _stateId, ...values } = input;
      const nextState = input.workflowStateId ? await this.state(workspaceId, input.workflowStateId, 'task') : null;
      const timestamps = nextState ? taskTimestamps(nextState.taskSemantic!, before) : {};
      const reviewFields = input.humanReviewRequired === true && !before.humanReviewRequired
        ? { reviewStatus: 'pending' as const, reviewDecidedAt: null, reviewNote: '' }
        : input.humanReviewRequired === false && before.humanReviewRequired
          ? { reviewStatus: 'not_required' as const, reviewDecidedAt: null, reviewNote: '' }
          : {};
      const movedProject = input.projectId && input.projectId !== before.projectId;
      const nextIdentity = movedProject ? await this.allocateTaskIdentifier(tx, workspaceId, input.projectId!) : {};
      const [updated] = await tx.update(tasks).set({ ...values, ...nextIdentity, ...reviewFields, ...timestamps, workflowStateId: nextState?.id, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(and(eq(tasks.id, before.id), eq(tasks.workspaceId, workspaceId), eq(tasks.version, version), isNull(tasks.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Task was updated elsewhere', current: before });
      if (movedProject) await tx.insert(taskIdentifierAliases).values({ workspaceId, taskId: before.id, identifier: before.identifier });
      if (primaryFlowId !== undefined || relatedFlowIds !== undefined) await this.linkTaskFlows(workspaceId, updated!, user.id, primaryFlowId ?? null, relatedFlowIds ?? [], tx);
      const transitionWarnings = nextState ? await this.taskWarnings(workspaceId, updated!, nextState.taskSemantic!) : [];
      await this.activityService.append(tx, { workspaceId, subjectType: 'task', subjectId: before.id, action: nextState ? 'updated_with_status_change' : 'updated', actor: user, before: selectChanged(before, values), after: selectChanged(updated!, values), metadata: transitionWarnings.length ? { transitionWarnings } : {} });
      const result = { ...updated!, transitionWarnings };
      return { aggregateId: updated!.id, aggregateVersion: updated!.version, eventType: nextState ? 'task.status_changed' : 'task.updated', state: updated!, result };
    } }));
    if (!outcome.replayed) void this.github.queueTaskSync(workspaceId, outcome.result.id, 'updated').catch(() => undefined);
    return outcome.result;
  }

  async transitionPreview(workspaceId: string, user: AuthUser, type: 'task' | 'flow', id: string, stateId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const state = await this.state(workspaceId, stateId, type);
    if (type === 'task') return { warnings: await this.taskWarnings(workspaceId, await this.task(workspaceId, id), state.taskSemantic!) };
    return { warnings: await this.flowWarnings(workspaceId, await this.flow(workspaceId, id), state.flowSemantic!) };
  }

  async updateReview(workspaceId: string, user: AuthUser, taskId: string, version: number, input: z.infer<typeof reviewInput>, idempotencyKey?: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const outcome = await this.database.db.transaction(async (tx) => this.taskEvents.execute(tx, { workspaceId, idempotencyKey, command: { type: 'task.review', taskId, version, input }, actor: user, operation: async () => {
      const before = await this.task(workspaceId, taskId);
      if (!before.humanReviewRequired) throw new BadRequestException('Human review is not required for this task.');
      const [updated] = await tx.update(tasks).set({
        reviewStatus: input.reviewStatus, reviewNote: input.reviewNote, reviewDecidedAt: input.reviewStatus === 'pending' ? null : new Date(), version: sql`${tasks.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(tasks.id, before.id), eq(tasks.workspaceId, workspaceId), eq(tasks.version, version), isNull(tasks.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Task was updated elsewhere', current: before });
      await this.activityService.append(tx, { workspaceId, subjectType: 'task', subjectId: before.id, action: 'human_review_updated', actor: user, before: { reviewStatus: before.reviewStatus }, after: { reviewStatus: updated.reviewStatus, reviewNote: input.reviewNote } });
      return { aggregateId: updated.id, aggregateVersion: updated.version, eventType: 'task.review_updated', state: updated, result: updated };
    } }));
    return outcome.result;
  }

  async linkTaskFlows(workspaceId: string, task: typeof tasks.$inferSelect, actorUserId: string, primaryFlowId: string | null | undefined, relatedFlowIds: string[], executor: any = this.database.db) {
    const ids = new Set(relatedFlowIds);
    if (primaryFlowId) ids.delete(primaryFlowId);
    if (primaryFlowId) await this.validateFlowForTask(workspaceId, primaryFlowId, task.projectId);
    for (const id of ids) await this.validateFlowForTask(workspaceId, id, task.projectId);
    await executor.delete(taskFlows).where(eq(taskFlows.taskId, task.id));
    const values = [
      ...(primaryFlowId ? [{ taskId: task.id, flowId: primaryFlowId, role: 'primary' as const, createdByUserId: actorUserId }] : []),
      ...[...ids].map((flowId) => ({ taskId: task.id, flowId, role: 'related' as const, createdByUserId: actorUserId })),
    ];
    if (values.length) await executor.insert(taskFlows).values(values);
  }

  private async validateFlowForTask(workspaceId: string, flowId: string, projectId: string) {
    const flow = await this.flow(workspaceId, flowId);
    if (flow.scope === 'selected_projects') {
      const [allowed] = await this.database.db.select().from(flowAllowedProjects).where(and(eq(flowAllowedProjects.flowId, flowId), eq(flowAllowedProjects.projectId, projectId))).limit(1);
      if (!allowed) throw new BadRequestException('The task project is outside this flow’s allowed-project scope.');
    }
    return flow;
  }

  protected override async ensureTaskLinkedToFlow(workspaceId: string, taskId: string, flowId: string) {
    await this.task(workspaceId, taskId);
    const [link] = await this.database.db.select().from(taskFlows).where(and(eq(taskFlows.taskId, taskId), eq(taskFlows.flowId, flowId))).limit(1);
    if (!link) throw new BadRequestException('The primary current task must be linked to the flow.');
  }

  private async ensureValidParent(workspaceId: string, taskId: string, parentId: string) {
    if (taskId === parentId) throw new BadRequestException('A task cannot be its own parent.');
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 100; depth += 1) {
      const parent = await this.task(workspaceId, cursor);
      if (parent.id === taskId) throw new BadRequestException('The parent task would create a circular hierarchy.');
      cursor = parent.parentTaskId;
    }
    if (cursor) throw new BadRequestException('Task hierarchy depth exceeds the safe limit.');
  }


}
