import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { ActivityService } from './activity.service';
import { DatabaseService } from './db/database.service';
import {
  artifactRelations, externalObjectMappings, flows, githubProjectRepositories, githubRepositories, knowledgeArtifactRevisions, knowledgeArtifacts, milestoneTasks, milestones,
  projects, repositoryArtifactReferences, taskFlows, tasks,
} from './db/schema';
import { GitHubService } from './github';
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
    private readonly github: GitHubService,
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
    return this.database.db.transaction(async (tx) => {
      const [artifact] = await tx.insert(knowledgeArtifacts).values({
        workspaceId, projectId: input.projectId ?? null, flowId: input.flowId ?? null, taskId: input.taskId ?? null, type: input.type,
        origin: hasReference ? 'git_backed' : input.type === 'legacy_document' ? 'legacy_source' : 'native', canonicality: 'candidate', verification: 'unverified',
        title: input.title, summary: input.summary ?? '', createdByUserId: user.id,
      }).returning();
      if (hasNativeContent) {
        const [revision] = await tx.insert(knowledgeArtifactRevisions).values({ workspaceId, artifactId: artifact!.id, revision: 1, nativeContent: input.nativeContent, contentHash: hash(input.nativeContent!), createdByUserId: user.id }).returning();
        await tx.update(knowledgeArtifacts).set({ currentRevisionId: revision!.id }).where(eq(knowledgeArtifacts.id, artifact!.id));
      } else {
        const ref = input.repositoryReference!;
        await tx.insert(repositoryArtifactReferences).values({ workspaceId, artifactId: artifact!.id, githubRepositoryId: ref.githubRepositoryId ?? null, repositoryFullName: ref.repositoryFullName, path: ref.path, commitSha: ref.commitSha ?? null, contentHash: ref.contentHash ?? null, sourceProjectId: input.projectId ?? null, verifiedAt: null, verificationNote: ref.verificationNote ?? 'Awaiting server-side GitHub verification.' });
      }
      await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifact!.id, action: 'recorded', actor: user, after: { type: artifact!.type, origin: artifact!.origin, canonicality: artifact!.canonicality } });
      return artifact;
    });
  }

  async addArtifactRevision(workspaceId: string, user: AuthUser, artifactId: string, expectedVersion: number, nativeContent: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.getArtifact(workspaceId, user, artifactId);
    if (before.origin === 'git_backed') throw new BadRequestException('Git-backed artifacts are revised in Git and verified by immutable commit reference, not by native-content revisions.');
    return this.database.db.transaction(async (tx) => {
      const [artifact] = await tx.update(knowledgeArtifacts).set({ version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() })
        .where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.version, expectedVersion), isNull(knowledgeArtifacts.deletedAt))).returning();
      if (!artifact) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
      const [revision] = await tx.insert(knowledgeArtifactRevisions).values({ workspaceId, artifactId, revision: (before.revisions[0]?.revision ?? 0) + 1, nativeContent, contentHash: hash(nativeContent), createdByUserId: user.id }).returning();
      await tx.update(knowledgeArtifacts).set({ currentRevisionId: revision!.id }).where(eq(knowledgeArtifacts.id, artifactId));
      await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: 'revision_added', actor: user, after: { revision: revision!.revision, contentHash: revision!.contentHash } });
      return { artifact, revision };
    });
  }

  async relateArtifacts(workspaceId: string, user: AuthUser, artifactId: string, expectedVersion: number, toArtifactId: string, relation: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.getArtifact(workspaceId, user, artifactId);
    if (artifactId === toArtifactId) throw new BadRequestException('An artifact cannot relate to itself.');
    await this.getArtifact(workspaceId, user, toArtifactId);
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx.update(knowledgeArtifacts).set({ version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() }).where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.version, expectedVersion), isNull(knowledgeArtifacts.deletedAt))).returning();
      if (!updated) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
      await tx.insert(artifactRelations).values({ workspaceId, fromArtifactId: artifactId, toArtifactId, relation }).onConflictDoNothing();
      await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: 'related', actor: user, after: { toArtifactId, relation } });
      return updated;
    });
  }

  async setArtifactDisposition(workspaceId: string, user: AuthUser, artifactId: string, expectedVersion: number, disposition: 'superseded' | 'rejected') {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const before = await this.getArtifact(workspaceId, user, artifactId);
    const [updated] = await this.database.db.update(knowledgeArtifacts).set({ canonicality: disposition, version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.version, expectedVersion), isNull(knowledgeArtifacts.deletedAt))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: disposition, actor: user });
    return updated;
  }

  /** Fetches and hashes the referenced file with the existing GitHub App. No client can assert verified. */
  async verifyRepositoryArtifact(workspaceId: string, user: AuthUser, artifactId: string, expectedVersion: number) {
    await this.workspaces.requireMembership(workspaceId, user);
    const before = await this.getArtifact(workspaceId, user, artifactId);
    const reference = before.repositoryReference;
    if (!reference || !reference.commitSha) throw new BadRequestException('Git verification requires an immutable commit SHA.');
    const fetched = await this.github.fetchRepositoryFile(workspaceId, user, { githubRepositoryId: reference.githubRepositoryId, repositoryFullName: reference.repositoryFullName, path: reference.path, commitSha: reference.commitSha });
    return this.database.db.transaction(async (tx) => {
      const baseWhere = and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.version, expectedVersion), isNull(knowledgeArtifacts.deletedAt));
      if (!fetched.found) {
        const [artifact] = await tx.update(knowledgeArtifacts).set({ version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() }).where(baseWhere).returning();
        if (!artifact) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
        await tx.update(repositoryArtifactReferences).set({ verificationNote: fetched.message, verifiedAt: null, updatedAt: new Date() }).where(eq(repositoryArtifactReferences.id, reference.id));
        await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: 'git_verification_failed', actor: user, after: { reason: fetched.message } });
        return { verified: false, artifact, message: fetched.message };
      }
      const contentHash = createHash('sha256').update(fetched.content).digest('hex');
      const [artifact] = await tx.update(knowledgeArtifacts).set({ verification: 'verified', version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() }).where(baseWhere).returning();
      if (!artifact) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
      await tx.update(repositoryArtifactReferences).set({ githubRepositoryId: fetched.repositoryId, contentHash, verifiedAt: new Date(), verificationNote: `Verified server-side at ${new Date().toISOString()} against ${reference.commitSha}.`, updatedAt: new Date() }).where(eq(repositoryArtifactReferences.id, reference.id));
      await this.activity.append(tx, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: 'git_verified', actor: user, after: { repository: reference.repositoryFullName, path: reference.path, commitSha: reference.commitSha, contentHash } });
      return { verified: true, artifact, contentHash };
    });
  }

  async promoteArtifactCanonical(workspaceId: string, user: AuthUser, artifactId: string, expectedVersion: number) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const before = await this.getArtifact(workspaceId, user, artifactId);
    if (before.origin !== 'git_backed' || before.verification !== 'verified' || !before.repositoryReference?.commitSha || !before.repositoryReference.contentHash || !before.repositoryReference.verifiedAt) throw new BadRequestException('Only a server-verified, immutable Git-backed artifact can be promoted to canonical.');
    const [updated] = await this.database.db.update(knowledgeArtifacts).set({ canonicality: 'canonical', version: sql`${knowledgeArtifacts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(knowledgeArtifacts.id, artifactId), eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.version, expectedVersion), isNull(knowledgeArtifacts.deletedAt), eq(knowledgeArtifacts.verification, 'verified'))).returning();
    if (!updated) throw new PreconditionFailedException({ title: 'Artifact was updated elsewhere', current: before });
    await this.activity.append(this.database.db, { workspaceId, subjectType: 'knowledge_artifact', subjectId: artifactId, action: 'promoted_canonical', actor: user, after: { commitSha: before.repositoryReference.commitSha, contentHash: before.repositoryReference.contentHash } });
    return updated;
  }

  async getTaskContextPack(workspaceId: string, user: AuthUser, taskId: string) {
    const task = await this.resources.getTask(workspaceId, user, taskId);
    if (!task.project) throw new NotFoundException('Task project not found.');
    const relatedFlows = [...task.flows].sort((a: any, b: any) => `${a.link.role}:${a.flow.name}`.localeCompare(`${b.link.role}:${b.flow.name}`));
    const flowIds = relatedFlows.map((entry: any) => entry.flow.id);
    const criteria = flowIds.length ? await this.database.db.execute(sql`SELECT c.*, f.name AS flow_name FROM convergence_criteria c JOIN flows f ON f.id = c.flow_id WHERE c.flow_id = ANY(${flowIds}::uuid[]) ORDER BY f.name, c.position`) : { rows: [] };
    const milestoneRows = await this.database.db.select({ milestone: milestones }).from(milestoneTasks).innerJoin(milestones, eq(milestoneTasks.milestoneId, milestones.id))
      .where(and(eq(milestoneTasks.taskId, task.id), eq(milestones.workspaceId, workspaceId), isNull(milestones.deletedAt))).orderBy(asc(milestones.targetDate), asc(milestones.name));
    const artifactRows = await this.database.db.select({ artifact: knowledgeArtifacts, reference: repositoryArtifactReferences }).from(knowledgeArtifacts)
      .leftJoin(repositoryArtifactReferences, eq(repositoryArtifactReferences.artifactId, knowledgeArtifacts.id))
      .where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), isNull(knowledgeArtifacts.deletedAt), or(eq(knowledgeArtifacts.taskId, task.id), eq(knowledgeArtifacts.projectId, task.projectId), flowIds.length ? inArray(knowledgeArtifacts.flowId, flowIds) : undefined), eq(knowledgeArtifacts.canonicality, 'canonical'), eq(knowledgeArtifacts.verification, 'verified')))
      .orderBy(asc(knowledgeArtifacts.type), asc(knowledgeArtifacts.title), asc(knowledgeArtifacts.id));
    const projectRepositories = await this.database.db.select({ repository: githubRepositories, link: githubProjectRepositories }).from(githubProjectRepositories).innerJoin(githubRepositories, eq(githubProjectRepositories.repositoryId, githubRepositories.id)).where(eq(githubProjectRepositories.projectId, task.projectId)).orderBy(asc(githubRepositories.fullName));
    const handoff = artifactRows.filter((entry) => entry.artifact.type === 'handoff').sort((left, right) => right.artifact.createdAt.getTime() - left.artifact.createdAt.getTime() || right.artifact.id.localeCompare(left.artifact.id))[0] ?? null;
    const relationRows = await this.database.db.execute(sql`
      SELECT r.id, r.type, r.explanation, r.source_task_id, r.target_task_id,
        source.identifier AS source_identifier, source.title AS source_title, source.deleted_at AS source_deleted_at,
        target.identifier AS target_identifier, target.title AS target_title, target.deleted_at AS target_deleted_at
      FROM task_relations r
      JOIN tasks source ON source.id = r.source_task_id
      JOIN tasks target ON target.id = r.target_task_id
      WHERE r.workspace_id = ${workspaceId}::uuid AND (r.source_task_id = ${task.id}::uuid OR r.target_task_id = ${task.id}::uuid)
      ORDER BY r.type, source.identifier, target.identifier, r.id
    `);
    const taskRelations = relationRows.rows.map((row: any) => ({ id: row.id, type: row.type, explanation: row.explanation, direction: row.source_task_id === task.id ? 'outgoing' : 'incoming', source: { id: row.source_task_id, identifier: row.source_identifier, title: row.source_title, deleted: Boolean(row.source_deleted_at) }, target: { id: row.target_task_id, identifier: row.target_identifier, title: row.target_title, deleted: Boolean(row.target_deleted_at) } }));
    const provenance = await this.database.db.select({ sourceSystem: externalObjectMappings.sourceSystem, sourceKind: externalObjectMappings.sourceKind, sourceKey: externalObjectMappings.sourceKey, sourceId: externalObjectMappings.sourceId, sourceUrl: externalObjectMappings.sourceUrl, bundleVersion: externalObjectMappings.bundleVersion }).from(externalObjectMappings)
      .where(and(eq(externalObjectMappings.workspaceId, workspaceId), eq(externalObjectMappings.targetEntityType, 'task'), eq(externalObjectMappings.targetEntityId, task.id), isNull(externalObjectMappings.supersededAt))).orderBy(asc(externalObjectMappings.sourceKey));
    const blockers = [
      ...(task.state?.taskSemantic === 'blocked' ? [{ type: 'task_state', message: 'Task is currently blocked.' }] : []),
      ...taskRelations.filter((relation: any) => relation.type === 'blocks' && relation.direction === 'incoming').map((relation: any) => ({ type: 'blocking_task_relation', message: `${relation.source.identifier}: ${relation.source.title}` })),
      ...task.transitionWarnings.map((message: string) => ({ type: 'transition_warning', message })),
      ...relatedFlows.filter((entry: any) => entry.flow.health === 'off_track' || entry.flow.health === 'at_risk').map((entry: any) => ({ type: 'flow_health', message: `${entry.flow.name}: ${entry.flow.health}` })),
    ];
    const deterministic = {
      version: '1', generatedFrom: { taskId: task.id, taskVersion: task.version }, taskContract: { identifier: task.identifier, aliases: task.identifierAliases, title: task.title, description: task.description, status: task.state?.taskSemantic, priority: task.priority, readiness: task.checklists.filter((item: any) => item.kind === 'readiness'), acceptanceCriteria: task.checklists.filter((item: any) => item.kind === 'acceptance'), verificationRequirements: task.verificationRequirements, verificationPerformed: task.verificationPerformed, completionEvidence: task.completionEvidence, limitations: task.remainingLimitations, followUpWork: task.followUpWork },
      project: { id: task.project.id, name: task.project.name, summary: task.project.currentStateSummary, focus: task.project.currentFocus, repositoryReference: task.project.repositoryReference },
      flows: relatedFlows.map((entry: any) => ({ role: entry.link.role, id: entry.flow.id, name: entry.flow.name, purpose: entry.flow.purpose, state: entry.flow.workflowStateId, health: entry.flow.health, importantFindings: entry.flow.importantFindings, nextRecommendedAction: entry.flow.nextRecommendedAction, convergenceCriteria: criteria.rows.filter((criterion: any) => criterion.flow_id === entry.flow.id).map((criterion: any) => ({ text: criterion.text, completed: criterion.completed })) })),
      milestones: milestoneRows.map(({ milestone }) => ({ id: milestone.id, name: milestone.name, status: milestone.status, targetDate: milestone.targetDate, flowId: milestone.flowId })),
      acceptedDecisions: artifactRows.filter((entry) => entry.artifact.type === 'decision').map((entry) => ({ id: entry.artifact.id, title: entry.artifact.title, summary: entry.artifact.summary, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : null })),
      verifiedArtifacts: artifactRows.map((entry) => ({ id: entry.artifact.id, type: entry.artifact.type, title: entry.artifact.title, summary: entry.artifact.summary, origin: entry.artifact.origin, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : { artifactId: entry.artifact.id, revisionId: entry.artifact.currentRevisionId } })),
      repositories: projectRepositories.map((entry) => ({ fullName: entry.repository.fullName, defaultBranch: entry.repository.defaultBranch, htmlUrl: entry.repository.htmlUrl })),
      linkedGitHub: { issues: task.githubIssues, pullRequests: task.githubPullRequests },
      taskRelations,
      dependencies: taskRelations.filter((relation: any) => relation.type === 'blocks'),
      sourceProvenance: provenance,
      latestHandoff: handoff ? { id: handoff.artifact.id, title: handoff.artifact.title, summary: handoff.artifact.summary } : null,
      humanReview: { required: task.humanReviewRequired, status: task.reviewStatus, reviewerMembershipId: task.reviewerMembershipId }, blockers,
      explicitNonGoals: task.nonGoals ? task.nonGoals.split('\n').map((entry: string) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean) : nonGoals(task.description), semanticRetrieval: { included: false, reason: 'Phase 1 context packs intentionally use deterministic structured and verified Git-backed context only.' },
    };
    return finalizeContextPack(deterministic);
  }
}
