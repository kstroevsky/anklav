import { BadRequestException, ConflictException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActivityService } from '../activity.service';
import type { AuthUser } from '../auth';
import { flowSemantics, priorities, projectStatuses, taskSemantics } from '../common/domain';
import { slugify } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import { activityEvents, checklistItems, comments, convergenceCriteria, flowAllowedProjects, flowRelations, flows, githubIssueLinks, githubPullRequests, githubRepositories, githubTaskPullRequests, labelAssignments, labels, projects, repositories, projectTaskCounters, taskIdentifierAliases, taskFlows, taskRelations, tasks, users, workflowStates, workspaceMemberships } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import { GitHubService } from '../github';
import { TaskEventService } from './task-event.service';
import { checklistInput, commentInput, criterionInput, flowInput, labelInput, projectInput, relationInput, reviewInput, taskInput, type FlowListFilters, type ProjectListFilters, type TaskListFilters } from './inputs';
import { beforeUpdatedCursor, canonicalPair, countBy, decodeUpdatedCursor, paginate, requestedLimit, selectChanged, taskTimestamps, type ListPage } from './pagination';

export abstract class ResourceBase {
  constructor(
    protected readonly database: DatabaseService,
    protected readonly workspaces: WorkspaceService,
    protected readonly activityService: ActivityService,
    protected readonly github: GitHubService,
    protected readonly taskEvents: TaskEventService,
  ) {}

  protected async state(workspaceId: string, id: string | undefined, entityType: 'task' | 'flow') {
    const conditions = [eq(workflowStates.workspaceId, workspaceId), eq(workflowStates.entityType, entityType), isNull(workflowStates.archivedAt)];
    if (id) conditions.push(eq(workflowStates.id, id));
    else conditions.push(eq(workflowStates.isInitial, true));
    const [state] = await this.database.db
      .select()
      .from(workflowStates)
      .where(and(...conditions))
      .limit(1);
    if (!state) throw new BadRequestException(`A valid ${entityType} workflow state is required.`);
    return state;
  }

  protected async project(workspaceId: string, projectId: string, includeDeleted = false) {
    const [project] = await this.database.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), includeDeleted ? undefined : isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  protected async repository(workspaceId: string, repositoryId: string) {
    const [repository] = await this.database.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.id, repositoryId), eq(repositories.workspaceId, workspaceId)))
      .limit(1);
    if (!repository) throw new NotFoundException('Repository not found.');
    return repository;
  }

  protected async flow(workspaceId: string, flowId: string, includeDeleted = false) {
    const [flow] = await this.database.db
      .select()
      .from(flows)
      .where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), includeDeleted ? undefined : isNull(flows.deletedAt)))
      .limit(1);
    if (!flow) throw new NotFoundException('Flow not found.');
    return flow;
  }

  protected async task(workspaceId: string, taskId: string, includeDeleted = false) {
    const [direct] = await this.database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), or(eq(tasks.identifier, taskId), sql`${tasks.id}::text = ${taskId}`), includeDeleted ? undefined : isNull(tasks.deletedAt)))
      .limit(1);
    if (direct) return direct;
    const [alias] = await this.database.db
      .select({ task: tasks })
      .from(taskIdentifierAliases)
      .innerJoin(tasks, eq(taskIdentifierAliases.taskId, tasks.id))
      .where(and(eq(taskIdentifierAliases.workspaceId, workspaceId), eq(taskIdentifierAliases.identifier, taskId), includeDeleted ? undefined : isNull(tasks.deletedAt)))
      .limit(1);
    if (!alias) throw new NotFoundException('Task not found.');
    return alias.task;
  }

  protected async availableProjectIssueKey(workspaceId: string, name: string, requested?: string) {
    const base = requested ?? (slugify(name).replaceAll('-', '').toUpperCase().slice(0, 8) || 'PROJ');
    let candidate = base;
    let suffix = 2;
    while (true) {
      const [existing] = await this.database.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.issueKey, candidate)))
        .limit(1);
      if (!existing) return candidate;
      if (requested) throw new ConflictException('That project issue key is already in use in this workspace.');
      candidate = `${base.slice(0, Math.max(2, 10 - String(suffix).length))}${suffix++}`;
    }
  }

  protected async allocateTaskIdentifier(tx: any, workspaceId: string, projectId: string) {
    const [project] = await tx
      .select({ issueKey: projects.issueKey })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!project) throw new NotFoundException('Project not found.');
    await tx.insert(projectTaskCounters).values({ projectId, nextNumber: 1 }).onConflictDoNothing();
    const [counter] = await tx
      .update(projectTaskCounters)
      .set({
        nextNumber: sql`${projectTaskCounters.nextNumber} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(projectTaskCounters.projectId, projectId))
      .returning();
    const taskNumber = counter!.nextNumber - 1;
    return { taskNumber, identifier: `${project.issueKey}-${taskNumber}` };
  }

  protected async membership(workspaceId: string, membershipId: string | null | undefined) {
    if (!membershipId) return null;
    const [membership] = await this.database.db
      .select()
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.id, membershipId), eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.active, true)))
      .limit(1);
    if (!membership) throw new BadRequestException('The selected assignee or responsible member is not active in this workspace.');
    return membership;
  }

  protected async activityFor(workspaceId: string, subjectId: string) {
    const rows = await this.database.db
      .select({ event: activityEvents, actorName: users.displayName })
      .from(activityEvents)
      .leftJoin(users, eq(activityEvents.actorUserId, users.id))
      .where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.subjectId, subjectId)))
      .orderBy(desc(activityEvents.sequence))
      .limit(100);
    return rows.map(({ event, actorName }) => ({ ...event, actorName }));
  }

  protected abstract labelsFor(subject: 'project' | 'flow' | 'task', subjectId: string): Promise<unknown>;
  protected abstract commentsFor(subject: 'task' | 'flow', subjectId: string): Promise<unknown>;
  protected abstract ensureTaskLinkedToFlow(workspaceId: string, taskId: string, flowId: string): Promise<unknown>;
  protected abstract taskWarnings(workspaceId: string, task: typeof tasks.$inferSelect, semantic: string): Promise<string[]>;
  protected abstract flowWarnings(workspaceId: string, flow: typeof flows.$inferSelect, semantic: string): Promise<string[]>;
}
