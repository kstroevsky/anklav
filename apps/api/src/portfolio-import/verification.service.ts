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

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PortfolioImportTargetService } from './target.service';

export abstract class PortfolioImportVerificationService extends PortfolioImportTargetService {
  async verify(request: ImportRequest, actor: AuthUser, verificationReport: string): Promise<Record<string, unknown>> {
    const bundle = await loadMigrationBundle(request.bundle, true);
    const workspace = await this.findWorkspace(request.workspace);
    if (!workspace) throw new NotFoundException('Target workspace not found.');
    const reportPath = assertVerificationOutputOutsideBundle(bundle.root, verificationReport);
    const batch = await this.frozenBatch(workspace.id, bundle, request.overrides ?? {});
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
    const batch = await this.frozenBatch(workspace.id, bundle, request.overrides ?? {});
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

  private async frozenBatch(workspaceId: string, bundle: MigrationBundle, overrides: ImportOverrides) {
    const overridesHash = digest(overrides);
    const candidates = await this.database.db.select().from(importBatches).where(and(eq(importBatches.workspaceId, workspaceId), eq(importBatches.bundleChecksum, bundle.bundleChecksum))).orderBy(desc(importBatches.createdAt));
    const batch = candidates.find((candidate) => candidate.overridesHash === overridesHash);
    if (!batch) {
      const known = candidates.map((candidate) => ({ id: candidate.id, overridesHash: candidate.overridesHash, status: candidate.status }));
      throw new ConflictException({ title: 'No import batch has this bundle and overrides identity. Roll back the prior batch before applying a changed decision set.', bundleChecksum: bundle.bundleChecksum, overridesHash, knownBatches: known });
    }
    if (batch.overridesHash !== overridesHash) throw new ConflictException('Incoming overrides do not match the frozen batch overrides hash.');
    return batch;
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
    const rows = nativeIdentifiers.length
      ? await this.database.db.select({ identifier: taskIdentifierAliases.identifier }).from(taskIdentifierAliases)
        .where(and(eq(taskIdentifierAliases.workspaceId, workspaceId), inArray(taskIdentifierAliases.identifier, nativeIdentifiers)))
      : [];
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
