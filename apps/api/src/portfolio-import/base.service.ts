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

export abstract class PortfolioImportBaseService {
  constructor(
    protected readonly database: DatabaseService,
    protected readonly activity: ActivityService,
    protected readonly knowledge: PortfolioKnowledgeService,
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

  protected async findWorkspace(selector: string) {
    const byId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selector);
    return (await this.database.db.select().from(workspaces).where(and(byId ? eq(workspaces.id, selector) : sql`LOWER(${workspaces.name}) = ${normalized(selector)}`, isNull(workspaces.deletedAt))).limit(1))[0];
  }

  /** Every state-changing/read-verification command replays the same frozen decisions. */
  protected preflight(bundle: MigrationBundle, overrides: ImportOverrides, workspaceExists: boolean): Record<string, unknown> {
    return importPreflight(bundle, overrides, workspaceExists);
  }

  protected overridesTemplate(bundle: MigrationBundle, supplied: ImportOverrides): ImportOverrides {
    const projectControlTasks = Object.fromEntries(bundle.records['tasks.ndjson']!.filter(isProjectControlTask).map((task) => [String(task.ref), supplied.projectControlTasks?.[String(task.ref)] ?? { disposition: 'archive_as_source_only' as const }]));
    const milestoneClassifications = Object.fromEntries(bundle.records['milestone-classifications.ndjson']!.filter((entry) => entry.reviewRequired).map((entry) => [String(entry.sourceLinearId), supplied.milestoneClassifications?.[String(entry.sourceLinearId)] ?? 'archive_candidate' as const]));
    const sourceFlowDispositions = Object.fromEntries(bundle.records['linear-milestones.ndjson']!
      .filter((milestone) => milestone.projectRef === 'project:project-control' && milestone.proposedTarget === 'anklav_flow')
      .map((milestone) => [String((source(milestone) ?? {}).id), supplied.sourceFlowDispositions?.[String((source(milestone) ?? {}).id)] ?? 'archive_as_source_only' as const]));
    return { sourceRepositoryVisibility: supplied.sourceRepositoryVisibility, projectControlTasks, milestoneClassifications, sourceFlowDispositions };
  }

  protected async initialize(bundle: MigrationBundle, selector: string, actor: AuthUser, overrides: ImportOverrides) {
    const currentWorkspace = await this.findWorkspace(selector);
    if (!currentWorkspace) throw new NotFoundException('Target workspace must exist before apply. An import never creates a workspace.');
    const overridesHash = digest(overrides);
    return this.database.db.transaction(async (tx) => {
      const [source] = await tx.insert(externalSources).values({ workspaceId: currentWorkspace.id, system: 'project-control', bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, sourceUri: bundle.manifest.bundle.path, metadata: { sourceOfTruth: bundle.sourceOfTruth } }).onConflictDoUpdate({ target: [externalSources.workspaceId, externalSources.system, externalSources.bundleVersion, externalSources.bundleChecksum], set: { updatedAt: new Date() } }).returning();
      const batches = await tx.select().from(importBatches).where(and(eq(importBatches.externalSourceId, source!.id), eq(importBatches.bundleChecksum, bundle.bundleChecksum))).orderBy(desc(importBatches.createdAt));
      const exact = batches.find((candidate) => candidate.overridesHash === overridesHash);
      if (exact && exact.status !== 'rolled_back') return { workspace: currentWorkspace, source: source!, batch: exact };
      if (batches.some((candidate) => candidate.overridesHash !== overridesHash && candidate.status !== 'rolled_back')) {
        throw new ConflictException({ title: 'Import decisions are frozen for this bundle. Roll back the prior batch before applying changed overrides.', bundleChecksum: bundle.bundleChecksum, overridesHash, existingBatches: batches.map((candidate) => ({ id: candidate.id, status: candidate.status, overridesHash: candidate.overridesHash })) });
      }
      const [batch] = await tx.insert(importBatches).values({ workspaceId: currentWorkspace.id, externalSourceId: source!.id, bundleVersion: bundle.manifest.schemaVersion, bundleChecksum: bundle.bundleChecksum, bundlePathHash: digest(bundle.root), status: 'applying', startedAt: new Date(), actorUserId: actor.id, overridesHash }).returning();
      await this.activity.append(tx, { workspaceId: currentWorkspace.id, subjectType: 'import_batch', subjectId: batch!.id, action: 'created', actor, after: { bundleChecksum: bundle.bundleChecksum, bundleVersion: bundle.manifest.schemaVersion } });
      return { workspace: currentWorkspace, source: source!, batch: batch! };
    });
  }

  protected async ensureAnklavProject(workspaceId: string, actor: AuthUser, batchId: string): Promise<string> {
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

  protected async persistBundleConflicts(tx: any, context: ImportContext): Promise<void> {
    const resolvedCodes = new Set(['anklav-native-import-missing', 'anklav-milestones-not-in-api', 'anklav-context-packs-not-native', 'anklav-activity-import-not-native', 'source-repository-visibility-undecided', 'project-control-target-project-required', 'milestone-human-review-required']);
    for (const conflict of context.bundle.conflicts) {
      const code = String(conflict.code);
      const sourceKey = typeof conflict.sourceMilestoneId === 'string' ? `linear:milestone:${conflict.sourceMilestoneId}` : null;
      const status = resolvedCodes.has(code) ? 'resolved' : code === 'github-mappings-require-integration' || code === 'repository-checkout-dirty' || code === 'source-export-unavailable' ? 'deferred' : 'open';
      const resolution = code === 'source-repository-visibility-undecided' ? { decision: context.overrides.sourceRepositoryVisibility } : code === 'project-control-target-project-required' ? { taskDispositions: context.overrides.projectControlTasks } : code === 'milestone-human-review-required' ? { milestoneDecision: context.overrides.milestoneClassifications?.[String(conflict.sourceMilestoneId)] } : { handledBy: status === 'resolved' ? 'phase_0_1' : 'deferred' };
      await tx.insert(importConflicts).values({ importBatchId: context.batchId, code, severity: conflict.severity as any, status, sourceKey, message: String(conflict.message), resolution, resolvedAt: status === 'resolved' ? new Date() : null }).onConflictDoNothing();
    }
  }

  protected mappingOrder(mapping: BundleRecord): number { return ({ workspace: 0, team: 1, initiative: 2, workflow_state: 3, label: 4, project: 5, milestone: 6, issue: 7, document: 8 } as Record<string, number>)[String(mapping.sourceKind)] ?? 99; }

  protected recordIndex(bundle: MigrationBundle): Map<string, BundleRecord> {
    const output = new Map<string, BundleRecord>();
    for (const rows of Object.values(bundle.records)) for (const record of rows) if (typeof record.ref === 'string') output.set(record.ref, record);
    return output;
  }

  protected async findDrift(bundle: MigrationBundle, workspaceId: string): Promise<{ sourceKey: string; targetEntityType: string; targetEntityId: string | null }[]> {
    const existing = await this.database.db.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.workspaceId, workspaceId), isNull(externalObjectMappings.supersededAt)));
    const existingByKey = new Map(existing.map((mapping) => [mapping.sourceKey, mapping]));
    const index = this.recordIndex(bundle);
    return bundle.records['source-mappings.ndjson']!.flatMap((mapping) => {
      const previous = existingByKey.get(String(mapping.sourceKey));
      const currentHash = digest(index.get(String(mapping.targetRef)) ?? mapping);
      return previous && previous.sourcePayloadHash !== currentHash ? [{ sourceKey: previous.sourceKey, targetEntityType: previous.targetEntityType, targetEntityId: previous.targetEntityId }] : [];
    });
  }


}
