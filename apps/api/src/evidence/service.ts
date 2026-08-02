import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, evidenceArtifacts, evidenceBlobs, evidenceEventLinks, projects, runEvents, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import type { EvidenceArtifactInput } from './inputs';
import { EvidenceStorageService } from './storage.service';

@Injectable()
export class EvidenceService {
  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService, private readonly storage: EvidenceStorageService) {}

  async list(workspaceId: string, user: AuthUser, filters: { taskId?: string; runId?: string } = {}) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select({ artifact: evidenceArtifacts, blob: evidenceBlobs }).from(evidenceArtifacts).innerJoin(evidenceBlobs, eq(evidenceArtifacts.blobHash, evidenceBlobs.hash)).where(and(eq(evidenceArtifacts.workspaceId, workspaceId), filters.taskId ? eq(evidenceArtifacts.taskId, filters.taskId) : undefined, filters.runId ? eq(evidenceArtifacts.runId, filters.runId) : undefined)).orderBy(desc(evidenceArtifacts.createdAt), desc(evidenceArtifacts.id)).limit(500);
  }

  async get(workspaceId: string, user: AuthUser, artifactId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [row] = await this.database.db.select({ artifact: evidenceArtifacts, blob: evidenceBlobs }).from(evidenceArtifacts).innerJoin(evidenceBlobs, eq(evidenceArtifacts.blobHash, evidenceBlobs.hash)).where(and(eq(evidenceArtifacts.id, artifactId), eq(evidenceArtifacts.workspaceId, workspaceId))).limit(1);
    if (!row) throw new NotFoundException('Evidence artifact not found.');
    const links = await this.database.db.select({ runEventId: evidenceEventLinks.runEventId }).from(evidenceEventLinks).where(eq(evidenceEventLinks.evidenceArtifactId, artifactId));
    return { ...row.artifact, byteSize: row.blob.byteSize, contentHash: row.blob.hash, verifiedAt: row.blob.verifiedAt, producingRunEventIds: links.map((entry) => entry.runEventId) };
  }

  async record(workspaceId: string, user: AuthUser, input: EvidenceArtifactInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    const content = this.storage.decode(input.contentBase64);
    const contentHash = this.storage.hash(content);
    if (input.claimedHash && input.claimedHash !== contentHash) throw new BadRequestException('The claimed evidence hash does not match the uploaded bytes.');
    const scope = await this.validateScope(workspaceId, input);
    const existing = await this.byIdempotencyKey(workspaceId, input.idempotencyKey);
    if (existing) {
      if (existing.blobHash !== contentHash || existing.type !== input.type || existing.mimeType !== input.mimeType || existing.taskId !== scope.taskId || existing.runId !== (input.runId ?? null)) throw new ConflictException('The idempotency key is already associated with different evidence.');
      return this.get(workspaceId, user, existing.id);
    }
    const stored = await this.storage.persist(contentHash, content);
    try {
      const artifact = await this.database.db.transaction(async (tx) => {
        await tx.insert(evidenceBlobs).values({ hash: contentHash, byteSize: stored.byteSize, storageKey: stored.storageKey, verifiedAt: stored.verifiedAt }).onConflictDoUpdate({ target: evidenceBlobs.hash, set: { byteSize: stored.byteSize, storageKey: stored.storageKey, verifiedAt: stored.verifiedAt } });
        const [created] = await tx.insert(evidenceArtifacts).values({ workspaceId, projectId: scope.projectId, taskId: scope.taskId, runId: input.runId ?? null, blobHash: contentHash, idempotencyKey: input.idempotencyKey, type: input.type, mimeType: input.mimeType, title: input.title, producer: input.producer, preview: input.preview, redactionStatus: input.redactionStatus, retentionPolicy: input.retentionPolicy, createdByUserId: user.id }).onConflictDoNothing().returning();
        if (!created) return null;
        if (input.runEventId) await tx.insert(evidenceEventLinks).values({ evidenceArtifactId: created.id, runEventId: input.runEventId });
        return created;
      });
      const resolved = artifact ?? await this.byIdempotencyKey(workspaceId, input.idempotencyKey);
      if (!resolved) throw new ConflictException('Evidence idempotency conflict could not be resolved.');
      return this.get(workspaceId, user, resolved.id);
    } catch (error) {
      const duplicate = await this.byIdempotencyKey(workspaceId, input.idempotencyKey);
      if (duplicate?.blobHash === contentHash && duplicate.type === input.type && duplicate.mimeType === input.mimeType && duplicate.taskId === scope.taskId && duplicate.runId === (input.runId ?? null)) return this.get(workspaceId, user, duplicate.id);
      throw error;
    }
  }

  async readRange(workspaceId: string, user: AuthUser, artifactId: string, offset = 0, length = 1_048_576) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 1_048_576) throw new BadRequestException('Evidence ranges require a non-negative offset and length from 1 to 1048576 bytes.');
    const artifact = await this.get(workspaceId, user, artifactId);
    const range = await this.storage.readRange(artifact.contentHash, offset, length);
    return { artifactId, contentHash: artifact.contentHash, mimeType: artifact.mimeType, totalBytes: range.totalBytes, offset: range.offset, nextOffset: range.nextOffset, contentBase64: range.content.toString('base64') };
  }

  async download(workspaceId: string, user: AuthUser, artifactId: string) {
    const artifact = await this.get(workspaceId, user, artifactId);
    await this.storage.verify(artifact.contentHash);
    return { artifact, stream: this.storage.createReadStream(artifact.contentHash) };
  }

  private async validateScope(workspaceId: string, input: EvidenceArtifactInput) {
    let projectId = input.projectId ?? null;
    let taskId = input.taskId ?? null;
    if (taskId) {
      const [task] = await this.database.db.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
      if (!task) throw new BadRequestException('Evidence task does not exist in this workspace.');
      if (projectId && projectId !== task.projectId) throw new BadRequestException('Evidence project and task scopes do not match.');
      projectId = task.projectId;
    } else if (projectId) {
      const [project] = await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1);
      if (!project) throw new BadRequestException('Evidence project does not exist in this workspace.');
    }
    if (input.runId) {
      const [run] = await this.database.db.select({ id: agentRuns.id, taskId: agentRuns.taskId }).from(agentRuns).where(and(eq(agentRuns.id, input.runId), eq(agentRuns.workspaceId, workspaceId))).limit(1);
      if (!run) throw new BadRequestException('Evidence run does not exist in this workspace.');
      if (taskId && taskId !== run.taskId) throw new BadRequestException('Evidence task and run scopes do not match.');
      taskId = run.taskId;
      const [task] = await this.database.db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, run.taskId)).limit(1);
      projectId = task!.projectId;
      if (input.runEventId) {
        const [event] = await this.database.db.select({ id: runEvents.id }).from(runEvents).where(and(eq(runEvents.id, input.runEventId), eq(runEvents.runId, run.id), eq(runEvents.workspaceId, workspaceId))).limit(1);
        if (!event) throw new BadRequestException('The producing run event must belong to the evidence run.');
      }
    }
    return { projectId, taskId };
  }

  private async byIdempotencyKey(workspaceId: string, idempotencyKey: string) {
    const [artifact] = await this.database.db.select().from(evidenceArtifacts).where(and(eq(evidenceArtifacts.workspaceId, workspaceId), eq(evidenceArtifacts.idempotencyKey, idempotencyKey))).limit(1);
    return artifact ?? null;
  }
}
