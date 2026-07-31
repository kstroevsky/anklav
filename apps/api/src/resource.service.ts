import { BadRequestException, ConflictException, Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActivityService } from './activity.service';
import type { AuthUser } from './auth';
import { flowSemantics, priorities, projectStatuses, taskSemantics } from './common/domain';
import { DatabaseService } from './db/database.service';
import {
  activityEvents,
  checklistItems,
  comments,
  convergenceCriteria,
  flowAllowedProjects,
  flowRelations,
  flows,
  labelAssignments,
  labels,
  projects,
  taskFlows,
  taskRelations,
  tasks,
  workflowStates,
  workspaceMemberships,
} from './db/schema';
import { WorkspaceService } from './workspace.service';

const markdown = z.string().max(100_000);
const optionalId = z.string().uuid().nullable().optional();

export const projectInput = z.object({
  name: z.string().trim().min(1).max(160),
  description: markdown.optional(),
  status: z.enum(projectStatuses).optional(),
  priority: z.enum(priorities).optional(),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track'] as const).optional(),
  currentFocus: markdown.optional(),
  currentStateSummary: markdown.optional(),
  repositoryReference: z.string().max(2_000).optional(),
});

export const flowInput = z.object({
  name: z.string().trim().min(1).max(160),
  purpose: markdown.optional(),
  workflowStateId: z.string().uuid().optional(),
  priority: z.enum(priorities).optional(),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track'] as const).optional(),
  currentFocus: markdown.optional(),
  currentStateSummary: markdown.optional(),
  importantFindings: markdown.optional(),
  nextRecommendedAction: markdown.optional(),
  scope: z.enum(['all_projects', 'selected_projects']).optional(),
  allowedProjectIds: z.array(z.string().uuid()).max(100).optional(),
  responsibleMembershipId: optionalId,
  primaryCurrentTaskId: optionalId,
});

export const taskInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: markdown.optional(),
  workflowStateId: z.string().uuid().optional(),
  priority: z.enum(priorities).optional(),
  assigneeMembershipId: optionalId,
  dueDate: z.string().date().nullable().optional(),
  parentTaskId: optionalId,
  primaryFlowId: optionalId,
  relatedFlowIds: z.array(z.string().uuid()).max(100).optional(),
  humanReviewRequired: z.boolean().optional(),
  reviewerMembershipId: optionalId,
  verificationPerformed: markdown.optional(),
  completionEvidence: markdown.optional(),
  remainingLimitations: markdown.optional(),
  followUpWork: markdown.optional(),
});

export const labelInput = z.object({ name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), description: z.string().max(2_000).optional() });
export const checklistInput = z.object({ kind: z.enum(['readiness', 'acceptance']), text: z.string().trim().min(1).max(5_000), position: z.number().int().min(0).optional() });
export const criterionInput = z.object({ text: z.string().trim().min(1).max(5_000), position: z.number().int().min(0).optional() });
export const commentInput = z.object({ body: markdown.min(1) });
export const relationInput = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid(), type: z.string(), explanation: z.string().max(5_000).optional().default('') });
export const reviewInput = z.object({ reviewStatus: z.enum(['pending', 'approved', 'changes_requested']), reviewNote: markdown.optional().default('') });

@Injectable()
export class ResourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaces: WorkspaceService,
    private readonly activityService: ActivityService,
  ) {}

  private async state(workspaceId: string, id: string | undefined, entityType: 'task' | 'flow') {
    const conditions = [eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, entityType), isNull(workflowStates.archivedAt)];
    if (id) conditions.push(eq(workflowStates.id, id)); else conditions.push(eq(workflowStates.isInitial, true));
    const [state] = await this.database.db.select().from(workflowStates).where(and(...conditions)).limit(1);
    if (!state) throw new BadRequestException(`A valid ${entityType} workflow state is required.`);
    return state;
  }

  private async project(workspaceId: string, projectId: string, includeDeleted = false) {
    const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), includeDeleted ? undefined : isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  private async flow(workspaceId: string, flowId: string, includeDeleted = false) {
    const [flow] = await this.database.db.select().from(flows).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), includeDeleted ? undefined : isNull(flows.deletedAt))).limit(1);
    if (!flow) throw new NotFoundException('Flow not found.');
    return flow;
  }

  private async task(workspaceId: string, taskId: string, includeDeleted = false) {
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), includeDeleted ? undefined : isNull(tasks.deletedAt))).limit(1);
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async membership(workspaceId: string, membershipId: string | null | undefined) {
    if (!membershipId) return null;
    const [membership] = await this.database.db.select().from(workspaceMemberships).where(and(eq(workspaceMemberships.id, membershipId), eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.active, true))).limit(1);
    if (!membership) throw new BadRequestException('The selected assignee or responsible member is not active in this workspace.');
    return membership;
  }

  private async activityFor(workspaceId: string, subjectId: string) {
    return this.database.db.select().from(activityEvents).where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.subjectId, subjectId))).orderBy(desc(activityEvents.sequence)).limit(100);
  }

  async listProjects(workspaceId: string, user: AuthUser, query?: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const textFilter = query?.trim() ? or(sql`${projects.name} ILIKE ${`%${query.trim()}%`}`, sql`${projects.description} ILIKE ${`%${query.trim()}%`}`) : undefined;
    return this.database.db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt), textFilter)).orderBy(asc(projects.name));
  }

  async getProject(workspaceId: string, user: AuthUser, projectId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const project = await this.project(workspaceId, projectId);
    const projectTasks = await this.database.db.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).orderBy(desc(tasks.updatedAt));
    const links = await this.database.db.select({ flow: flows, role: taskFlows.role }).from(taskFlows).innerJoin(tasks, eq(taskFlows.taskId, tasks.id)).innerJoin(flows, eq(taskFlows.flowId, flows.id))
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(flows.deletedAt)));
    const activeFlows = Array.from(new Map(links.map((item) => [item.flow.id, item.flow])).values());
    return { ...project, tasks: projectTasks, flows: activeFlows, labels: await this.labelsFor('project', projectId), activity: await this.activityFor(workspaceId, projectId) };
  }

  async createProject(workspaceId: string, user: AuthUser, input: z.infer<typeof projectInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    const [project] = await this.database.db.insert(projects).values({ workspaceId, ...input }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'project', subjectId: project!.id, action: 'created', actorUserId: user.id, after: { name: project!.name } });
    return project;
  }

  async updateProject(workspaceId: string, user: AuthUser, projectId: string, version: number, input: Partial<z.infer<typeof projectInput>>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.project(workspaceId, projectId);
    const [updated] = await this.database.db.update(projects).set({ ...input, version: sql`${projects.version} + 1`, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), eq(projects.version, version), isNull(projects.deletedAt))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Project was updated elsewhere', current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'project', subjectId: projectId, action: 'updated', actorUserId: user.id, before: selectChanged(before, input), after: selectChanged(updated, input) });
    return updated;
  }

  async listFlows(workspaceId: string, user: AuthUser, query?: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const textFilter = query?.trim() ? or(sql`${flows.name} ILIKE ${`%${query.trim()}%`}`, sql`${flows.purpose} ILIKE ${`%${query.trim()}%`}`) : undefined;
    return this.database.db.select({ flow: flows, state: workflowStates }).from(flows).innerJoin(workflowStates, eq(flows.workflowStateId, workflowStates.id))
      .where(and(eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt), textFilter)).orderBy(asc(flows.name));
  }

  async getFlow(workspaceId: string, user: AuthUser, flowId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const flow = await this.flow(workspaceId, flowId);
    const [state] = await this.database.db.select().from(workflowStates).where(eq(workflowStates.id, flow.workflowStateId)).limit(1);
    const linkedTasks = await this.database.db.select({ task: tasks, role: taskFlows.role, project: projects, state: workflowStates }).from(taskFlows)
      .innerJoin(tasks, eq(taskFlows.taskId, tasks.id)).innerJoin(projects, eq(tasks.projectId, projects.id)).innerJoin(workflowStates, eq(tasks.workflowStateId, workflowStates.id))
      .where(and(eq(taskFlows.flowId, flowId), isNull(tasks.deletedAt))).orderBy(asc(projects.name), desc(tasks.updatedAt));
    const criteria = await this.database.db.select().from(convergenceCriteria).where(eq(convergenceCriteria.flowId, flowId)).orderBy(asc(convergenceCriteria.position));
    const blockers = await this.database.db.select({ relation: flowRelations, flow: flows, state: workflowStates }).from(flowRelations).innerJoin(flows, eq(flowRelations.sourceFlowId, flows.id)).innerJoin(workflowStates, eq(flows.workflowStateId, workflowStates.id))
      .where(and(eq(flowRelations.targetFlowId, flowId), eq(flowRelations.type, 'blocks'), isNull(flows.deletedAt)));
    const projectsInFlow = Array.from(new Map(linkedTasks.map(({ project }) => [project.id, project])).values());
    const warnings = await this.flowWarnings(workspaceId, flow, state?.flowSemantic ?? 'proposed');
    return {
      ...flow,
      state,
      tasks: linkedTasks,
      criteria,
      blockers,
      participatingProjects: projectsInFlow,
      allowedProjects: await this.database.db.select({ id: projects.id, name: projects.name }).from(flowAllowedProjects).innerJoin(projects, eq(flowAllowedProjects.projectId, projects.id)).where(eq(flowAllowedProjects.flowId, flowId)),
      labels: await this.labelsFor('flow', flowId),
      activity: await this.activityFor(workspaceId, flowId),
      signals: { criteria: { completed: criteria.filter((item) => item.completed).length, total: criteria.length }, taskStates: countBy(linkedTasks, (item) => item.state.taskSemantic), unresolvedBlockers: blockers.filter((item) => item.state.flowSemantic !== 'converged').length, transitionWarnings: warnings },
    };
  }

  async createFlow(workspaceId: string, user: AuthUser, input: z.infer<typeof flowInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const state = await this.state(workspaceId, input.workflowStateId, 'flow');
    await this.membership(workspaceId, input.responsibleMembershipId);
    if (input.scope === 'selected_projects' && !(input.allowedProjectIds?.length)) throw new BadRequestException('A selected-project flow requires at least one allowed project.');
    for (const projectId of input.allowedProjectIds ?? []) await this.project(workspaceId, projectId);
    const { allowedProjectIds, workflowStateId: _, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const [flow] = await tx.insert(flows).values({ workspaceId, ...values, workflowStateId: state.id }).returning();
      if (allowedProjectIds?.length) await tx.insert(flowAllowedProjects).values(allowedProjectIds.map((projectId) => ({ flowId: flow!.id, projectId })));
      await this.activityService.append(tx, { workspaceId, subjectType: 'flow', subjectId: flow!.id, action: 'created', actorUserId: user.id, after: { name: flow!.name } });
      return flow;
    });
  }

  async updateFlow(workspaceId: string, user: AuthUser, flowId: string, version: number, input: Partial<z.infer<typeof flowInput>>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.flow(workspaceId, flowId);
    if (input.workflowStateId) await this.state(workspaceId, input.workflowStateId, 'flow');
    await this.membership(workspaceId, input.responsibleMembershipId);
    if (input.primaryCurrentTaskId) await this.ensureTaskLinkedToFlow(workspaceId, input.primaryCurrentTaskId, flowId);
    if (input.scope === 'selected_projects' && !(input.allowedProjectIds?.length)) throw new BadRequestException('A selected-project flow requires allowed projects.');
    for (const projectId of input.allowedProjectIds ?? []) await this.project(workspaceId, projectId);
    const { allowedProjectIds, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx.update(flows).set({ ...values, version: sql`${flows.version} + 1`, updatedAt: new Date() }).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), eq(flows.version, version), isNull(flows.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Flow was updated elsewhere', current: before });
      if (allowedProjectIds) {
        await tx.delete(flowAllowedProjects).where(eq(flowAllowedProjects.flowId, flowId));
        if (allowedProjectIds.length) await tx.insert(flowAllowedProjects).values(allowedProjectIds.map((projectId) => ({ flowId, projectId })));
      }
      await this.activityService.append(tx, { workspaceId, subjectType: 'flow', subjectId: flowId, action: 'updated', actorUserId: user.id, before: selectChanged(before, values), after: selectChanged(updated, values) });
      return updated;
    });
  }

  async listTasks(workspaceId: string, user: AuthUser, filters: { q?: string; projectId?: string; flowId?: string; stateId?: string; priority?: string; assigneeMembershipId?: string; labelId?: string }) {
    await this.workspaces.requireMembership(workspaceId, user);
    const terms = [eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)];
    if (filters.q?.trim()) terms.push(or(sql`${tasks.title} ILIKE ${`%${filters.q.trim()}%`}`, sql`${tasks.description} ILIKE ${`%${filters.q.trim()}%`}`)!);
    if (filters.projectId) terms.push(eq(tasks.projectId, filters.projectId));
    if (filters.stateId) terms.push(eq(tasks.workflowStateId, filters.stateId));
    if (filters.priority && priorities.includes(filters.priority as any)) terms.push(eq(tasks.priority, filters.priority as any));
    if (filters.assigneeMembershipId) terms.push(eq(tasks.assigneeMembershipId, filters.assigneeMembershipId));
    let base = this.database.db.select({ task: tasks, project: projects, state: workflowStates }).from(tasks).innerJoin(projects, eq(tasks.projectId, projects.id)).innerJoin(workflowStates, eq(tasks.workflowStateId, workflowStates.id));
    if (filters.flowId) base = base.innerJoin(taskFlows, eq(tasks.id, taskFlows.taskId)) as any;
    if (filters.labelId) base = base.innerJoin(labelAssignments, eq(tasks.id, labelAssignments.taskId)) as any;
    return (base as any).where(and(...terms, filters.flowId ? eq(taskFlows.flowId, filters.flowId) : undefined, filters.labelId ? eq(labelAssignments.labelId, filters.labelId) : undefined)).orderBy(desc(tasks.updatedAt));
  }

  async getTask(workspaceId: string, user: AuthUser, taskId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const task = await this.task(workspaceId, taskId);
    const [project] = await this.database.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1);
    const [state] = await this.database.db.select().from(workflowStates).where(eq(workflowStates.id, task.workflowStateId)).limit(1);
    const links = await this.database.db.select({ link: taskFlows, flow: flows }).from(taskFlows).innerJoin(flows, eq(taskFlows.flowId, flows.id)).where(and(eq(taskFlows.taskId, taskId), isNull(flows.deletedAt)));
    const checklists = await this.database.db.select().from(checklistItems).where(eq(checklistItems.taskId, taskId)).orderBy(asc(checklistItems.kind), asc(checklistItems.position));
    const relations = await this.database.db.select().from(taskRelations).where(and(eq(taskRelations.workspaceId, workspaceId), or(eq(taskRelations.sourceTaskId, taskId), eq(taskRelations.targetTaskId, taskId))));
    return { ...task, project, state, flows: links, checklists, relations, labels: await this.labelsFor('task', taskId), comments: await this.commentsFor('task', taskId), activity: await this.activityFor(workspaceId, taskId), transitionWarnings: await this.taskWarnings(workspaceId, task, state?.taskSemantic ?? 'inbox') };
  }

  async createTask(workspaceId: string, user: AuthUser, input: z.infer<typeof taskInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.project(workspaceId, input.projectId);
    const state = await this.state(workspaceId, input.workflowStateId, 'task');
    await this.membership(workspaceId, input.assigneeMembershipId);
    await this.membership(workspaceId, input.reviewerMembershipId);
    if (input.parentTaskId) await this.task(workspaceId, input.parentTaskId);
    const { primaryFlowId, relatedFlowIds, workflowStateId: _, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const [task] = await tx.insert(tasks).values({ workspaceId, ...values, workflowStateId: state.id, reviewStatus: values.humanReviewRequired ? 'pending' : 'not_required' }).returning();
      await this.linkTaskFlows(workspaceId, task!, user.id, primaryFlowId, relatedFlowIds ?? [], tx);
      await this.activityService.append(tx, { workspaceId, subjectType: 'task', subjectId: task!.id, action: 'created', actorUserId: user.id, after: { title: task!.title, projectId: task!.projectId } });
      return task;
    });
  }

  async updateTask(workspaceId: string, user: AuthUser, taskId: string, version: number, input: Partial<z.infer<typeof taskInput>>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.task(workspaceId, taskId);
    if (input.projectId) await this.project(workspaceId, input.projectId);
    if (input.workflowStateId) await this.state(workspaceId, input.workflowStateId, 'task');
    await this.membership(workspaceId, input.assigneeMembershipId);
    await this.membership(workspaceId, input.reviewerMembershipId);
    if (input.parentTaskId) await this.ensureValidParent(workspaceId, taskId, input.parentTaskId);
    const { primaryFlowId, relatedFlowIds, workflowStateId: _stateId, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const nextState = input.workflowStateId ? await this.state(workspaceId, input.workflowStateId, 'task') : null;
      const timestamps = nextState ? taskTimestamps(nextState.taskSemantic!, before) : {};
      const [updated] = await tx.update(tasks).set({ ...values, ...timestamps, workflowStateId: nextState?.id, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.version, version), isNull(tasks.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Task was updated elsewhere', current: before });
      if (primaryFlowId !== undefined || relatedFlowIds !== undefined) await this.linkTaskFlows(workspaceId, updated!, user.id, primaryFlowId ?? null, relatedFlowIds ?? [], tx);
      const transitionWarnings = nextState ? await this.taskWarnings(workspaceId, updated!, nextState.taskSemantic!) : [];
      await this.activityService.append(tx, { workspaceId, subjectType: 'task', subjectId: taskId, action: nextState ? 'updated_with_status_change' : 'updated', actorUserId: user.id, before: selectChanged(before, values), after: selectChanged(updated!, values), metadata: transitionWarnings.length ? { transitionWarnings } : {} });
      return { ...updated, transitionWarnings };
    });
  }

  async transitionPreview(workspaceId: string, user: AuthUser, type: 'task' | 'flow', id: string, stateId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const state = await this.state(workspaceId, stateId, type);
    if (type === 'task') return { warnings: await this.taskWarnings(workspaceId, await this.task(workspaceId, id), state.taskSemantic!) };
    return { warnings: await this.flowWarnings(workspaceId, await this.flow(workspaceId, id), state.flowSemantic!) };
  }

  async updateReview(workspaceId: string, user: AuthUser, taskId: string, version: number, input: z.infer<typeof reviewInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.task(workspaceId, taskId);
    if (!before.humanReviewRequired) throw new BadRequestException('Human review is not required for this task.');
    const [updated] = await this.database.db.update(tasks).set({
      reviewStatus: input.reviewStatus,
      reviewNote: input.reviewNote,
      reviewDecidedAt: input.reviewStatus === 'pending' ? null : new Date(),
      version: sql`${tasks.version} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.version, version), isNull(tasks.deletedAt))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Task was updated elsewhere', current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'task', subjectId: taskId, action: 'human_review_updated', actorUserId: user.id, before: { reviewStatus: before.reviewStatus }, after: { reviewStatus: updated.reviewStatus, reviewNote: input.reviewNote } });
    return updated;
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

  private async ensureTaskLinkedToFlow(workspaceId: string, taskId: string, flowId: string) {
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

  async createChecklist(workspaceId: string, user: AuthUser, taskId: string, input: z.infer<typeof checklistInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.task(workspaceId, taskId);
    const [max] = await this.database.db.select({ position: sql<number>`coalesce(max(${checklistItems.position}), -1)` }).from(checklistItems).where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.kind, input.kind)));
    const [item] = await this.database.db.insert(checklistItems).values({ taskId, kind: input.kind, text: input.text, position: input.position ?? (max?.position ?? -1) + 1 }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'checklist_item', subjectId: item!.id, action: 'created', actorUserId: user.id, after: { taskId, kind: item!.kind, text: item!.text } });
    return item;
  }

  async updateChecklist(workspaceId: string, user: AuthUser, itemId: string, input: Partial<{ text: string; completed: boolean; position: number }>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select({ item: checklistItems, task: tasks }).from(checklistItems).innerJoin(tasks, eq(checklistItems.taskId, tasks.id)).where(and(eq(checklistItems.id, itemId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!before) throw new NotFoundException('Checklist item not found.');
    const [updated] = await this.database.db.update(checklistItems).set({ ...input, updatedAt: new Date() }).where(eq(checklistItems.id, itemId)).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'checklist_item', subjectId: itemId, action: 'updated', actorUserId: user.id, before: selectChanged(before.item, input), after: selectChanged(updated!, input) });
    return updated;
  }

  async createCriterion(workspaceId: string, user: AuthUser, flowId: string, input: z.infer<typeof criterionInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.flow(workspaceId, flowId);
    const [max] = await this.database.db.select({ position: sql<number>`coalesce(max(${convergenceCriteria.position}), -1)` }).from(convergenceCriteria).where(eq(convergenceCriteria.flowId, flowId));
    const [criterion] = await this.database.db.insert(convergenceCriteria).values({ flowId, text: input.text, position: input.position ?? (max?.position ?? -1) + 1 }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'flow', subjectId: flowId, action: 'convergence_criterion_added', actorUserId: user.id, after: { criterionId: criterion!.id, text: criterion!.text } });
    return criterion;
  }

  async updateCriterion(workspaceId: string, user: AuthUser, criterionId: string, input: Partial<{ text: string; completed: boolean; position: number }>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select({ criterion: convergenceCriteria, flow: flows }).from(convergenceCriteria).innerJoin(flows, eq(convergenceCriteria.flowId, flows.id)).where(and(eq(convergenceCriteria.id, criterionId), eq(flows.workspaceId, workspaceId))).limit(1);
    if (!before) throw new NotFoundException('Convergence criterion not found.');
    const [updated] = await this.database.db.update(convergenceCriteria).set({ ...input, updatedAt: new Date() }).where(eq(convergenceCriteria.id, criterionId)).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'flow', subjectId: before.flow.id, action: 'convergence_criterion_updated', actorUserId: user.id, before: selectChanged(before.criterion, input), after: selectChanged(updated!, input) });
    return updated;
  }

  async listLabels(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(labels).where(and(eq(labels.workspaceId, workspaceId), isNull(labels.deletedAt))).orderBy(asc(labels.name));
  }

  async createLabel(workspaceId: string, user: AuthUser, input: z.infer<typeof labelInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    try {
      const [label] = await this.database.db.insert(labels).values({ workspaceId, ...input }).returning();
      await this.activityService.append(this.database.db, { workspaceId, subjectType: 'label', subjectId: label!.id, action: 'created', actorUserId: user.id, after: { name: label!.name } });
      return label;
    } catch (error) {
      throw new ConflictException('A label with that name already exists in this workspace.', { cause: error });
    }
  }

  async updateLabel(workspaceId: string, user: AuthUser, labelId: string, version: number, input: Partial<z.infer<typeof labelInput>>) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const [before] = await this.database.db.select().from(labels).where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId), isNull(labels.deletedAt))).limit(1);
    if (!before) throw new NotFoundException('Label not found.');
    const [updated] = await this.database.db.update(labels).set({ ...input, version: sql`${labels.version} + 1`, updatedAt: new Date() }).where(and(eq(labels.id, labelId), eq(labels.version, version))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Label was updated elsewhere', current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'label', subjectId: labelId, action: 'updated', actorUserId: user.id, before: selectChanged(before, input), after: selectChanged(updated, input) });
    return updated;
  }

  async assignLabel(workspaceId: string, user: AuthUser, subject: 'project' | 'flow' | 'task', subjectId: string, labelId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [label] = await this.database.db.select().from(labels).where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId), isNull(labels.deletedAt))).limit(1);
    if (!label) throw new NotFoundException('Label not found.');
    if (subject === 'project') await this.project(workspaceId, subjectId);
    if (subject === 'flow') await this.flow(workspaceId, subjectId);
    if (subject === 'task') await this.task(workspaceId, subjectId);
    const values = { labelId, projectId: subject === 'project' ? subjectId : null, flowId: subject === 'flow' ? subjectId : null, taskId: subject === 'task' ? subjectId : null };
    const existing = await this.labelsFor(subject, subjectId);
    if (existing.some((entry) => entry.id === labelId)) return { label, assigned: false };
    await this.database.db.insert(labelAssignments).values(values);
    await this.activityService.append(this.database.db, { workspaceId, subjectType: subject, subjectId, action: 'label_added', actorUserId: user.id, after: { labelId } });
    return { label, assigned: true };
  }

  async unassignLabel(workspaceId: string, user: AuthUser, subject: 'project' | 'flow' | 'task', subjectId: string, labelId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const column = subject === 'project' ? labelAssignments.projectId : subject === 'flow' ? labelAssignments.flowId : labelAssignments.taskId;
    await this.database.db.delete(labelAssignments).where(and(eq(labelAssignments.labelId, labelId), eq(column, subjectId)));
    await this.activityService.append(this.database.db, { workspaceId, subjectType: subject, subjectId, action: 'label_removed', actorUserId: user.id, before: { labelId } });
    return { ok: true };
  }

  private async labelsFor(subject: 'project' | 'flow' | 'task', subjectId: string) {
    const column = subject === 'project' ? labelAssignments.projectId : subject === 'flow' ? labelAssignments.flowId : labelAssignments.taskId;
    return this.database.db.select({ id: labels.id, name: labels.name, color: labels.color, description: labels.description }).from(labelAssignments).innerJoin(labels, eq(labelAssignments.labelId, labels.id)).where(and(eq(column, subjectId), isNull(labels.deletedAt))).orderBy(asc(labels.name));
  }

  async createComment(workspaceId: string, user: AuthUser, subject: 'task' | 'flow', subjectId: string, input: z.infer<typeof commentInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    if (subject === 'task') await this.task(workspaceId, subjectId); else await this.flow(workspaceId, subjectId);
    const [comment] = await this.database.db.insert(comments).values({ workspaceId, subject, taskId: subject === 'task' ? subjectId : null, flowId: subject === 'flow' ? subjectId : null, body: input.body, authorUserId: user.id }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'comment', subjectId: comment!.id, action: 'created', actorUserId: user.id, after: { subject, parentId: subjectId } });
    return comment;
  }

  async updateComment(workspaceId: string, user: AuthUser, commentId: string, version: number, body: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId), isNull(comments.deletedAt))).limit(1);
    if (!before) throw new NotFoundException('Comment not found.');
    if (before.authorUserId !== user.id) throw new ConflictException('Only the comment author may edit a comment.');
    const [updated] = await this.database.db.update(comments).set({ body, version: sql`${comments.version} + 1`, updatedAt: new Date() }).where(and(eq(comments.id, commentId), eq(comments.version, version))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Comment was updated elsewhere', current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'comment', subjectId: commentId, action: 'edited', actorUserId: user.id, before: { body: before.body }, after: { body } });
    return updated;
  }

  private async commentsFor(subject: 'task' | 'flow', subjectId: string) {
    const column = subject === 'task' ? comments.taskId : comments.flowId;
    return this.database.db.select().from(comments).where(and(eq(column, subjectId), isNull(comments.deletedAt))).orderBy(asc(comments.createdAt));
  }

  async createRelation(workspaceId: string, user: AuthUser, kind: 'task' | 'flow', input: z.infer<typeof relationInput>) {
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
          await this.activityService.append(tx, { workspaceId, subjectType: 'task_relation', subjectId: relation!.id, action: 'created', actorUserId: user.id, after: { sourceTaskId, targetTaskId, type: input.type } });
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
        await this.activityService.append(tx, { workspaceId, subjectType: 'flow_relation', subjectId: relation!.id, action: 'created', actorUserId: user.id, after: { sourceFlowId, targetFlowId, type: input.type } });
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
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind === 'task' ? 'task_relation' : 'flow_relation', subjectId: relationId, action: 'removed', actorUserId: user.id, before: relation });
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
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind, subjectId: id, action: 'soft_deleted', actorUserId: user.id, before: { name: before.name ?? before.title ?? before.id } });
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
    await this.activityService.append(this.database.db, { workspaceId, subjectType: kind, subjectId: id, action: 'restored', actorUserId: user.id });
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

  private async taskWarnings(workspaceId: string, task: typeof tasks.$inferSelect, semantic: string): Promise<string[]> {
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

  private async flowWarnings(workspaceId: string, flow: typeof flows.$inferSelect, semantic: string): Promise<string[]> {
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

function selectChanged(record: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(input).map((key) => [key, record[key]]));
}

function canonicalPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

function countBy<T>(items: T[], key: (item: T) => string | null): Record<string, number> {
  return items.reduce<Record<string, number>>((total, item) => {
    const value = key(item) ?? 'unknown';
    total[value] = (total[value] ?? 0) + 1;
    return total;
  }, {});
}

function taskTimestamps(semantic: string, current: typeof tasks.$inferSelect) {
  if (semantic === 'in_progress' && !current.startedAt) return { startedAt: new Date(), completedAt: current.completedAt };
  if (semantic === 'done') return { startedAt: current.startedAt ?? new Date(), completedAt: new Date() };
  if (current.completedAt) return { completedAt: null };
  return {};
}
