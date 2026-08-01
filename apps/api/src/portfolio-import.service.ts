import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from './auth';
import { ActivityService } from './activity.service';
import { slugify } from './common/ids';
import { DatabaseService } from './db/database.service';
import {
  checklistItems, externalObjectMappings, externalSources, flows, githubConnections, githubProjectRepositories, githubRepositories, importBatches, importConflicts, importCreatedObjects, importVerificationAttempts, importVerifications,
  knowledgeArtifactRevisions, knowledgeArtifacts, labels, labelAssignments, milestoneTasks, milestones, projectTaskCounters, projects, repositoryArtifactReferences,
  taskFlows, taskIdentifierAliases, tasks, workflowStates, workspaces,
} from './db/schema';
import { assertVerificationOutputOutsideBundle, loadMigrationBundle, type BundleRecord, type MigrationBundle } from './migration-bundle';
import { PortfolioKnowledgeService } from './portfolio-knowledge.service';

export type ProjectControlTaskDisposition = 'map_to_anklav' | 'archive_as_source_only' | 'cancel_as_superseded';
export type ImportOverrides = {
  sourceRepositoryVisibility?: 'accepted_public_disclosure' | 'repository_private';
  projectControlTasks?: Record<string, { disposition: ProjectControlTaskDisposition; targetProjectRef?: string }>;
  milestoneClassifications?: Record<string, 'anklav_flow' | 'anklav_milestone' | 'archive_candidate'>;
  /** Source-system flows only become active when this is explicitly retained or an Anklav-mapped task needs them. */
  sourceFlowDispositions?: Record<string, 'retain_as_active_flow' | 'archive_as_source_only'>;
  legacyLabels?: Record<string, 'target_label' | 'provenance_only'>;
};

export type ImportRequest = {
  bundle: string;
  workspace: string;
  overrides?: ImportOverrides;
  verifyChecksums?: boolean;
  requireSourceMappings?: boolean;
  /** Explicitly selects an amendment decision set created by amend(). */
  amendmentBatchId?: string;
};

type ResolvedTarget = { status: 'created' | 'matched' | 'skipped' | 'deferred' | 'review_required'; targetType: string; targetId?: string; created?: boolean; version?: number | null; contentHash?: string };
type ImportOutcome = Omit<ResolvedTarget, 'status'> & { status: string };
type ImportContext = { bundle: MigrationBundle; workspaceId: string; batchId: string; externalSourceId: string; actor: AuthUser; overrides: ImportOverrides; targets: Map<string, ResolvedTarget>; anklavProjectId: string; };

const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
const source = (record: BundleRecord) => record.source as BundleRecord | undefined;
const sourceKeyFor = (kind: string, record: BundleRecord) => {
  const detail = source(record);
  return detail?.system && detail.id ? `${detail.system}:${kind}:${detail.id}` : undefined;
};

function section(description: string, heading: string): string {
  return description.match(new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s|$)`, 'mi'))?.[1]?.trim() ?? '';
}

function checklist(description: string, heading: string): string[] {
  return section(description, heading).split('\n').map((line) => line.match(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/)?.[1]?.trim()).filter((line): line is string => Boolean(line));
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asDateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isProjectControlTask(record: BundleRecord): boolean { return record.importDisposition === 'requires_target_project_mapping'; }

/** Pure gate used by both the CLI plan and the guarded apply command. */
export function importPreflight(bundle: MigrationBundle, overrides: ImportOverrides, workspaceExists: boolean): Record<string, unknown> {
  const blocking: BundleRecord[] = [];
  const review: BundleRecord[] = [];
  const resolved: BundleRecord[] = [];
  for (const conflict of bundle.conflicts) {
    const code = String(conflict.code);
    if (['anklav-native-import-missing', 'anklav-milestones-not-in-api', 'anklav-context-packs-not-native'].includes(code)) { resolved.push({ ...conflict, resolution: 'implemented_by_phase_0_1' }); continue; }
    if (code === 'anklav-activity-import-not-native') { resolved.push({ ...conflict, resolution: 'no source activity is imported; availability is preserved as provenance' }); continue; }
    if (code === 'source-repository-visibility-undecided') {
      if (!overrides.sourceRepositoryVisibility) blocking.push({ ...conflict, requiredOverride: 'sourceRepositoryVisibility' }); else resolved.push({ ...conflict, resolution: overrides.sourceRepositoryVisibility });
      continue;
    }
    if (code === 'project-control-target-project-required' || code === 'milestone-human-review-required') continue;
    if (conflict.severity === 'blocking') blocking.push(conflict); else review.push(conflict);
  }
  const controlTasks = bundle.records['tasks.ndjson']!.filter(isProjectControlTask);
  const unresolvedTasks = controlTasks.filter((task) => !overrides.projectControlTasks?.[String(task.ref)]);
  if (unresolvedTasks.length) blocking.push({ code: 'project-control-target-project-required', count: unresolvedTasks.length, taskRefs: unresolvedTasks.map((task) => task.ref), message: 'Every project-control task requires map_to_anklav, archive_as_source_only, or cancel_as_superseded.' });
  for (const task of controlTasks) {
    const decision = overrides.projectControlTasks?.[String(task.ref)];
    if (decision?.disposition === 'map_to_anklav' && decision.targetProjectRef !== 'project:anklav') blocking.push({ code: 'invalid-project-control-target', taskRef: task.ref, message: 'Still-relevant project-control tasks may only map to the Anklav project.' });
  }
  const unclassified = bundle.records['milestone-classifications.ndjson']!.filter((entry) => entry.reviewRequired === true && !overrides.milestoneClassifications?.[String(entry.sourceLinearId)]);
  if (unclassified.length) blocking.push({ code: 'milestone-human-review-required', milestoneIds: unclassified.map((entry) => entry.sourceLinearId), message: 'Every human-review milestone needs flow, milestone, or archive_candidate.' });
  if (!workspaceExists) blocking.push({ code: 'target-workspace-required', message: 'The target workspace must exist before apply. Import never creates a workspace.' });
  return { workspaceExists, blocking, review, resolved, planned: { products: bundle.records['projects.ndjson']!.filter((entry) => entry.migrationRole === 'product').length, productTasks: bundle.records['tasks.ndjson']!.filter((entry) => entry.importDisposition === 'create_or_match').length, projectControlTasks: controlTasks.length, sourceMappings: bundle.records['source-mappings.ndjson']!.length, documents: bundle.records['linear-documents.ndjson']!.length, gitArtifactCandidates: bundle.records['knowledge-artifact-candidates.ndjson']!.length } };
}

@Injectable()
export class PortfolioImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly activity: ActivityService,
    private readonly knowledge: PortfolioKnowledgeService,
  ) {}

  async plan(request: ImportRequest): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, request.verifyChecksums !== false);
    const workspace = await this.findWorkspace(request.workspace);
    const summary = this.preflight(bundle, request.overrides ?? {}, Boolean(workspace));
    const drift = workspace ? await this.findDrift(bundle, workspace.id) : [];
    return {
      mode: 'plan', writes: false, bundle: { schemaVersion: bundle.manifest.schemaVersion, checksum: bundle.bundleChecksum, expectedCounts: bundle.expectedCounts },
      workspace: workspace ? { id: workspace.id, name: workspace.name, action: 'match' } : { name: 'Personal R&D', action: 'required_before_apply' },
      ...summary, drift,
      overridesTemplate: this.overridesTemplate(bundle, request.overrides ?? {}),
      verificationReport: 'migration/anklav/verification/anklav-import-verification.json',
    };
  }

  async apply(request: ImportRequest, actor: AuthUser): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const overrides = request.overrides ?? {};
    const preflight = this.preflight(bundle, overrides, Boolean(await this.findWorkspace(request.workspace)));
    if ((preflight.blocking as BundleRecord[]).length) throw new ConflictException({ title: 'Migration apply is blocked by unresolved decisions.', blocking: preflight.blocking, overridesTemplate: this.overridesTemplate(bundle, overrides) });
    const existingWorkspace = await this.findWorkspace(request.workspace);
    const drift = existingWorkspace ? await this.findDrift(bundle, existingWorkspace.id) : [];
    if (drift.length) throw new ConflictException({ title: 'Migration apply is blocked by source payload drift. Resolve it explicitly; Anklav will not overwrite imported targets.', drift });
    const initialized = await this.initialize(bundle, request.workspace, actor, overrides, request.amendmentBatchId);
    if (initialized.batch.status === 'completed') return { mode: 'apply', noOp: true, batch: initialized.batch, message: 'The same checksummed bundle and frozen overrides have already completed for this workspace.' };
    if (!['applying', 'interrupted', 'planned'].includes(initialized.batch.status)) throw new ConflictException(`Import batch ${initialized.batch.id} is ${initialized.batch.status}; start an explicit amendment or reapplication instead.`);
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

  /** Opens an explicit, auditable decision amendment. It does not mutate a prior batch. */
  async amend(request: ImportRequest, actor: AuthUser, priorBatchId: string): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const workspace = await this.findWorkspace(request.workspace);
    if (!workspace) throw new NotFoundException('Target workspace must exist before creating an import amendment.');
    const overrides = request.overrides ?? {};
    const overridesHash = digest(overrides);
    const [prior] = await this.database.db.select().from(importBatches).where(and(eq(importBatches.id, priorBatchId), eq(importBatches.workspaceId, workspace.id), eq(importBatches.bundleChecksum, bundle.bundleChecksum))).limit(1);
    if (!prior) throw new NotFoundException('The amendment base batch does not belong to this workspace and bundle.');
    if (prior.overridesHash === overridesHash) throw new ConflictException('An amendment must contain a different overrides hash. Reuse the original batch for unchanged decisions.');
    const [mapped] = await this.database.db.select({ count: sql<number>`count(*)::int` }).from(externalObjectMappings).where(eq(externalObjectMappings.importBatchId, prior.id));
    if (prior.status !== 'planned' || (mapped?.count ?? 0) > 0) throw new ConflictException('Applied import decisions cannot be amended in place. Roll back the batch, then create a clean reapplication batch with the new overrides.');
    const [existing] = await this.database.db.select().from(importBatches).where(and(eq(importBatches.externalSourceId, prior.externalSourceId), eq(importBatches.overridesHash, overridesHash), eq(importBatches.amendsBatchId, prior.id))).orderBy(desc(importBatches.createdAt)).limit(1);
    if (existing) return { mode: 'amend', noOp: true, batch: existing };
    const [batch] = await this.database.db.insert(importBatches).values({ workspaceId: workspace.id, externalSourceId: prior.externalSourceId, bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, bundlePathHash: digest(bundle.root), status: 'planned', actorUserId: actor.id, overridesHash, amendsBatchId: prior.id }).returning();
    await this.activity.append(this.database.db, { workspaceId: workspace.id, subjectType: 'import_batch', subjectId: batch!.id, action: 'amendment_created', actor, after: { amendsBatchId: prior.id, overridesHash } });
    return { mode: 'amend', noOp: false, batch };
  }

  async verify(request: ImportRequest, actor: AuthUser, verificationReport: string): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const workspace = await this.findWorkspace(request.workspace);
    if (!workspace) throw new NotFoundException('Target workspace not found.');
    const reportPath = assertVerificationOutputOutsideBundle(bundle.root, verificationReport);
    const batch = await this.frozenBatch(workspace.id, bundle, request.overrides ?? {}, request.amendmentBatchId);
    const report = await this.authoritativeVerification(bundle, workspace, batch, request.overrides ?? {}, actor);
    const content = JSON.stringify(report, null, 2);
    const checksum = digest(content);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
    await writeFile(`${reportPath}.sha256`, `${checksum}  anklav-import-verification.json\n`, { encoding: 'utf8', mode: 0o600 });
    await this.database.db.transaction(async (tx) => {
      if (report.passed) {
        await tx.update(externalObjectMappings).set({ lastVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(externalObjectMappings.importBatchId, batch.id));
        await tx.insert(importVerifications).values({ importBatchId: batch.id, reportPath: 'migration/anklav/verification/anklav-import-verification.json', reportChecksum: checksum, result: report, verifiedByUserId: actor.id }).onConflictDoUpdate({ target: importVerifications.importBatchId, set: { reportPath: 'migration/anklav/verification/anklav-import-verification.json', reportChecksum: checksum, result: report, verifiedAt: new Date(), verifiedByUserId: actor.id } });
        await this.activity.append(tx, { workspaceId: workspace.id, subjectType: 'import_batch', subjectId: batch.id, action: 'verified', actor, after: { reportChecksum: checksum } });
      } else {
        await tx.insert(importVerificationAttempts).values({ importBatchId: batch.id, reportPath: 'migration/anklav/verification/anklav-import-verification.json', reportChecksum: checksum, checks: report.checks, failures: report.failures, warnings: report.warnings, attemptedByUserId: actor.id });
        await this.activity.append(tx, { workspaceId: workspace.id, subjectType: 'import_batch', subjectId: batch.id, action: 'verification_failed', actor, after: { reportChecksum: checksum, failures: report.failures.length } });
      }
    });
    return { reportFile: 'anklav-import-verification.json', reportChecksum: checksum, report };
  }

  async rollback(request: ImportRequest, actor: AuthUser, guardedOverride = false): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const workspace = await this.findWorkspace(request.workspace);
    if (!workspace) throw new NotFoundException('Target workspace not found.');
    const batch = await this.frozenBatch(workspace.id, bundle, request.overrides ?? {}, request.amendmentBatchId);
    if (batch.status === 'rolled_back') return { batchId: batch.id, rolledBackObjects: 0, guardedOverride, noOp: true };
    const created = await this.database.db.select().from(importCreatedObjects).where(eq(importCreatedObjects.importBatchId, batch.id));
    const edited = await this.editedCreatedObjects(created);
    if (edited.length && !guardedOverride) throw new ConflictException({ title: 'Rollback refused: imported objects have been edited after import.', editedObjects: edited, guardedOverrideRequired: true });
    await this.database.db.transaction(async (tx) => {
      await tx.update(importBatches).set({ status: 'rolling_back', updatedAt: new Date() }).where(eq(importBatches.id, batch.id));
      for (const object of created) await this.softDeleteImportedObject(tx, object.targetEntityType, object.targetEntityId, actor.id);
      await tx.update(externalObjectMappings).set({ status: 'rolled_back', supersededAt: new Date(), updatedAt: new Date() }).where(eq(externalObjectMappings.importBatchId, batch.id));
      await tx.update(importBatches).set({ status: 'rolled_back', completedAt: new Date(), updatedAt: new Date() }).where(eq(importBatches.id, batch.id));
      await this.activity.append(tx, { workspaceId: workspace.id, subjectType: 'import_batch', subjectId: batch.id, action: 'rolled_back', actor, after: { objects: created.length, guardedOverride } });
    });
    return { batchId: batch.id, rolledBackObjects: created.length, guardedOverride };
  }

  private async findWorkspace(selector: string) {
    const byId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selector);
    return (await this.database.db.select().from(workspaces).where(and(byId ? eq(workspaces.id, selector) : sql`LOWER(${workspaces.name}) = ${normalized(selector)}`, isNull(workspaces.deletedAt))).limit(1))[0];
  }

  /** Every state-changing/read-verification command replays the same frozen decisions. */
  private async frozenBatch(workspaceId: string, bundle: MigrationBundle, overrides: ImportOverrides, amendmentBatchId?: string) {
    const overridesHash = digest(overrides);
    const candidates = await this.database.db.select().from(importBatches).where(and(eq(importBatches.workspaceId, workspaceId), eq(importBatches.bundleChecksum, bundle.bundleChecksum))).orderBy(desc(importBatches.createdAt));
    const batch = amendmentBatchId
      ? candidates.find((candidate) => candidate.id === amendmentBatchId)
      : candidates.find((candidate) => !candidate.amendsBatchId && candidate.overridesHash === overridesHash);
    if (!batch) {
      const known = candidates.map((candidate) => ({ id: candidate.id, overridesHash: candidate.overridesHash, status: candidate.status }));
      throw new ConflictException({ title: 'No import batch has this bundle and overrides identity. Changed decisions require an explicit amendment.', bundleChecksum: bundle.bundleChecksum, overridesHash, knownBatches: known });
    }
    if (batch.overridesHash !== overridesHash) throw new ConflictException('Incoming overrides do not match the frozen batch overrides hash.');
    return batch;
  }

  private preflight(bundle: MigrationBundle, overrides: ImportOverrides, workspaceExists: boolean): Record<string, unknown> {
    return importPreflight(bundle, overrides, workspaceExists);
  }

  private overridesTemplate(bundle: MigrationBundle, supplied: ImportOverrides): ImportOverrides {
    const projectControlTasks = Object.fromEntries(bundle.records['tasks.ndjson']!.filter(isProjectControlTask).map((task) => [String(task.ref), supplied.projectControlTasks?.[String(task.ref)] ?? { disposition: 'archive_as_source_only' as const }]));
    const milestoneClassifications = Object.fromEntries(bundle.records['milestone-classifications.ndjson']!.filter((entry) => entry.reviewRequired).map((entry) => [String(entry.sourceLinearId), supplied.milestoneClassifications?.[String(entry.sourceLinearId)] ?? 'archive_candidate' as const]));
    const sourceFlowDispositions = Object.fromEntries(bundle.records['linear-milestones.ndjson']!
      .filter((milestone) => milestone.projectRef === 'project:project-control' && milestone.proposedTarget === 'anklav_flow')
      .map((milestone) => [String((source(milestone) ?? {}).id), supplied.sourceFlowDispositions?.[String((source(milestone) ?? {}).id)] ?? 'archive_as_source_only' as const]));
    return { sourceRepositoryVisibility: supplied.sourceRepositoryVisibility, projectControlTasks, milestoneClassifications, sourceFlowDispositions };
  }

  private async initialize(bundle: MigrationBundle, selector: string, actor: AuthUser, overrides: ImportOverrides, amendmentBatchId?: string) {
    const currentWorkspace = await this.findWorkspace(selector);
    if (!currentWorkspace) throw new NotFoundException('Target workspace must exist before apply. An import never creates a workspace.');
    const overridesHash = digest(overrides);
    return this.database.db.transaction(async (tx) => {
      const [source] = await tx.insert(externalSources).values({ workspaceId: currentWorkspace.id, system: 'project-control', bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, sourceUri: bundle.manifest.bundle.path, metadata: { sourceOfTruth: bundle.sourceOfTruth } }).onConflictDoUpdate({ target: [externalSources.workspaceId, externalSources.system, externalSources.bundleVersion, externalSources.bundleChecksum], set: { updatedAt: new Date() } }).returning();
      const batches = await tx.select().from(importBatches).where(and(eq(importBatches.externalSourceId, source!.id), eq(importBatches.bundleChecksum, bundle.bundleChecksum))).orderBy(desc(importBatches.createdAt));
      if (amendmentBatchId) {
        const [amendment] = batches.filter((candidate) => candidate.id === amendmentBatchId && candidate.overridesHash === overridesHash);
        if (!amendment) throw new ConflictException('The requested amendment batch does not match this bundle and frozen overrides.');
        return { workspace: currentWorkspace, source: source!, batch: amendment };
      }
      const exact = batches.find((candidate) => candidate.overridesHash === overridesHash && !candidate.amendsBatchId);
      if (exact && exact.status !== 'rolled_back') return { workspace: currentWorkspace, source: source!, batch: exact };
      if (batches.some((candidate) => candidate.overridesHash !== overridesHash && candidate.status !== 'rolled_back')) {
        throw new ConflictException({ title: 'Import decisions are frozen for this bundle. Create an explicit amendment before applying changed overrides.', bundleChecksum: bundle.bundleChecksum, overridesHash, existingBatches: batches.map((candidate) => ({ id: candidate.id, status: candidate.status, overridesHash: candidate.overridesHash })) });
      }
      const [batch] = await tx.insert(importBatches).values({ workspaceId: currentWorkspace.id, externalSourceId: source!.id, bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, bundlePathHash: digest(bundle.root), status: 'applying', startedAt: new Date(), actorUserId: actor.id, overridesHash }).returning();
      await this.activity.append(tx, { workspaceId: currentWorkspace.id, subjectType: 'import_batch', subjectId: batch!.id, action: 'created', actor, after: { bundleChecksum: bundle.bundleChecksum, bundleVersion: bundle.manifest.schemaVersion } });
      return { workspace: currentWorkspace, source: source!, batch: batch! };
    });
  }

  private async ensureAnklavProject(workspaceId: string, actor: AuthUser, batchId: string): Promise<string> {
    const [existing] = await this.database.db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), sql`LOWER(${projects.repositoryReference}) = 'kstroevsky/anklav'`, isNull(projects.deletedAt))).limit(1);
    if (existing) return existing.id;
    const [byName] = await this.database.db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), sql`LOWER(${projects.name}) = 'anklav'`, isNull(projects.deletedAt))).limit(1);
    if (byName) return byName.id;
    return this.database.db.transaction(async (tx) => {
      const [again] = await tx.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), sql`LOWER(${projects.name}) = 'anklav'`, isNull(projects.deletedAt))).limit(1);
      if (again) return again.id;
      const [previous] = await tx.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), sql`LOWER(${projects.name}) = 'anklav'`)).orderBy(desc(projects.updatedAt)).limit(1);
      if (previous?.deletedAt) {
        const [restored] = await tx.update(projects).set({ deletedAt: null, deletedByUserId: null, version: sql`${projects.version} + 1`, updatedAt: new Date() }).where(eq(projects.id, previous.id)).returning();
        const sourceKey = 'anklav:migration-control-project:anklav';
        const externalSourceId = (await tx.select({ externalSourceId: importBatches.externalSourceId }).from(importBatches).where(eq(importBatches.id, batchId)).limit(1))[0]!.externalSourceId;
        const [mapping] = await tx.insert(externalObjectMappings).values({ workspaceId, externalSourceId, importBatchId: batchId, sourceSystem: 'anklav', sourceKind: 'migration_control_project', sourceId: 'anklav', sourceKey, importKey: digest(sourceKey), sourceUrl: null, bundleVersion: '1.2.0', sourcePayloadHash: digest(sourceKey), targetEntityType: 'project', targetEntityId: restored!.id, status: 'created', createdTarget: true, importedAt: new Date() }).returning();
        await tx.insert(importCreatedObjects).values({ importBatchId: batchId, mappingId: mapping!.id, targetEntityType: 'project', targetEntityId: restored!.id, importedVersion: restored!.version, importedContentHash: digest(sourceKey) });
        return restored!.id;
      }
      const [project] = await tx.insert(projects).values({ workspaceId, name: 'Anklav', issueKey: 'ANKLAV', status: 'active', repositoryReference: 'kstroevsky/anklav', currentStateSummary: 'Portfolio control system.' }).returning();
      const sourceKey = 'anklav:migration-control-project:anklav';
      const [mapping] = await tx.insert(externalObjectMappings).values({ workspaceId, externalSourceId: (await tx.select({ externalSourceId: importBatches.externalSourceId }).from(importBatches).where(eq(importBatches.id, batchId)).limit(1))[0]!.externalSourceId, importBatchId: batchId, sourceSystem: 'anklav', sourceKind: 'migration_control_project', sourceId: 'anklav', sourceKey, importKey: digest(sourceKey), sourceUrl: null, bundleVersion: '1.2.0', sourcePayloadHash: digest(sourceKey), targetEntityType: 'project', targetEntityId: project!.id, status: 'created', createdTarget: true, importedAt: new Date() }).returning();
      await tx.insert(importCreatedObjects).values({ importBatchId: batchId, mappingId: mapping!.id, targetEntityType: 'project', targetEntityId: project!.id, importedVersion: project!.version, importedContentHash: digest(sourceKey) });
      await this.activity.append(tx, { workspaceId, subjectType: 'project', subjectId: project!.id, action: 'import_created_control_project', actor, metadata: { importBatchId: batchId } });
      return project!.id;
    });
  }

  private async persistBundleConflicts(tx: any, context: ImportContext): Promise<void> {
    const resolvedCodes = new Set(['anklav-native-import-missing', 'anklav-milestones-not-in-api', 'anklav-context-packs-not-native', 'anklav-activity-import-not-native', 'source-repository-visibility-undecided', 'project-control-target-project-required', 'milestone-human-review-required']);
    for (const conflict of context.bundle.conflicts) {
      const code = String(conflict.code);
      const sourceKey = typeof conflict.sourceMilestoneId === 'string' ? `linear:milestone:${conflict.sourceMilestoneId}` : null;
      const status = resolvedCodes.has(code) ? 'resolved' : code === 'github-mappings-require-integration' || code === 'repository-checkout-dirty' || code === 'source-export-unavailable' ? 'deferred' : 'open';
      const resolution = code === 'source-repository-visibility-undecided' ? { decision: context.overrides.sourceRepositoryVisibility } : code === 'project-control-target-project-required' ? { taskDispositions: context.overrides.projectControlTasks } : code === 'milestone-human-review-required' ? { milestoneDecision: context.overrides.milestoneClassifications?.[String(conflict.sourceMilestoneId)] } : { handledBy: status === 'resolved' ? 'phase_0_1' : 'deferred' };
      await tx.insert(importConflicts).values({ importBatchId: context.batchId, code, severity: conflict.severity as any, status, sourceKey, message: String(conflict.message), resolution, resolvedAt: status === 'resolved' ? new Date() : null }).onConflictDoNothing();
    }
  }

  private mappingOrder(mapping: BundleRecord): number { return ({ workspace: 0, team: 1, initiative: 2, workflow_state: 3, label: 4, project: 5, milestone: 6, issue: 7, document: 8 } as Record<string, number>)[String(mapping.sourceKind)] ?? 99; }

  private recordIndex(bundle: MigrationBundle): Map<string, BundleRecord> {
    const output = new Map<string, BundleRecord>();
    for (const rows of Object.values(bundle.records)) for (const record of rows) if (typeof record.ref === 'string') output.set(record.ref, record);
    return output;
  }

  private async findDrift(bundle: MigrationBundle, workspaceId: string): Promise<{ sourceKey: string; targetEntityType: string; targetEntityId: string | null }[]> {
    const existing = await this.database.db.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.workspaceId, workspaceId), isNull(externalObjectMappings.supersededAt)));
    const existingByKey = new Map(existing.map((mapping) => [mapping.sourceKey, mapping]));
    const index = this.recordIndex(bundle);
    return bundle.records['source-mappings.ndjson']!.flatMap((mapping) => {
      const previous = existingByKey.get(String(mapping.sourceKey));
      const currentHash = digest(index.get(String(mapping.targetRef)) ?? mapping);
      return previous && previous.sourcePayloadHash !== currentHash ? [{ sourceKey: previous.sourceKey, targetEntityType: previous.targetEntityType, targetEntityId: previous.targetEntityId }] : [];
    });
  }

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

  private async resolveTarget(tx: any, context: ImportContext, mapping: BundleRecord, record?: BundleRecord): Promise<ResolvedTarget> {
    const kind = String(mapping.sourceKind);
    if (kind === 'workspace' || kind === 'team') return { status: 'matched', targetType: 'workspace', targetId: context.workspaceId };
    if (kind === 'initiative') return { status: 'skipped', targetType: 'portfolio_provenance' };
    if (!record) return { status: 'deferred', targetType: String(mapping.targetType) };
    if (kind === 'workflow_state') return this.importWorkflow(tx, context, record);
    if (kind === 'label') return this.importLabel(tx, context, record);
    if (kind === 'project') return this.importProject(tx, context, record);
    if (kind === 'milestone') return this.importMilestoneOrFlow(tx, context, record);
    if (kind === 'issue') return this.importTask(tx, context, record);
    if (kind === 'document') return this.importDocument(tx, context, record);
    return { status: 'deferred', targetType: String(mapping.targetType) };
  }

  private async importWorkflow(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    if (record.importDisposition !== 'target_workflow') return { status: 'skipped', targetType: 'workflow_state_provenance' };
    const semantic = String(record.semantic);
    const [matched] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.taskSemantic, semantic as any), isNull(workflowStates.archivedAt))).orderBy(asc(workflowStates.position)).limit(1);
    if (matched) return { status: 'matched', targetType: 'workflow_state', targetId: matched.id, version: matched.version };
    const detail = source(record) ?? {};
    const [created] = await tx.insert(workflowStates).values({ workspaceId: context.workspaceId, entityType: 'task', name: String(detail.name), color: typeof detail.color === 'string' ? detail.color : '#64748b', taskSemantic: semantic as any, position: Number(detail.position) || 1000, isInitial: semantic === 'inbox' }).returning();
    return { status: 'created', targetType: 'workflow_state', targetId: created!.id, created: true, version: created!.version };
  }

  private async importLabel(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const detail = source(record) ?? {};
    if (record.importDisposition !== 'target_label' && context.overrides.legacyLabels?.[String(record.ref)] !== 'target_label') return { status: 'skipped', targetType: 'label_provenance' };
    const name = String(detail.name);
    const [matched] = await tx.select().from(labels).where(and(eq(labels.workspaceId, context.workspaceId), sql`LOWER(${labels.name}) = ${normalized(name)}`, isNull(labels.deletedAt))).limit(1);
    if (matched) return { status: 'matched', targetType: 'label', targetId: matched.id, version: matched.version };
    const [deleted] = await tx.select().from(labels).where(and(eq(labels.workspaceId, context.workspaceId), sql`LOWER(${labels.name}) = ${normalized(name)}`)).orderBy(desc(labels.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(labels).set({ deletedAt: null, deletedByUserId: null, version: sql`${labels.version} + 1`, updatedAt: new Date() }).where(eq(labels.id, deleted.id)).returning();
      return { status: 'created', targetType: 'label', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [created] = await tx.insert(labels).values({ workspaceId: context.workspaceId, name, color: typeof detail.color === 'string' ? detail.color : '#64748b', description: typeof detail.description === 'string' ? detail.description : '' }).returning();
    return { status: 'created', targetType: 'label', targetId: created!.id, created: true, version: created!.version };
  }

  private async importProject(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    if (record.migrationRole !== 'product' || record.createActiveTargetProject !== true) return { status: 'skipped', targetType: 'source_system_project' };
    const repository = (record.repository as BundleRecord | undefined)?.fullName;
    const [matched] = await tx.select().from(projects).where(and(eq(projects.workspaceId, context.workspaceId), isNull(projects.deletedAt), or(sql`LOWER(${projects.name}) = ${normalized(String(record.name))}`, typeof repository === 'string' ? sql`LOWER(${projects.repositoryReference}) = ${normalized(repository)}` : undefined))).limit(1);
    if (matched) { await this.linkConfiguredRepository(tx, context.workspaceId, matched.id, repository); return { status: 'matched', targetType: 'project', targetId: matched.id, version: matched.version }; }
    const [deleted] = await tx.select().from(projects).where(and(eq(projects.workspaceId, context.workspaceId), or(sql`LOWER(${projects.name}) = ${normalized(String(record.name))}`, typeof repository === 'string' ? sql`LOWER(${projects.repositoryReference}) = ${normalized(repository)}` : undefined))).orderBy(desc(projects.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(projects).set({ deletedAt: null, deletedByUserId: null, version: sql`${projects.version} + 1`, updatedAt: new Date() }).where(eq(projects.id, deleted.id)).returning();
      await this.linkConfiguredRepository(tx, context.workspaceId, restored!.id, repository);
      return { status: 'created', targetType: 'project', targetId: restored!.id, created: true, version: restored!.version };
    }
    const base = slugify(String(record.name)).replaceAll('-', '').toUpperCase().slice(0, 8) || 'PROJ';
    const [created] = await tx.insert(projects).values({ workspaceId: context.workspaceId, name: String(record.name), issueKey: base, status: 'active', repositoryReference: typeof repository === 'string' ? repository : '', currentStateSummary: typeof (record.context as BundleRecord | undefined)?.state === 'string' ? `Git-backed state: ${(record.context as BundleRecord).state}` : '' }).returning();
    await this.linkConfiguredRepository(tx, context.workspaceId, created!.id, repository);
    return { status: 'created', targetType: 'project', targetId: created!.id, created: true, version: created!.version };
  }

  private async importMilestoneOrFlow(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const detail = source(record) ?? {};
    const classification = context.bundle.records['milestone-classifications.ndjson']!.find((entry) => entry.sourceLinearId === detail.id);
    const desired = classification?.reviewRequired ? context.overrides.milestoneClassifications?.[String(detail.id)] : record.proposedTarget;
    if (!desired || desired === 'archive_candidate') return { status: 'skipped', targetType: 'milestone_provenance' };
    if (desired === 'anklav_flow') {
      const isSourceSystemFlow = record.projectRef === 'project:project-control';
      const linkedTasks = context.bundle.records['tasks.ndjson']!.filter((task) => (task.milestone as BundleRecord | null)?.sourceId === detail.id);
      const hasMappedTask = linkedTasks.some((task) => context.overrides.projectControlTasks?.[String(task.ref)]?.disposition === 'map_to_anklav');
      const explicitlyRetained = context.overrides.sourceFlowDispositions?.[String(detail.id)] === 'retain_as_active_flow';
      if (isSourceSystemFlow && !hasMappedTask && !explicitlyRetained) return { status: 'skipped', targetType: 'flow_provenance' };
      const [existing] = await tx.select().from(flows).where(and(eq(flows.workspaceId, context.workspaceId), sql`LOWER(${flows.name}) = ${normalized(String(detail.name))}`, isNull(flows.deletedAt))).limit(1);
      if (existing) return { status: 'matched', targetType: 'flow', targetId: existing.id, version: existing.version };
      const [state] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'flow'), eq(workflowStates.flowSemantic, 'active'), isNull(workflowStates.archivedAt))).limit(1);
      if (!state) return { status: 'deferred', targetType: 'flow' };
      const [created] = await tx.insert(flows).values({ workspaceId: context.workspaceId, name: String(detail.name), purpose: String(detail.description ?? classification?.rationale ?? ''), workflowStateId: state.id, priority: 'none', health: 'unknown', scope: 'all_projects' }).returning();
      return { status: 'created', targetType: 'flow', targetId: created!.id, created: true, version: created!.version };
    }
    const project = await this.projectForMilestone(context, record);
    if (!project) return { status: 'deferred', targetType: 'milestone' };
    const [existing] = await tx.select().from(milestones).where(and(eq(milestones.projectId, project), eq(milestones.name, String(detail.name)), isNull(milestones.deletedAt))).limit(1);
    if (existing) return { status: 'matched', targetType: 'milestone', targetId: existing.id, version: existing.version };
    const [deleted] = await tx.select().from(milestones).where(and(eq(milestones.projectId, project), eq(milestones.name, String(detail.name)))).orderBy(desc(milestones.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(milestones).set({ deletedAt: null, deletedByUserId: null, version: sql`${milestones.version} + 1`, updatedAt: new Date() }).where(eq(milestones.id, deleted.id)).returning();
      return { status: 'created', targetType: 'milestone', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [created] = await tx.insert(milestones).values({ workspaceId: context.workspaceId, projectId: project, name: String(detail.name), description: String(detail.description ?? classification?.rationale ?? ''), targetDate: typeof detail.targetDate === 'string' ? detail.targetDate : null }).returning();
    return { status: 'created', targetType: 'milestone', targetId: created!.id, created: true, version: created!.version };
  }

  private async projectForMilestone(context: ImportContext, record: BundleRecord): Promise<string | undefined> {
    const projectRef = record.projectRef;
    const mapped = typeof projectRef === 'string' ? context.targets.get(projectRef) : undefined;
    if (mapped?.targetId) return mapped.targetId;
    if (projectRef === 'project:project-control') {
      const linkedTasks = context.bundle.records['tasks.ndjson']!.filter((task) => (task.milestone as BundleRecord | null)?.sourceId === (source(record) ?? {}).id);
      return linkedTasks.some((task) => context.overrides.projectControlTasks?.[String(task.ref)]?.disposition === 'map_to_anklav') ? context.anklavProjectId : undefined;
    }
    return undefined;
  }

  private async importTask(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    let projectRef = record.targetProjectRef as string | null;
    if (isProjectControlTask(record)) {
      const decision = context.overrides.projectControlTasks?.[String(record.ref)];
      if (!decision || decision.disposition !== 'map_to_anklav') return { status: 'skipped', targetType: 'task_provenance' };
      projectRef = 'project:anklav';
    }
    const projectId = projectRef === 'project:anklav' ? context.anklavProjectId : context.targets.get(String(projectRef))?.targetId;
    if (!projectId) return { status: 'deferred', targetType: 'task' };
    const originalIdentifier = String((source(record) ?? {}).identifier);
    const [matched] = await tx.select({ task: tasks }).from(tasks).leftJoin(taskIdentifierAliases, eq(taskIdentifierAliases.taskId, tasks.id)).where(and(eq(tasks.workspaceId, context.workspaceId), or(eq(tasks.identifier, originalIdentifier), eq(taskIdentifierAliases.identifier, originalIdentifier)))).orderBy(desc(tasks.updatedAt)).limit(1);
    if (matched?.task && !matched.task.deletedAt) return { status: 'matched', targetType: 'task', targetId: matched.task.id, version: matched.task.version };
    if (matched?.task?.deletedAt) {
      const [restored] = await tx.update(tasks).set({ deletedAt: null, deletedByUserId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(eq(tasks.id, matched.task.id)).returning();
      return { status: 'created', targetType: 'task', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [state] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.taskSemantic, String((record.status as BundleRecord).semantic) as any), isNull(workflowStates.archivedAt))).limit(1);
    if (!state) return { status: 'deferred', targetType: 'task' };
    await tx.insert(projectTaskCounters).values({ projectId, nextNumber: 1 }).onConflictDoNothing();
    const [counter] = await tx.update(projectTaskCounters).set({ nextNumber: sql`${projectTaskCounters.nextNumber} + 1`, updatedAt: new Date() }).where(eq(projectTaskCounters.projectId, projectId)).returning();
    const [project] = await tx.select({ issueKey: projects.issueKey }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const number = counter!.nextNumber - 1;
    const description = String(record.description);
    const dates = (record.dates ?? source(record)?.dates ?? {}) as BundleRecord;
    const semantic = String((record.status as BundleRecord).semantic);
    const completed = asDate(dates.completedAt ?? dates.completed_at);
    const [created] = await tx.insert(tasks).values({
      workspaceId: context.workspaceId, projectId, title: String(record.title), description, taskNumber: number, identifier: `${project!.issueKey}-${number}`, workflowStateId: state.id, priority: record.priority as any,
      humanReviewRequired: semantic === 'human_review', reviewStatus: semantic === 'human_review' ? 'pending' : 'not_required',
      dueDate: asDateOnly(dates.dueDate ?? dates.due_date), startedAt: asDate(dates.startedAt ?? dates.started_at), completedAt: completed, cancelledAt: asDate(dates.cancelledAt ?? dates.canceledAt ?? dates.cancelled_at ?? dates.canceled_at),
      verificationRequirements: section(description, 'Verification required'),
      verificationPerformed: completed && typeof record.verificationPerformed === 'string' ? String(record.verificationPerformed) : '',
      completionEvidence: completed && typeof record.completionEvidence === 'string' ? String(record.completionEvidence) : '',
      nonGoals: section(description, 'Non-goals'), remainingLimitations: section(description, 'Remaining limitations'), followUpWork: section(description, 'Follow-up work'),
    }).returning();
    await tx.insert(taskIdentifierAliases).values({ workspaceId: context.workspaceId, taskId: created!.id, identifier: originalIdentifier }).onConflictDoNothing();
    const acceptance = checklist(description, 'Acceptance criteria');
    if (acceptance.length) await tx.insert(checklistItems).values(acceptance.map((text, position) => ({ taskId: created!.id, kind: 'acceptance' as const, text, position })));
    for (const label of record.labels as BundleRecord[]) {
      if (label.importDisposition !== 'target_label') continue;
      const target = context.targets.get(`label:${label.sourceId}`);
      if (target?.targetId) await tx.insert(labelAssignments).values({ labelId: target.targetId, taskId: created!.id }).onConflictDoNothing();
    }
    const milestone = record.milestone as BundleRecord | null;
    if (milestone?.sourceId) {
      const target = context.targets.get(`milestone:${milestone.sourceId}`);
      if (target?.targetType === 'flow' && target.targetId) await tx.insert(taskFlows).values({ taskId: created!.id, flowId: target.targetId, role: 'primary', createdByUserId: context.actor.id }).onConflictDoNothing();
      if (target?.targetType === 'milestone' && target.targetId) await tx.insert(milestoneTasks).values({ milestoneId: target.targetId, taskId: created!.id }).onConflictDoNothing();
    }
    for (const url of record.githubLinks as string[]) await tx.insert(importConflicts).values({ importBatchId: context.batchId, code: 'github-link-deferred', severity: 'prerequisite', status: 'deferred', sourceKey: url, message: `Deferred GitHub evidence for ${created!.identifier}: ${url}`, resolution: { taskId: created!.id, url } }).onConflictDoNothing();
    return { status: 'created', targetType: 'task', targetId: created!.id, created: true, version: created!.version };
  }

  private async linkConfiguredRepository(tx: any, workspaceId: string, projectId: string, repository: unknown): Promise<void> {
    if (typeof repository !== 'string') return;
    const [github] = await tx.select({ repositoryId: githubRepositories.id }).from(githubRepositories).innerJoin(githubConnections, eq(githubRepositories.connectionId, githubConnections.id)).where(and(eq(githubConnections.workspaceId, workspaceId), eq(githubRepositories.fullName, repository), eq(githubRepositories.installed, true))).limit(1);
    if (github) await tx.insert(githubProjectRepositories).values({ repositoryId: github.repositoryId, projectId, syncMode: 'none' }).onConflictDoNothing();
  }

  private async importDocument(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const projectId = context.targets.get(String(record.projectRef))?.targetId;
    const [existing] = await tx.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.workspaceId, context.workspaceId), eq(knowledgeArtifacts.title, String(record.title)), eq(knowledgeArtifacts.origin, 'legacy_source'), projectId ? eq(knowledgeArtifacts.projectId, projectId) : undefined, isNull(knowledgeArtifacts.deletedAt))).limit(1);
    if (existing) return { status: 'matched', targetType: 'knowledge_artifact', targetId: existing.id, version: existing.version };
    const [artifact] = await tx.insert(knowledgeArtifacts).values({ workspaceId: context.workspaceId, projectId: projectId ?? null, type: 'legacy_document', origin: 'legacy_source', canonicality: 'candidate', verification: 'unverified', title: String(record.title), summary: `Imported Linear document; canonical repository path candidate: ${String(record.canonicalPath ?? '')}`, createdByUserId: context.actor.id }).returning();
    const content = String(record.content ?? '');
    const [revision] = await tx.insert(knowledgeArtifactRevisions).values({ workspaceId: context.workspaceId, artifactId: artifact!.id, revision: 1, nativeContent: content, contentHash: digest(content), importedAt: new Date(), createdByUserId: context.actor.id }).returning();
    await tx.update(knowledgeArtifacts).set({ currentRevisionId: revision!.id }).where(eq(knowledgeArtifacts.id, artifact!.id));
    return { status: 'created', targetType: 'knowledge_artifact', targetId: artifact!.id, created: true, version: artifact!.version, contentHash: digest(content) };
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

  private async authoritativeVerification(bundle: MigrationBundle, workspace: typeof workspaces.$inferSelect, batch: typeof importBatches.$inferSelect, overrides: ImportOverrides, actor: AuthUser) {
    type Check = { name: string; passed: boolean; details?: Record<string, unknown> };
    const checks: Check[] = [];
    const add = (name: string, passed: boolean, details?: Record<string, unknown>) => checks.push({ name, passed, ...(details ? { details } : {}) });
    const mappings = await this.database.db.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.importBatchId, batch.id), isNull(externalObjectMappings.supersededAt)));
    const expectedMappings = bundle.records['source-mappings.ndjson']!;
    const expectedKeys = expectedMappings.map((entry) => String(entry.sourceKey));
    const candidateKeys = bundle.records['knowledge-artifact-candidates.ndjson']!.map((candidate) => `project-control:artifact-candidate:${candidate.projectRef}:${candidate.path}`);
    const expectedOutcomeKeys = [...expectedKeys, ...candidateKeys];
    const byKey = new Map<string, typeof mappings>();
    for (const mapping of mappings) byKey.set(mapping.sourceKey, [...(byKey.get(mapping.sourceKey) ?? []), mapping]);
    const missingOrDuplicate = expectedOutcomeKeys.filter((key) => (byKey.get(key)?.length ?? 0) !== 1);
    add('import_batch_completed', batch.status === 'completed', { status: batch.status });
    add('bundle_checksums_valid', true, { checksummedFiles: bundle.checksums.size });
    add('expected_counts_valid', true, { expectedCounts: bundle.expectedCounts });
    add('every_source_mapping_has_exactly_one_outcome', missingOrDuplicate.length === 0, { keys: missingOrDuplicate });

    const productTaskMappings = expectedMappings.filter((mapping) => {
      const task = this.recordIndex(bundle).get(String(mapping.targetRef));
      return mapping.sourceKind === 'issue' && task?.importDisposition === 'create_or_match';
    }).map((mapping) => byKey.get(String(mapping.sourceKey))?.[0]).filter(Boolean) as typeof mappings;
    const missingProductTasks = await this.missingActiveTargets(productTaskMappings, 'task');
    add('product_tasks_resolve_to_active_native_tasks', missingProductTasks.length === 0, { mappings: missingProductTasks });

    const controlTasks = bundle.records['tasks.ndjson']!.filter(isProjectControlTask);
    const incorrectControlTasks: string[] = [];
    for (const task of controlTasks) {
      const mapping = expectedMappings.find((entry) => entry.targetRef === task.ref);
      const outcome = mapping ? byKey.get(String(mapping.sourceKey))?.[0] : undefined;
      const disposition = overrides.projectControlTasks?.[String(task.ref)]?.disposition;
      if (!outcome || !disposition || (disposition === 'map_to_anklav' && (!outcome.targetEntityId || outcome.targetEntityType !== 'task' || !(await this.targetIsActive('task', outcome.targetEntityId)))) || (disposition !== 'map_to_anklav' && outcome.status !== 'skipped')) incorrectControlTasks.push(String(task.ref));
    }
    add('project_control_tasks_resolve_to_their_explicit_disposition', incorrectControlTasks.length === 0, { tasks: incorrectControlTasks });

    const identifiersPreserved = await this.originalIdentifiersPreserved(workspace.id, bundle);
    const sourceUrlMismatches = expectedMappings.filter((expected) => {
      const mapping = byKey.get(String(expected.sourceKey))?.[0];
      return Boolean(expected.sourceUrl) && mapping?.sourceUrl !== expected.sourceUrl;
    }).map((entry) => String(entry.sourceKey));
    add('original_identifiers_and_source_urls_preserved', identifiersPreserved && sourceUrlMismatches.length === 0, { sourceUrlMismatches });

    const candidateOutcomes = candidateKeys.map((key) => byKey.get(key)?.[0]);
    const invalidCandidates = candidateKeys.filter((key, index) => !candidateOutcomes[index] || !['created', 'matched', 'skipped', 'deferred'].includes(candidateOutcomes[index]!.status));
    add('git_artifact_candidates_have_recorded_outcomes', invalidCandidates.length === 0, { keys: invalidCandidates });

    const drift = await this.findDrift(bundle, workspace.id);
    add('no_source_payload_drift', drift.length === 0 && !mappings.some((mapping) => mapping.status === 'drift'), { drift });

    const requiredMappings = mappings.filter((mapping) => ['created', 'matched'].includes(mapping.status) && Boolean(mapping.targetEntityId));
    const missingTargets: string[] = [];
    for (const mapping of requiredMappings) if (!await this.targetIsActive(mapping.targetEntityType, mapping.targetEntityId!)) missingTargets.push(mapping.sourceKey);
    add('no_required_target_entity_missing_or_soft_deleted', missingTargets.length === 0, { sourceKeys: missingTargets });

    const openBlocking = await this.database.db.select().from(importConflicts).where(and(eq(importConflicts.importBatchId, batch.id), eq(importConflicts.severity, 'blocking'), eq(importConflicts.status, 'open')));
    const preflight = this.preflight(bundle, overrides, true);
    add('no_blocking_import_conflict_remains_open', openBlocking.length === 0 && (preflight.blocking as unknown[]).length === 0, { openConflicts: openBlocking.map((conflict) => conflict.code), unresolvedDecisions: preflight.blocking });

    const packFailures: string[] = [];
    const taskOutcomes = [...productTaskMappings, ...controlTasks.filter((task) => overrides.projectControlTasks?.[String(task.ref)]?.disposition === 'map_to_anklav').map((task) => {
      const mapping = expectedMappings.find((entry) => entry.targetRef === task.ref);
      return mapping ? byKey.get(String(mapping.sourceKey))?.[0] : undefined;
    }).filter(Boolean) as typeof mappings];
    for (const mapping of taskOutcomes) {
      try { await this.knowledge.getTaskContextPack(workspace.id, actor, mapping.targetEntityId!); } catch (error) { packFailures.push(`${mapping.sourceKey}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    add('every_imported_task_generates_a_deterministic_context_pack', packFailures.length === 0, { failures: packFailures });

    const bundleText = JSON.stringify(bundle.records);
    const rawChatDetected = /\b(chatgpt|claude(?:\s+code)?|codex)\s+(?:session|conversation|transcript)\b/i.test(bundleText) && /"(?:messages|rawContent|sessionMessages)"/i.test(bundleText);
    const credentialDetected = /(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/.test(bundleText);
    add('no_raw_chat_content_or_credentials_imported', !rawChatDetected && !credentialDetected, { rawChatDetected, credentialDetected });

    const failures = checks.filter((check) => !check.passed).map((check) => ({ check: check.name, details: check.details ?? {} }));
    const conflicts = await this.database.db.select().from(importConflicts).where(eq(importConflicts.importBatchId, batch.id));
    const outcomes = {
      sourceRecords: expectedOutcomeKeys.length,
      createdTargets: mappings.filter((entry) => entry.status === 'created').length,
      matchedTargets: mappings.filter((entry) => entry.status === 'matched').length,
      skippedTargets: mappings.filter((entry) => entry.status === 'skipped').length,
      reviewRequiredRecords: mappings.filter((entry) => entry.status === 'review_required').length,
      deferredRecords: mappings.filter((entry) => entry.status === 'deferred').length,
      failedRecords: mappings.filter((entry) => entry.status === 'failed' || entry.status === 'drift').length,
    };
    return {
      schemaVersion: '1.1', generatedAt: new Date().toISOString(), passed: failures.length === 0,
      batch: { id: batch.id, status: batch.status, bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, overridesHash: batch.overridesHash },
      checks, failures,
      warnings: conflicts.filter((conflict) => conflict.severity === 'warning' || conflict.status === 'deferred').map((conflict) => ({ code: conflict.code, message: conflict.message, status: conflict.status })),
      outcomes,
      resolvedConflicts: conflicts.filter((conflict) => conflict.status === 'resolved').map((conflict) => ({ code: conflict.code, resolution: conflict.resolution })),
      remainingHumanDecisions: preflight.blocking,
      securityFindings: ['Verification output is outside the immutable bundle.', 'Bundle paths, symlinks, oversized files, and oversized NDJSON records are rejected before import.', 'Phase 1 has no session ingestion endpoint or raw-session storage.'],
    };
  }

  private async missingActiveTargets(mappings: typeof externalObjectMappings.$inferSelect[], expectedType: string): Promise<string[]> {
    const missing: string[] = [];
    for (const mapping of mappings) if (mapping.targetEntityType !== expectedType || !mapping.targetEntityId || !await this.targetIsActive(mapping.targetEntityType, mapping.targetEntityId)) missing.push(mapping.sourceKey);
    return missing;
  }

  private async targetIsActive(type: string, id: string): Promise<boolean> {
    if (type === 'workspace') return Boolean((await this.database.db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt))).limit(1))[0]);
    if (type === 'task') return Boolean((await this.database.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), isNull(tasks.deletedAt))).limit(1))[0]);
    if (type === 'project') return Boolean((await this.database.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))).limit(1))[0]);
    if (type === 'flow') return Boolean((await this.database.db.select({ id: flows.id }).from(flows).where(and(eq(flows.id, id), isNull(flows.deletedAt))).limit(1))[0]);
    if (type === 'milestone') return Boolean((await this.database.db.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.id, id), isNull(milestones.deletedAt))).limit(1))[0]);
    if (type === 'workflow_state') return Boolean((await this.database.db.select({ id: workflowStates.id }).from(workflowStates).where(and(eq(workflowStates.id, id), isNull(workflowStates.archivedAt))).limit(1))[0]);
    if (type === 'label') return Boolean((await this.database.db.select({ id: labels.id }).from(labels).where(and(eq(labels.id, id), isNull(labels.deletedAt))).limit(1))[0]);
    if (type === 'knowledge_artifact') return Boolean((await this.database.db.select({ id: knowledgeArtifacts.id }).from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.id, id), isNull(knowledgeArtifacts.deletedAt))).limit(1))[0]);
    return type.includes('provenance');
  }

  private async originalIdentifiersPreserved(workspaceId: string, bundle: MigrationBundle): Promise<boolean> {
    const nativeIdentifiers = bundle.records['tasks.ndjson']!.filter((task) => task.importDisposition === 'create_or_match').map((task) => String((source(task) ?? {}).identifier));
    const rows = nativeIdentifiers.length ? await this.database.db.select({ identifier: taskIdentifierAliases.identifier }).from(taskIdentifierAliases).where(and(eq(taskIdentifierAliases.workspaceId, workspaceId), sql`${taskIdentifierAliases.identifier} = ANY(${nativeIdentifiers})`)) : [];
    if (new Set(rows.map((row) => row.identifier)).size !== nativeIdentifiers.length) return false;
    // Archived project-control tasks have no native task by design; their original
    // Linear identifier remains resolvable in the immutable source URL provenance.
    return bundle.records['tasks.ndjson']!.filter(isProjectControlTask).every((task) => {
      const identifier = String((source(task) ?? {}).identifier);
      const mapping = bundle.records['source-mappings.ndjson']!.find((entry) => entry.targetRef === task.ref);
      return Boolean(mapping?.sourceUrl && String(mapping.sourceUrl).includes(identifier));
    });
  }

  private async editedCreatedObjects(objects: typeof importCreatedObjects.$inferSelect[]) {
    const edited: { type: string; id: string }[] = [];
    for (const object of objects) {
      if (object.targetEntityType === 'task') { const [row] = await this.database.db.select({ version: tasks.version }).from(tasks).where(eq(tasks.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'project') { const [row] = await this.database.db.select({ version: projects.version }).from(projects).where(eq(projects.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'flow') { const [row] = await this.database.db.select({ version: flows.version }).from(flows).where(eq(flows.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'workflow_state') { const [row] = await this.database.db.select({ version: workflowStates.version }).from(workflowStates).where(eq(workflowStates.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'label') { const [row] = await this.database.db.select({ version: labels.version }).from(labels).where(eq(labels.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'milestone') { const [row] = await this.database.db.select({ version: milestones.version }).from(milestones).where(eq(milestones.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
      if (object.targetEntityType === 'knowledge_artifact') { const [row] = await this.database.db.select({ version: knowledgeArtifacts.version }).from(knowledgeArtifacts).where(eq(knowledgeArtifacts.id, object.targetEntityId)).limit(1); if (!row || (object.importedVersion !== null && row.version !== object.importedVersion)) edited.push({ type: object.targetEntityType, id: object.targetEntityId }); }
    }
    return edited;
  }

  private async softDeleteImportedObject(tx: any, type: string, id: string, actorId: string): Promise<void> {
    const fields = { deletedAt: new Date(), deletedByUserId: actorId, version: sql`version + 1`, updatedAt: new Date() };
    if (type === 'task') await tx.update(tasks).set(fields).where(eq(tasks.id, id));
    if (type === 'project') await tx.update(projects).set(fields).where(eq(projects.id, id));
    if (type === 'flow') await tx.update(flows).set(fields).where(eq(flows.id, id));
    if (type === 'workflow_state') await tx.update(workflowStates).set({ archivedAt: new Date(), version: sql`${workflowStates.version} + 1` }).where(eq(workflowStates.id, id));
    if (type === 'label') await tx.update(labels).set(fields).where(eq(labels.id, id));
    if (type === 'milestone') await tx.update(milestones).set(fields).where(eq(milestones.id, id));
    if (type === 'knowledge_artifact') await tx.update(knowledgeArtifacts).set(fields).where(eq(knowledgeArtifacts.id, id));
  }
}
