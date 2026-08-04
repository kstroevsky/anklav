import { createHash } from 'node:crypto';
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

import { PortfolioMilestoneService } from './base.service';

export abstract class PortfolioArtifactService extends PortfolioMilestoneService {
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
    const relations = await this.database.db.select().from(artifactRelations).where(and(eq(artifactRelations.workspaceId, workspaceId), or(eq(artifactRelations.fromArtifactId, artifactId), eq(artifactRelations.toArtifactId, artifactId)))).orderBy(asc(artifactRelations.relation), asc(artifactRelations.id));
    return { ...artifact, repositoryReference: reference ?? null, revisions, relations };
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


}
