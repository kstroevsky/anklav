import { BadRequestException, ConflictException, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { ActivityService } from '../activity.service';
import { DatabaseService } from '../db/database.service';
import {
  artifactRelations, externalObjectMappings, flows, githubProjectRepositories, githubRepositories, knowledgeArtifactRevisions, knowledgeArtifacts, milestoneTasks, milestones,
  projects, repositoryArtifactReferences, taskFlows, tasks,
} from '../db/schema';
import { GitHubService } from '../github';
import { ResourceService } from '../resource.service';
import { WorkspaceService } from '../workspace.service';
import { type ArtifactInput, type MilestoneInput, hash } from './types';

export abstract class PortfolioMilestoneService {
  constructor(
    protected readonly database: DatabaseService,
    protected readonly workspaces: WorkspaceService,
    protected readonly activity: ActivityService,
    protected readonly resources: ResourceService,
    protected readonly github: GitHubService,
  ) {}

  protected async requireProject(workspaceId: string, projectId: string) {
    const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new BadRequestException('A valid project in this workspace is required.');
    return project;
  }

  protected async requireFlow(workspaceId: string, flowId: string | null | undefined) {
    if (!flowId) return;
    const [flow] = await this.database.db.select({ id: flows.id }).from(flows).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt))).limit(1);
    if (!flow) throw new BadRequestException('A valid flow in this workspace is required.');
  }

  protected async requireTask(workspaceId: string, taskId: string | null | undefined) {
    if (!taskId) return;
    const [task] = await this.database.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt))).limit(1);
    if (!task) throw new BadRequestException('A valid task in this workspace is required.');
  }

  async listMilestones(workspaceId: string, user: AuthUser, filters: { projectId?: string; flowId?: string; status?: string } = {}) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(milestones).where(and(
      eq(milestones.workspaceId, workspaceId), isNull(milestones.deletedAt),
      filters.projectId ? eq(milestones.projectId, filters.projectId) : undefined,
      filters.flowId ? eq(milestones.flowId, filters.flowId) : undefined,
      filters.status && ['planned', 'in_progress', 'completed', 'cancelled', 'archived'].includes(filters.status) ? eq(milestones.status, filters.status as any) : undefined,
    )).orderBy(asc(milestones.targetDate), asc(milestones.name));
  }

  async getMilestone(workspaceId: string, user: AuthUser, milestoneId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [milestone] = await this.database.db.select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, workspaceId), isNull(milestones.deletedAt))).limit(1);
    if (!milestone) throw new NotFoundException('Milestone not found.');
    const associatedTasks = await this.database.db.select({ task: tasks }).from(milestoneTasks).innerJoin(tasks, eq(milestoneTasks.taskId, tasks.id)).where(eq(milestoneTasks.milestoneId, milestone.id)).orderBy(asc(tasks.identifier));
    return { ...milestone, tasks: associatedTasks.map((entry) => entry.task) };
  }

  async createMilestone(workspaceId: string, user: AuthUser, input: MilestoneInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.requireProject(workspaceId, input.projectId);
    await this.requireFlow(workspaceId, input.flowId);
    for (const taskId of input.taskIds ?? []) await this.requireTask(workspaceId, taskId);
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.projectId, input.projectId), eq(milestones.name, input.name), isNull(milestones.deletedAt))).limit(1);
      if (existing) throw new ConflictException('A milestone with this name already exists for the project.');
      const status = input.status ?? 'planned';
      const [milestone] = await tx.insert(milestones).values({
        workspaceId, projectId: input.projectId, flowId: input.flowId ?? null, name: input.name, description: input.description ?? '', status,
        targetDate: input.targetDate ?? null, completedAt: status === 'completed' ? new Date() : null,
      }).returning();
      if (input.taskIds?.length) await tx.insert(milestoneTasks).values([...new Set(input.taskIds)].map((taskId) => ({ milestoneId: milestone!.id, taskId })));
      await this.activity.append(tx, { workspaceId, subjectType: 'milestone', subjectId: milestone!.id, action: 'created', actor: user, after: { name: milestone!.name, projectId: milestone!.projectId } });
      return milestone;
    });
  }

  async updateMilestone(workspaceId: string, user: AuthUser, milestoneId: string, expectedVersion: number, input: Partial<MilestoneInput>) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.getMilestone(workspaceId, user, milestoneId);
    if (input.projectId) await this.requireProject(workspaceId, input.projectId);
    if (input.flowId !== undefined) await this.requireFlow(workspaceId, input.flowId);
    for (const taskId of input.taskIds ?? []) await this.requireTask(workspaceId, taskId);
    return this.database.db.transaction(async (tx) => {
      const status = input.status ?? before.status;
      const [updated] = await tx.update(milestones).set({
        ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.flowId !== undefined ? { flowId: input.flowId } : {}), ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}), ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
        ...(input.status ? { status, completedAt: status === 'completed' ? (before.completedAt ?? new Date()) : null } : {}), version: sql`${milestones.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, workspaceId), eq(milestones.version, expectedVersion), isNull(milestones.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Milestone was updated elsewhere', current: before });
      if (input.taskIds) {
        await tx.delete(milestoneTasks).where(eq(milestoneTasks.milestoneId, milestoneId));
        if (input.taskIds.length) await tx.insert(milestoneTasks).values([...new Set(input.taskIds)].map((taskId) => ({ milestoneId, taskId })));
      }
      await this.activity.append(tx, { workspaceId, subjectType: 'milestone', subjectId: milestoneId, action: 'updated', actor: user, before: { status: before.status, name: before.name }, after: { status: updated!.status, name: updated!.name } });
      return updated;
    });
  }

  async softDeleteMilestone(workspaceId: string, user: AuthUser, milestoneId: string, expectedVersion: number) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.getMilestone(workspaceId, user, milestoneId);
    const [updated] = await this.database.db.update(milestones).set({ deletedAt: new Date(), deletedByUserId: user.id, version: sql`${milestones.version} + 1`, updatedAt: new Date() })
      .where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, workspaceId), eq(milestones.version, expectedVersion), isNull(milestones.deletedAt))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Milestone was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'milestone', subjectId: milestoneId, action: 'soft_deleted', actor: user });
    return updated;
  }


}

