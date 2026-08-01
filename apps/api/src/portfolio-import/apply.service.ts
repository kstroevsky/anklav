import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { ActivityService } from '../activity.service';
import { slugify } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import {
  checklistItems, externalObjectMappings, externalSources, flows, githubConnections, githubProjectRepositories, githubRepositories, importBatches, importConflicts, importCreatedObjects, importVerificationAttempts, importVerifications,
  knowledgeArtifactRevisions, knowledgeArtifacts, labels, labelAssignments, milestoneTasks, milestones, projectTaskCounters, projects, repositoryArtifactReferences,
  taskFlows, taskIdentifierAliases, tasks, workflowStates, workspaces,
} from '../db/schema';
import { assertVerificationOutputOutsideBundle, loadMigrationBundle, type BundleRecord, type MigrationBundle } from '../migration-bundle';
import { PortfolioKnowledgeService } from '../portfolio-knowledge.service';
import { asDate, asDateOnly, checklist, digest, isProjectControlTask, normalized, section, source, sourceKeyFor, type ImportContext, type ImportOverrides, type ImportOutcome, type ImportRequest, type ResolvedTarget } from './types';
import { importPreflight } from './preflight';

import { PortfolioImportBaseService } from './base.service';

export abstract class PortfolioImportApplyService extends PortfolioImportBaseService {
  protected abstract resolveTarget(tx: any, context: ImportContext, mapping: BundleRecord, record?: BundleRecord): Promise<ResolvedTarget>;
  async apply(request: ImportRequest, actor: AuthUser): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const overrides = request.overrides ?? {};
    const preflight = this.preflight(bundle, overrides, Boolean(await this.findWorkspace(request.workspace)));
    if ((preflight.blocking as BundleRecord[]).length) throw new ConflictException({ title: 'Migration apply is blocked by unresolved decisions.', blocking: preflight.blocking, overridesTemplate: this.overridesTemplate(bundle, overrides) });
    const existingWorkspace = await this.findWorkspace(request.workspace);
    const drift = existingWorkspace ? await this.findDrift(bundle, existingWorkspace.id) : [];
    if (drift.length) throw new ConflictException({ title: 'Migration apply is blocked by source payload drift. Resolve it explicitly; Anklav will not overwrite imported targets.', drift });
    const initialized = await this.initialize(bundle, request.workspace, actor, overrides);
    if (initialized.batch.status === 'completed') return { mode: 'apply', noOp: true, batch: initialized.batch, message: 'The same checksummed bundle and frozen overrides have already completed for this workspace.' };
    if (!['applying', 'interrupted', 'planned'].includes(initialized.batch.status)) throw new ConflictException(`Import batch ${initialized.batch.id} is ${initialized.batch.status}; roll back before a clean reapplication.`);
    if (initialized.batch.status !== 'applying') await this.database.db.update(importBatches).set({ status: 'applying', startedAt: initialized.batch.startedAt ?? new Date(), updatedAt: new Date(), error: null }).where(eq(importBatches.id, initialized.batch.id));
    const anklavProjectId = await this.ensureAnklavProject(initialized.workspace.id, actor, initialized.batch.id);
    const context: ImportContext = { bundle, workspaceId: initialized.workspace.id, batchId: initialized.batch.id, externalSourceId: initialized.source.id, actor, overrides, targets: new Map(), anklavProjectId };
    await this.database.db.transaction((tx) => this.persistBundleConflicts(tx, context));
    const mappings = [...bundle.records['source-mappings.ndjson']!].sort((left, right) => this.mappingOrder(left) - this.mappingOrder(right) || String(left.sourceKey).localeCompare(String(right.sourceKey)));
    const outcomes: Record<string, number> = { created: 0, matched: 0, skipped: 0, deferred: 0, review_required: 0, drift: 0 };
    try {
      for (const mapping of mappings) {
        const outcome = await this.database.db.transaction((tx) => this.importMapping(tx, context, mapping));
        outcomes[outcome.status] = (outcomes[outcome.status] ?? 0) + 1;
      }
      await this.recordCandidateArtifacts(context, outcomes);
      await this.database.db.transaction(async (tx) => {
        await tx.update(importBatches).set({ status: 'completed', completedAt: new Date(), summary: outcomes, updatedAt: new Date() }).where(eq(importBatches.id, context.batchId));
        await this.activity.append(tx, { workspaceId: context.workspaceId, subjectType: 'import_batch', subjectId: context.batchId, action: 'completed', actor, after: outcomes, metadata: { bundleVersion: bundle.manifest.schemaVersion } });
      });
      return { mode: 'apply', noOp: false, batchId: context.batchId, workspaceId: context.workspaceId, outcomes };
    } catch (error) {
      await this.database.db.update(importBatches).set({ status: 'interrupted', error: error instanceof Error ? error.message : String(error), updatedAt: new Date() }).where(eq(importBatches.id, context.batchId));
      throw error;
    }
  }

  async resume(request: ImportRequest, actor: AuthUser): Promise<Record<string, unknown>> { return this.apply(request, actor); }

  private async importMapping(tx: any, context: ImportContext, mapping: BundleRecord): Promise<ImportOutcome> {
    const sourceKey = String(mapping.sourceKey);
    const record = this.recordIndex(context.bundle).get(String(mapping.targetRef));
    const payloadHash = digest(record ?? mapping);
    const [existing] = await tx.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.workspaceId, context.workspaceId), eq(externalObjectMappings.sourceKey, sourceKey), isNull(externalObjectMappings.supersededAt))).limit(1);
    if (existing) {
      if (existing.sourcePayloadHash !== payloadHash) {
        await tx.insert(importConflicts).values({ importBatchId: context.batchId, externalMappingId: existing.id, code: 'source-payload-drift', severity: 'blocking', status: 'open', sourceKey, message: 'A source key was re-imported with changed content; it was not overwritten.' }).onConflictDoNothing();
        return { status: 'drift', targetType: existing.targetEntityType, targetId: existing.targetEntityId ?? undefined };
      }
      const target = { status: existing.status as ResolvedTarget['status'], targetType: existing.targetEntityType, targetId: existing.targetEntityId ?? undefined };
      context.targets.set(String(mapping.targetRef), target);
      return target;
    }
    const target = await this.resolveTarget(tx, context, mapping, record);
    const [createdMapping] = await tx.insert(externalObjectMappings).values({ workspaceId: context.workspaceId, externalSourceId: context.externalSourceId, importBatchId: context.batchId, sourceSystem: String(mapping.sourceSystem), sourceKind: String(mapping.sourceKind), sourceId: String(mapping.sourceId), sourceKey, importKey: String(mapping.importKey), sourceUrl: typeof mapping.sourceUrl === 'string' ? mapping.sourceUrl : null, bundleVersion: context.bundle.manifest.schemaVersion, sourcePayloadHash: payloadHash, targetEntityType: target.targetType, targetEntityId: target.targetId ?? null, status: target.status, createdTarget: Boolean(target.created), importedAt: new Date() }).returning();
    if (target.created && target.targetId) await tx.insert(importCreatedObjects).values({ importBatchId: context.batchId, mappingId: createdMapping!.id, targetEntityType: target.targetType, targetEntityId: target.targetId, importedVersion: target.version ?? null, importedContentHash: target.contentHash ?? payloadHash });
    context.targets.set(String(mapping.targetRef), target);
    await this.activity.append(tx, { workspaceId: context.workspaceId, subjectType: 'import_batch', subjectId: context.batchId, action: `mapping_${target.status}`, actor: context.actor, metadata: { sourceKey, targetType: target.targetType, targetId: target.targetId ?? null } });
    return target;
  }

  private async recordCandidateArtifacts(context: ImportContext, outcomes: Record<string, number>): Promise<void> {
    const candidates = context.bundle.records['knowledge-artifact-candidates.ndjson']!;
    for (const candidate of candidates) await this.database.db.transaction(async (tx) => {
      const projectId = context.targets.get(String(candidate.projectRef))?.targetId;
      const sourceKey = `project-control:artifact-candidate:${candidate.projectRef}:${candidate.path}`;
      const payloadHash = digest(candidate);
      const [mapped] = await tx.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.workspaceId, context.workspaceId), eq(externalObjectMappings.sourceKey, sourceKey), isNull(externalObjectMappings.supersededAt))).limit(1);
      if (mapped) { outcomes[mapped.status] = (outcomes[mapped.status] ?? 0) + 1; return; }
      if (!projectId) { await this.recordCandidateOutcome(tx, context, sourceKey, payloadHash, 'deferred', 'knowledge_artifact'); outcomes.deferred = (outcomes.deferred ?? 0) + 1; return; }
      const repository = (context.bundle.records['projects.ndjson']!.find((project) => project.ref === candidate.projectRef)?.repository as BundleRecord | undefined)?.fullName;
      if (typeof repository !== 'string') { await this.recordCandidateOutcome(tx, context, sourceKey, payloadHash, 'deferred', 'knowledge_artifact'); outcomes.deferred = (outcomes.deferred ?? 0) + 1; return; }
      const [github] = await tx.select({ repository: githubRepositories }).from(githubProjectRepositories).innerJoin(githubRepositories, eq(githubProjectRepositories.repositoryId, githubRepositories.id)).where(and(eq(githubProjectRepositories.projectId, projectId), eq(githubRepositories.fullName, repository))).limit(1);
      const [artifact] = await tx.insert(knowledgeArtifacts).values({ workspaceId: context.workspaceId, projectId, type: 'git_reference', origin: 'git_backed', canonicality: 'candidate', verification: 'unverified', title: String(candidate.path), summary: String(candidate.reason ?? ''), createdByUserId: context.actor.id }).returning();
      await tx.insert(repositoryArtifactReferences).values({ workspaceId: context.workspaceId, artifactId: artifact!.id, githubRepositoryId: github?.repository.id ?? null, repositoryFullName: repository, path: String(candidate.path), sourceProjectId: projectId, verificationNote: 'Imported link-only candidate. Content was not copied and requires GitHub verification.' });
      const [mapping] = await tx.insert(externalObjectMappings).values({ workspaceId: context.workspaceId, externalSourceId: context.externalSourceId, importBatchId: context.batchId, sourceSystem: 'project-control', sourceKind: 'knowledge_artifact_candidate', sourceId: sourceKey, sourceKey, importKey: digest(sourceKey), bundleVersion: context.bundle.manifest.schemaVersion, sourcePayloadHash: payloadHash, targetEntityType: 'knowledge_artifact', targetEntityId: artifact!.id, status: 'created', createdTarget: true, importedAt: new Date() }).returning();
      await tx.insert(importCreatedObjects).values({ importBatchId: context.batchId, mappingId: mapping!.id, targetEntityType: 'knowledge_artifact', targetEntityId: artifact!.id, importedVersion: artifact!.version, importedContentHash: payloadHash });
      outcomes.created = (outcomes.created ?? 0) + 1;
    });
  }

  private async recordCandidateOutcome(tx: any, context: ImportContext, sourceKey: string, payloadHash: string, status: 'skipped' | 'deferred', targetType: string): Promise<void> {
    await tx.insert(externalObjectMappings).values({ workspaceId: context.workspaceId, externalSourceId: context.externalSourceId, importBatchId: context.batchId, sourceSystem: 'project-control', sourceKind: 'knowledge_artifact_candidate', sourceId: sourceKey, sourceKey, importKey: digest(sourceKey), bundleVersion: context.bundle.manifest.schemaVersion, sourcePayloadHash: payloadHash, targetEntityType: targetType, targetEntityId: null, status, createdTarget: false, importedAt: new Date() });
  }


}
