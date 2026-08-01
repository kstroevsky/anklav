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

import { ResourceTaskService } from './task.service';

export abstract class ResourceCollaborationService extends ResourceTaskService {  async createChecklist(workspaceId: string, user: AuthUser, taskId: string, input: z.infer<typeof checklistInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.task(workspaceId, taskId);
    const [max] = await this.database.db.select({ position: sql<number>`coalesce(max(${checklistItems.position}), -1)` }).from(checklistItems).where(and(eq(checklistItems.taskId, taskId), eq(checklistItems.kind, input.kind)));
    const [item] = await this.database.db.insert(checklistItems).values({ taskId, kind: input.kind, text: input.text, position: input.position ?? (max?.position ?? -1) + 1 }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'checklist_item', subjectId: item!.id, action: 'created', actor: user, after: { taskId, kind: item!.kind, text: item!.text } });
    return item;
  }

  async updateChecklist(workspaceId: string, user: AuthUser, itemId: string, input: Partial<{ text: string; completed: boolean; position: number }>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select({ item: checklistItems, task: tasks }).from(checklistItems).innerJoin(tasks, eq(checklistItems.taskId, tasks.id)).where(and(eq(checklistItems.id, itemId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!before) throw new NotFoundException('Checklist item not found.');
    const [updated] = await this.database.db.update(checklistItems).set({ ...input, updatedAt: new Date() }).where(eq(checklistItems.id, itemId)).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'checklist_item', subjectId: itemId, action: 'updated', actor: user, before: selectChanged(before.item, input), after: selectChanged(updated!, input) });
    return updated;
  }

  async createCriterion(workspaceId: string, user: AuthUser, flowId: string, input: z.infer<typeof criterionInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.flow(workspaceId, flowId);
    const [max] = await this.database.db.select({ position: sql<number>`coalesce(max(${convergenceCriteria.position}), -1)` }).from(convergenceCriteria).where(eq(convergenceCriteria.flowId, flowId));
    const [criterion] = await this.database.db.insert(convergenceCriteria).values({ flowId, text: input.text, position: input.position ?? (max?.position ?? -1) + 1 }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'flow', subjectId: flowId, action: 'convergence_criterion_added', actor: user, after: { criterionId: criterion!.id, text: criterion!.text } });
    return criterion;
  }

  async updateCriterion(workspaceId: string, user: AuthUser, criterionId: string, input: Partial<{ text: string; completed: boolean; position: number }>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select({ criterion: convergenceCriteria, flow: flows }).from(convergenceCriteria).innerJoin(flows, eq(convergenceCriteria.flowId, flows.id)).where(and(eq(convergenceCriteria.id, criterionId), eq(flows.workspaceId, workspaceId))).limit(1);
    if (!before) throw new NotFoundException('Convergence criterion not found.');
    const [updated] = await this.database.db.update(convergenceCriteria).set({ ...input, updatedAt: new Date() }).where(eq(convergenceCriteria.id, criterionId)).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'flow', subjectId: before.flow.id, action: 'convergence_criterion_updated', actor: user, before: selectChanged(before.criterion, input), after: selectChanged(updated!, input) });
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
      await this.activityService.append(this.database.db, { workspaceId, subjectType: 'label', subjectId: label!.id, action: 'created', actor: user, after: { name: label!.name } });
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
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'label', subjectId: labelId, action: 'updated', actor: user, before: selectChanged(before, input), after: selectChanged(updated, input) });
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
    await this.activityService.append(this.database.db, { workspaceId, subjectType: subject, subjectId, action: 'label_added', actor: user, after: { labelId } });
    return { label, assigned: true };
  }

  async unassignLabel(workspaceId: string, user: AuthUser, subject: 'project' | 'flow' | 'task', subjectId: string, labelId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const column = subject === 'project' ? labelAssignments.projectId : subject === 'flow' ? labelAssignments.flowId : labelAssignments.taskId;
    await this.database.db.delete(labelAssignments).where(and(eq(labelAssignments.labelId, labelId), eq(column, subjectId)));
    await this.activityService.append(this.database.db, { workspaceId, subjectType: subject, subjectId, action: 'label_removed', actor: user, before: { labelId } });
    return { ok: true };
  }

  protected override async labelsFor(subject: 'project' | 'flow' | 'task', subjectId: string) {
    const column = subject === 'project' ? labelAssignments.projectId : subject === 'flow' ? labelAssignments.flowId : labelAssignments.taskId;
    return this.database.db.select({ id: labels.id, name: labels.name, color: labels.color, description: labels.description }).from(labelAssignments).innerJoin(labels, eq(labelAssignments.labelId, labels.id)).where(and(eq(column, subjectId), isNull(labels.deletedAt))).orderBy(asc(labels.name));
  }

  async createComment(workspaceId: string, user: AuthUser, subject: 'task' | 'flow', subjectId: string, input: z.infer<typeof commentInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    if (subject === 'task') await this.task(workspaceId, subjectId); else await this.flow(workspaceId, subjectId);
    const [comment] = await this.database.db.insert(comments).values({ workspaceId, subject, taskId: subject === 'task' ? subjectId : null, flowId: subject === 'flow' ? subjectId : null, body: input.body, authorUserId: user.id }).returning();
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'comment', subjectId: comment!.id, action: 'created', actor: user, after: { subject, parentId: subjectId } });
    return comment;
  }

  async updateComment(workspaceId: string, user: AuthUser, commentId: string, version: number, body: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [before] = await this.database.db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId), isNull(comments.deletedAt))).limit(1);
    if (!before) throw new NotFoundException('Comment not found.');
    if (before.authorUserId !== user.id) throw new ConflictException('Only the comment author may edit a comment.');
    const [updated] = await this.database.db.update(comments).set({ body, version: sql`${comments.version} + 1`, updatedAt: new Date() }).where(and(eq(comments.id, commentId), eq(comments.version, version))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Comment was updated elsewhere', current: before });
    await this.activityService.append(this.database.db, { workspaceId, subjectType: 'comment', subjectId: commentId, action: 'edited', actor: user, before: { body: before.body }, after: { body } });
    return updated;
  }

  protected override async commentsFor(subject: 'task' | 'flow', subjectId: string) {
    const column = subject === 'task' ? comments.taskId : comments.flowId;
    return this.database.db.select().from(comments).where(and(eq(column, subjectId), isNull(comments.deletedAt))).orderBy(asc(comments.createdAt));
  }


}

