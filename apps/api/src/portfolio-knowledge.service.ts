import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { ActivityService } from './activity.service';
import { DatabaseService } from './db/database.service';
import {
  artifactRelations, flows, githubProjectRepositories, githubRepositories, knowledgeArtifactRevisions, knowledgeArtifacts, milestoneTasks, milestones,
  projects, repositoryArtifactReferences, taskFlows, tasks,
} from './db/schema';
import { ResourceService } from './resource.service';
import { WorkspaceService } from './workspace.service';

type MilestoneInput = {
  projectId: string; flowId?: string | null; name: string; description?: string; status?: 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'archived'; targetDate?: string | null; taskIds?: string[];
};

type ArtifactInput = {
  projectId?: string | null; flowId?: string | null; taskId?: string | null;
  type: 'legacy_document' | 'git_reference' | 'research' | 'specification' | 'decision' | 'evaluation' | 'handoff' | 'project_state' | 'roadmap' | 'agent_instructions';
  title: string; summary?: string; nativeContent?: string | null;
  repositoryReference?: { repositoryFullName: string; path: string; commitSha?: string | null; contentHash?: string | null; githubRepositoryId?: string | null; verificationNote?: string } | null;
  canonicality?: 'candidate' | 'canonical' | 'superseded' | 'rejected'; verification?: 'unverified' | 'verified';
};

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();

/** Hashes the exact structured pack, making cache entries and snapshots reproducible. */
export function finalizeContextPack<T extends Record<string, unknown>>(pack: T): T & { contentHash: string } {
  return { ...pack, contentHash: hash(pack) };
}

function nonGoals(description: string): string[] {
  const match = description.match(/^##\s+Non-goals\s*\n([\s\S]*?)(?=^##\s|\z)/mi);
  return match?.[1]?.split('\n').map((entry) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean) ?? [];
}

@Injectable()
export class PortfolioKnowledgeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaces: WorkspaceService,
    private readonly activity: ActivityService,
    private readonly resources: ResourceService,
  ) {}

  private async requireProject(workspaceId: string, projectId: string) {
    const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new BadRequestException('A valid project in this workspace is required.');
    return project;
  }

  private async requireFlow(workspaceId: string, flowId: string | null | undefined) {
    if (!flowId) return;
    const [flow] = await this.database.db.select({ id: flows.id }).from(flows).where(and(eq(flows.id, flowId), eq(flows.workspaceId, workspaceId), isNull(flows.deletedAt))).limit(1);
    if (!flow) throw new BadRequestException('A valid flow in this workspace is required.');
  }

  private async requireTask(workspaceId: string, taskId: string | null | undefined) {
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

  async listArtifacts(workspaceId: string, user: AuthUser, filters: { projectId?: string; flowId?: string; taskId?: string; type?: string } = {}) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), isNull(knowledgeArtifacts.deletedAt),
      filters.projectId ? eq(knowledgeArtifacts.projectId, filters.projectId) : undefined, filters.flowId ? eq(knowledgeArtifacts.flowId, filters.flowId) : undefined,
      filters.taskId ? eq(knowledgeArtifacts.taskId, filters.taskId) : undefined, filters.type ? eq(knowledgeArtifacts.type, filters.type as any) : undefined,
    )).orderBy(desc(knowledgeArtifacts.updatedAt), asc(knowledgeArtifacts.id));
  }

  async getArtifact(workspaceId: string, user: AuthUser, artifactId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [artifact] = await this.database.db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), isNull(knowledgeArtifacts.deletedAt))).limit(1);
    if (!artifact) throw new NotFoundException('Knowledge artifact not found.');
    const [reference] = await this.database.db.select().from(repositoryArtifactReferences).where(eq(repositoryArtifactReferences.artifactId, artifactId)).limit(1);
    const revisions = await this.database.db.select().from(knowledgeArtifactRevisions).where(eq(knowledgeArtifactRevisions.artifactId, artifactId)).orderBy(desc(knowledgeArtifactRevisions.revision));
    return { ...artifact, repositoryReference: reference ?? null, revisions };
  }

  async recordArtifact(workspaceId: string, user: AuthUser, input: ArtifactInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    if (input.projectId) await this.requireProject(workspaceId, input.projectId);
    await this.requireFlow(workspaceId, input.flowId);
    await this.requireTask(workspaceId, input.taskId);
    const hasNativeContent = input.nativeContent !== undefined && input.nativeContent !== null;
    const hasReference = Boolean(input.repositoryReference);
    if (hasNativeContent === hasReference) throw new BadRequestException('An artifact must have exactly one native content revision or Git-backed reference.');
    if (input.type === 'git_reference' && !hasReference) throw new BadRequestException('Git reference artifacts require a repository reference.');
    const requestedCanonical = input.canonicality === 'canonical';
    if (requestedCanonical) {
      await this.workspaces.requireMembership(workspaceId, user, 'admin');
      if (!hasReference || input.verification !== 'verified' || !input.repositoryReference?.commitSha || !input.repositoryReference.contentHash) {
        throw new BadRequestException('Canonical artifacts require an admin, verified Git reference, commit SHA, and content hash.');
      }
    }
    return this.database.db.transaction(async (tx) => {
      const [artifact] = await tx.insert(knowledgeArtifacts).values({
        workspaceId, projectId: input.projectId ?? null, flowId: input.flowId ?? null, taskId: input.taskId ?? null, type: input.type,
        origin: hasReference ? 'git_backed' : input.type === 'legacy_document' ? 'legacy_source' : 'native', canonicality: input.canonicality ?? 'candidate', verification: input.verification ?? 'unverified',
        title: input.title, summary: input.summary ?? '', createdByUserId: user.id,
      }).returning();
      if (hasNativeContent) {
        const [revision] = await tx.insert(knowledgeArtifactRevisions).values({ workspaceId, artifactId: artifact!.id, revision: 1, nativeContent: input.nativeContent, contentHash: hash(input.nativeContent!), createdByUserId: user.id }).returning();
        await tx.update(knowledgeArtifacts).set({ currentRevisionId: revision!.id }).where(eq(knowledgeArtifacts.id, artifact!.id));
      } else {
        const ref = input.repositoryReference!;
        await tx.insert(repositoryArtifactReferences).values({ workspaceId, artifactId: artifact!.id, githubRepositoryId: ref.githubRepositoryId ?? null, repositoryFullName: ref.repositoryFullName, path: ref.path, commitSha: ref.commitSha ?? null, contentHash: ref.contentHash ?? null, sourceProjectId: input.projectId ?? null, verifiedAt: input.verification === 'verified' ? new Date() : null, verificationNote: ref.verificationNote ?? '' });
      }
      await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifact!.id, action: 'recorded', actor: user, after: { type: artifact!.type, origin: artifact!.origin, canonicality: artifact!.canonicality } });
      return artifact;
    });
  }

  async getTaskContextPack(workspaceId: string, user: AuthUser, taskId: string) {
    const task = await this.resources.getTask(workspaceId, user, taskId);
    if (!task.project) throw new NotFoundException('Task project not found.');
    const relatedFlows = [...task.flows].sort((a: any, b: any) => `${a.link.role}:${a.flow.name}`.localeCompare(`${b.link.role}:${b.flow.name}`));
    const flowIds = relatedFlows.map((entry: any) => entry.flow.id);
    const criteria = flowIds.length ? await this.database.db.execute(sql`SELECT c.*, f.name AS flow_name FROM convergence_criteria c JOIN flows f ON f.id = c.flow_id WHERE c.flow_id = ANY(${flowIds}::uuid[]) ORDER BY f.name, c.position`) : { rows: [] };
    const milestoneRows = await this.database.db.select().from(milestones).where(and(eq(milestones.workspaceId, workspaceId), isNull(milestones.deletedAt), or(eq(milestones.projectId, task.projectId), flowIds.length ? inArray(milestones.flowId, flowIds) : undefined))).orderBy(asc(milestones.targetDate), asc(milestones.name));
    const artifactRows = await this.database.db.select({ artifact: knowledgeArtifacts, reference: repositoryArtifactReferences }).from(knowledgeArtifacts)
      .leftJoin(repositoryArtifactReferences, eq(repositoryArtifactReferences.artifactId, knowledgeArtifacts.id))
      .where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), isNull(knowledgeArtifacts.deletedAt), or(eq(knowledgeArtifacts.taskId, task.id), eq(knowledgeArtifacts.projectId, task.projectId), flowIds.length ? inArray(knowledgeArtifacts.flowId, flowIds) : undefined), eq(knowledgeArtifacts.canonicality, 'canonical'), eq(knowledgeArtifacts.verification, 'verified')))
      .orderBy(asc(knowledgeArtifacts.type), asc(knowledgeArtifacts.title), asc(knowledgeArtifacts.id));
    const projectRepositories = await this.database.db.select({ repository: githubRepositories, link: githubProjectRepositories }).from(githubProjectRepositories).innerJoin(githubRepositories, eq(githubProjectRepositories.repositoryId, githubRepositories.id)).where(eq(githubProjectRepositories.projectId, task.projectId)).orderBy(asc(githubRepositories.fullName));
    const handoff = artifactRows.filter((entry) => entry.artifact.type === 'handoff').at(-1) ?? null;
    const blockers = [
      ...(task.state?.taskSemantic === 'blocked' ? [{ type: 'task_state', message: 'Task is currently blocked.' }] : []),
      ...task.transitionWarnings.map((message: string) => ({ type: 'transition_warning', message })),
      ...relatedFlows.filter((entry: any) => entry.flow.health === 'off_track' || entry.flow.health === 'at_risk').map((entry: any) => ({ type: 'flow_health', message: `${entry.flow.name}: ${entry.flow.health}` })),
    ];
    const deterministic = {
      version: '1', generatedFrom: { taskId: task.id, taskVersion: task.version }, taskContract: { identifier: task.identifier, aliases: task.identifierAliases, title: task.title, description: task.description, status: task.state?.taskSemantic, priority: task.priority, readiness: task.checklists.filter((item: any) => item.kind === 'readiness'), acceptanceCriteria: task.checklists.filter((item: any) => item.kind === 'acceptance'), verificationRequired: task.verificationPerformed, completionEvidence: task.completionEvidence, limitations: task.remainingLimitations, followUpWork: task.followUpWork },
      project: { id: task.project.id, name: task.project.name, summary: task.project.currentStateSummary, focus: task.project.currentFocus, repositoryReference: task.project.repositoryReference },
      flows: relatedFlows.map((entry: any) => ({ role: entry.link.role, id: entry.flow.id, name: entry.flow.name, purpose: entry.flow.purpose, state: entry.flow.workflowStateId, health: entry.flow.health, importantFindings: entry.flow.importantFindings, nextRecommendedAction: entry.flow.nextRecommendedAction, convergenceCriteria: criteria.rows.filter((criterion: any) => criterion.flow_id === entry.flow.id).map((criterion: any) => ({ text: criterion.text, completed: criterion.completed })) })),
      milestones: milestoneRows.map((milestone) => ({ id: milestone.id, name: milestone.name, status: milestone.status, targetDate: milestone.targetDate, flowId: milestone.flowId })),
      acceptedDecisions: artifactRows.filter((entry) => entry.artifact.type === 'decision').map((entry) => ({ id: entry.artifact.id, title: entry.artifact.title, summary: entry.artifact.summary, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : null })),
      verifiedArtifacts: artifactRows.map((entry) => ({ id: entry.artifact.id, type: entry.artifact.type, title: entry.artifact.title, summary: entry.artifact.summary, origin: entry.artifact.origin, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : { artifactId: entry.artifact.id, revisionId: entry.artifact.currentRevisionId } })),
      repositories: projectRepositories.map((entry) => ({ fullName: entry.repository.fullName, defaultBranch: entry.repository.defaultBranch, htmlUrl: entry.repository.htmlUrl })),
      linkedGitHub: { issues: task.githubIssues, pullRequests: task.githubPullRequests },
      latestHandoff: handoff ? { id: handoff.artifact.id, title: handoff.artifact.title, summary: handoff.artifact.summary } : null,
      humanReview: { required: task.humanReviewRequired, status: task.reviewStatus, reviewerMembershipId: task.reviewerMembershipId }, blockers,
      explicitNonGoals: nonGoals(task.description), semanticRetrieval: { included: false, reason: 'Phase 1 context packs intentionally use deterministic structured and verified Git-backed context only.' },
    };
    return finalizeContextPack(deterministic);
  }
}
