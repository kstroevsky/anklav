import type { BundleRecord, MigrationBundle } from '../migration-bundle';
import { isProjectControlTask, type ImportOverrides } from './types';

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
