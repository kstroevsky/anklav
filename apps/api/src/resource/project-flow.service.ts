import { BadRequestException, ConflictException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ActivityService } from '../activity.service';
import type { AuthUser } from '../auth';
import { flowSemantics, priorities, projectStatuses, taskSemantics } from '../common/domain';
import { slugify } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import { activityEvents, checklistItems, comments, convergenceCriteria, flowAllowedProjects, flowRelations, flows, githubIssueLinks, githubPullRequests, githubRepositories, githubTaskPullRequests, labelAssignments, labels, projects, projectRepositories, repositories, repositoryLocalAliases, projectTaskCounters, taskIdentifierAliases, taskFlows, taskRelations, tasks, users, workflowStates, workspaceMemberships } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import { GitHubService } from '../github';
import { checklistInput, commentInput, criterionInput, flowInput, labelInput, projectInput, projectRepositoryInput, repositoryAliasInput, repositoryInput, relationInput, reviewInput, taskInput, type FlowListFilters, type ProjectListFilters, type TaskListFilters } from './inputs';
import { beforeUpdatedCursor, canonicalPair, countBy, decodeUpdatedCursor, paginate, requestedLimit, selectChanged, taskTimestamps, type ListPage } from './pagination';

import { ResourceBase } from './base.service';

export abstract class ResourceProjectFlowService extends ResourceBase {
  async listRepositories(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(repositories).where(eq(repositories.workspaceId, workspaceId)).orderBy(asc(repositories.fullName));
  }

  async getRepository(workspaceId: string, user: AuthUser, repositoryId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const repository = await this.repository(workspaceId, repositoryId);
    const [aliases, linkedProjects] = await Promise.all([
      this.database.db.select().from(repositoryLocalAliases).where(eq(repositoryLocalAliases.repositoryId, repository.id)).orderBy(asc(repositoryLocalAliases.machineIdentity)),
      this.database.db
        .select({ link: projectRepositories, project: projects })
        .from(projectRepositories)
        .innerJoin(projects, eq(projectRepositories.projectId, projects.id))
        .where(and(eq(projectRepositories.repositoryId, repository.id), isNull(projects.deletedAt)))
        .orderBy(asc(projects.name)),
    ]);
    return { ...repository, aliases, projects: linkedProjects };
  }

  async createRepository(workspaceId: string, user: AuthUser, input: z.infer<typeof repositoryInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    const [repository] = await this.database.db
      .insert(repositories)
      .values({ workspaceId, ...input })
      .returning();
    return repository;
  }

  async updateRepository(workspaceId: string, user: AuthUser, repositoryId: string, version: number, input: Partial<z.infer<typeof repositoryInput>>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    const before = await this.repository(workspaceId, repositoryId);
    const [updated] = await this.database.db
      .update(repositories)
      .set({
        ...input,
        version: sql`${repositories.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(repositories.id, repositoryId), eq(repositories.workspaceId, workspaceId), eq(repositories.version, version)))
      .returning();
    if (!updated)
      throw new PreconditionFailedException({
        title: 'Repository was updated elsewhere',
        current: before,
      });
    return updated;
  }

  async setRepositoryAlias(workspaceId: string, user: AuthUser, repositoryId: string, input: z.infer<typeof repositoryAliasInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    await this.repository(workspaceId, repositoryId);
    const [alias] = await this.database.db
      .insert(repositoryLocalAliases)
      .values({ repositoryId, ...input })
      .onConflictDoUpdate({
        target: [repositoryLocalAliases.repositoryId, repositoryLocalAliases.machineIdentity],
        set: { localPath: input.localPath, updatedAt: new Date() },
      })
      .returning();
    return alias;
  }

  async linkProjectRepository(workspaceId: string, user: AuthUser, projectId: string, input: z.infer<typeof projectRepositoryInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    await this.project(workspaceId, projectId);
    await this.repository(workspaceId, input.repositoryId);
    return this.database.db.transaction(async (tx) => {
      const role = input.role ?? 'supporting';
      if (role === 'primary')
        await tx
          .update(projectRepositories)
          .set({ role: 'supporting' })
          .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.role, 'primary')));
      const [link] = await tx
        .insert(projectRepositories)
        .values({ projectId, repositoryId: input.repositoryId, role })
        .onConflictDoUpdate({
          target: [projectRepositories.projectId, projectRepositories.repositoryId],
          set: { role },
        })
        .returning();
      return link;
    });
  }

  async unlinkProjectRepository(workspaceId: string, user: AuthUser, projectId: string, repositoryId: string) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    await this.project(workspaceId, projectId);
    await this.repository(workspaceId, repositoryId);
    await this.database.db.delete(projectRepositories).where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.repositoryId, repositoryId)));
    return { unlinked: true };
  }

  async listProjects(workspaceId: string, user: AuthUser, filters: ProjectListFilters = {}): Promise<ListPage<typeof projects.$inferSelect>> {
    await this.workspaces.requireMembership(workspaceId, user);
    const cursor = decodeUpdatedCursor(filters.cursor);
    const textFilter = filters.q?.trim() ? or(sql`${projects.name} ILIKE ${`%${filters.q.trim()}%`}`, sql`${projects.description} ILIKE ${`%${filters.q.trim()}%`}`) : undefined;
    const rows = await this.database.db
      .select()
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt), textFilter, filters.status && projectStatuses.includes(filters.status as any) ? eq(projects.status, filters.status as any) : undefined, filters.priority && priorities.includes(filters.priority as any) ? eq(projects.priority, filters.priority as any) : undefined, filters.health && ['unknown', 'on_track', 'at_risk', 'off_track'].includes(filters.health) ? eq(projects.health, filters.health as any) : undefined, beforeUpdatedCursor(projects.updatedAt, projects.id, cursor)))
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(requestedLimit(filters.limit) + 1);
    return paginate(rows, requestedLimit(filters.limit));
  }

  async getProject(workspaceId: string, user: AuthUser, projectId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const project = await this.project(workspaceId, projectId);
    const projectTasks = await this.database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.updatedAt));
    const links = await this.database.db
      .select({ flow: flows, role: taskFlows.role })
      .from(taskFlows)
      .innerJoin(tasks, eq(taskFlows.taskId, tasks.id))
      .innerJoin(flows, eq(taskFlows.flowId, flows.id))
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(flows.deletedAt)));
    const activeFlows = Array.from(new Map(links.map((item) => [item.flow.id, item.flow])).values());
    const repositoryLinks = await this.database.db.select({ link: projectRepositories, repository: repositories }).from(projectRepositories).innerJoin(repositories, eq(projectRepositories.repositoryId, repositories.id)).where(eq(projectRepositories.projectId, projectId)).orderBy(asc(projectRepositories.role), asc(repositories.fullName));
    return {
      ...project,
      repositories: repositoryLinks,
      tasks: projectTasks,
      flows: activeFlows,
      labels: await this.labelsFor('project', projectId),
      activity: await this.activityFor(workspaceId, projectId),
    };
  }

  async createProject(workspaceId: string, user: AuthUser, input: z.infer<typeof projectInput>) {
    await this.workspaces.requireMembership(workspaceId, user, 'member');
    const issueKey = await this.availableProjectIssueKey(workspaceId, input.name, input.issueKey);
    const [project] = await this.database.db
      .insert(projects)
      .values({ workspaceId, ...input, issueKey })
      .returning();
    await this.activityService.append(this.database.db, {
      workspaceId,
      subjectType: 'project',
      subjectId: project!.id,
      action: 'created',
      actor: user,
      after: { name: project!.name },
    });
    return project;
  }

  async updateProject(workspaceId: string, user: AuthUser, projectId: string, version: number, input: Partial<z.infer<typeof projectInput>>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.project(workspaceId, projectId);
    if (input.issueKey && input.issueKey !== before.issueKey) {
      await this.workspaces.requireMembership(workspaceId, user, 'admin');
      const [existingTask] = await this.database.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)).limit(1);
      if (existingTask) throw new BadRequestException('A project issue key is immutable after its first task is created.');
      await this.availableProjectIssueKey(workspaceId, before.name, input.issueKey);
    }
    const [updated] = await this.database.db
      .update(projects)
      .set({
        ...input,
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), eq(projects.version, version), isNull(projects.deletedAt)))
      .returning();
    if (!updated)
      throw new PreconditionFailedException({
        title: 'Project was updated elsewhere',
        current: before,
      });
    await this.activityService.append(this.database.db, {
      workspaceId,
      subjectType: 'project',
      subjectId: projectId,
      action: 'updated',
      actor: user,
      before: selectChanged(before, input),
      after: selectChanged(updated, input),
    });
    return updated;
  }

  async listFlows(
    workspaceId: string,
    user: AuthUser,
    filters: FlowListFilters = {},
  ): Promise<
    ListPage<{
      flow: typeof flows.$inferSelect;
      state: typeof workflowStates.$inferSelect;
    }>
  > {
    await this.workspaces.requireMembership(workspaceId, user);
    const cursor = decodeUpdatedCursor(filters.cursor);
    const textFilter = filters.q?.trim() ? or(sql`${flows.name} ILIKE ${`%${filters.q.trim()}%`}`, sql`${flows.purpose} ILIKE ${`%${filters.q.trim()}%`}`) : undefined;
    const rows = await this.database.db
      .select({ flow: flows, state: workflowStates })
      .from(flows)
      .innerJoin(workflowStates, eq(flows.workflowStateId, workflowStates.id))
      .where(and(eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt), textFilter, filters.stateId ? eq(flows.workflowStateId, filters.stateId) : undefined, filters.priority && priorities.includes(filters.priority as any) ? eq(flows.priority, filters.priority as any) : undefined, filters.health && ['unknown', 'on_track', 'at_risk', 'off_track'].includes(filters.health) ? eq(flows.health, filters.health as any) : undefined, beforeUpdatedCursor(flows.updatedAt, flows.id, cursor)))
      .orderBy(desc(flows.updatedAt), desc(flows.id))
      .limit(requestedLimit(filters.limit) + 1);
    return paginate(rows, requestedLimit(filters.limit), (row) => row.flow);
  }

  async getFlow(workspaceId: string, user: AuthUser, flowId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const flow = await this.flow(workspaceId, flowId);
    const [state] = await this.database.db.select().from(workflowStates).where(eq(workflowStates.id, flow.workflowStateId)).limit(1);
    const linkedTasks = await this.database.db
      .select({
        task: tasks,
        role: taskFlows.role,
        project: projects,
        state: workflowStates,
      })
      .from(taskFlows)
      .innerJoin(tasks, eq(taskFlows.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(workflowStates, eq(tasks.workflowStateId, workflowStates.id))
      .where(and(eq(taskFlows.flowId, flowId), isNull(tasks.deletedAt)))
      .orderBy(asc(projects.name), desc(tasks.updatedAt));
    const criteria = await this.database.db.select().from(convergenceCriteria).where(eq(convergenceCriteria.flowId, flowId)).orderBy(asc(convergenceCriteria.position));
    const relations = await this.database.db
      .select()
      .from(flowRelations)
      .where(and(eq(flowRelations.workspaceId, workspaceId), or(eq(flowRelations.sourceFlowId, flowId), eq(flowRelations.targetFlowId, flowId))));
    const blockers = await this.database.db
      .select({ relation: flowRelations, flow: flows, state: workflowStates })
      .from(flowRelations)
      .innerJoin(flows, eq(flowRelations.sourceFlowId, flows.id))
      .innerJoin(workflowStates, eq(flows.workflowStateId, workflowStates.id))
      .where(and(eq(flowRelations.targetFlowId, flowId), eq(flowRelations.type, 'blocks'), isNull(flows.deletedAt)));
    const projectsInFlow = Array.from(new Map(linkedTasks.map(({ project }) => [project.id, project])).values());
    const warnings = await this.flowWarnings(workspaceId, flow, state?.flowSemantic ?? 'proposed');
    return {
      ...flow,
      state,
      tasks: linkedTasks,
      criteria,
      relations,
      blockers,
      participatingProjects: projectsInFlow,
      allowedProjects: await this.database.db.select({ id: projects.id, name: projects.name }).from(flowAllowedProjects).innerJoin(projects, eq(flowAllowedProjects.projectId, projects.id)).where(eq(flowAllowedProjects.flowId, flowId)),
      labels: await this.labelsFor('flow', flowId),
      comments: await this.commentsFor('flow', flowId),
      activity: await this.activityFor(workspaceId, flowId),
      signals: {
        criteria: {
          completed: criteria.filter((item) => item.completed).length,
          total: criteria.length,
        },
        taskStates: countBy(linkedTasks, (item) => item.state.taskSemantic),
        unresolvedBlockers: blockers.filter((item) => item.state.flowSemantic !== 'converged').length,
        transitionWarnings: warnings,
      },
    };
  }

  async createFlow(workspaceId: string, user: AuthUser, input: z.infer<typeof flowInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const state = await this.state(workspaceId, input.workflowStateId, 'flow');
    await this.membership(workspaceId, input.responsibleMembershipId);
    if (input.scope === 'selected_projects' && !input.allowedProjectIds?.length) throw new BadRequestException('A selected-project flow requires at least one allowed project.');
    for (const projectId of input.allowedProjectIds ?? []) await this.project(workspaceId, projectId);
    const { allowedProjectIds, workflowStateId: _, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const [flow] = await tx
        .insert(flows)
        .values({ workspaceId, ...values, workflowStateId: state.id })
        .returning();
      if (allowedProjectIds?.length)
        await tx.insert(flowAllowedProjects).values(
          allowedProjectIds.map((projectId) => ({
            flowId: flow!.id,
            projectId,
          })),
        );
      await this.activityService.append(tx, {
        workspaceId,
        subjectType: 'flow',
        subjectId: flow!.id,
        action: 'created',
        actor: user,
        after: { name: flow!.name },
      });
      return flow;
    });
  }

  async updateFlow(workspaceId: string, user: AuthUser, flowId: string, version: number, input: Partial<z.infer<typeof flowInput>>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.flow(workspaceId, flowId);
    if (input.workflowStateId) await this.state(workspaceId, input.workflowStateId, 'flow');
    await this.membership(workspaceId, input.responsibleMembershipId);
    if (input.primaryCurrentTaskId) await this.ensureTaskLinkedToFlow(workspaceId, input.primaryCurrentTaskId, flowId);
    if (input.scope === 'selected_projects' && !input.allowedProjectIds?.length) throw new BadRequestException('A selected-project flow requires allowed projects.');
    for (const projectId of input.allowedProjectIds ?? []) await this.project(workspaceId, projectId);
    const { allowedProjectIds, ...values } = input;
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(flows)
        .set({
          ...values,
          version: sql`${flows.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), eq(flows.version, version), isNull(flows.deletedAt)))
        .returning();
      if (!updated)
        throw new PreconditionFailedException({
          title: 'Flow was updated elsewhere',
          current: before,
        });
      if (allowedProjectIds) {
        await tx.delete(flowAllowedProjects).where(eq(flowAllowedProjects.flowId, flowId));
        if (allowedProjectIds.length) await tx.insert(flowAllowedProjects).values(allowedProjectIds.map((projectId) => ({ flowId, projectId })));
      }
      await this.activityService.append(tx, {
        workspaceId,
        subjectType: 'flow',
        subjectId: flowId,
        action: 'updated',
        actor: user,
        before: selectChanged(before, values),
        after: selectChanged(updated, values),
      });
      return updated;
    });
  }
}
