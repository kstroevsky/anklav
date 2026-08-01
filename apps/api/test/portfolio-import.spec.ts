import { describe, expect, it } from 'vitest';
import { importPreflight } from '../src/portfolio-import.service';
import type { MigrationBundle } from '../src/migration-bundle';

function bundle(): MigrationBundle {
  return {
    root: '/safe/bundle', manifest: { schemaVersion: '1.2.0', generatedAt: '2026-08-01T00:00:00.000Z', sourceSnapshot: { capturedAt: '2026-08-01T00:00:00.000Z', mode: 'live-linear-graphql' }, bundle: { path: 'migration/anklav/v1', version: 'v1' }, safeguards: ['test'] },
    schema: {}, checksums: new Map(), bundleChecksum: 'checksum', expectedCounts: {}, sourceOfTruth: {}, importContract: {},
    records: {
      'projects.ndjson': [{ ref: 'project:product', migrationRole: 'product', importActiveTasks: false }],
      'tasks.ndjson': [{ ref: 'task:product', importDisposition: 'create_or_match' }, { ref: 'task:control', importDisposition: 'requires_target_project_mapping' }],
      'milestone-classifications.ndjson': [{ sourceLinearId: 'milestone-review', reviewRequired: true }],
      'source-mappings.ndjson': [], 'linear-documents.ndjson': [], 'knowledge-artifact-candidates.ndjson': [],
    },
    conflicts: [
      { code: 'source-repository-visibility-undecided', severity: 'blocking', message: 'choose visibility' },
      { code: 'project-control-target-project-required', severity: 'blocking', message: 'choose task disposition' },
      { code: 'milestone-human-review-required', severity: 'review', message: 'choose milestone disposition' },
    ],
  } as unknown as MigrationBundle;
}

describe('portfolio import preflight', () => {
  it('refuses apply until visibility, control-task, and milestone decisions are explicit', () => {
    const result = importPreflight(bundle(), {}, true) as any;
    expect(result.blocking).toHaveLength(3);
  });

  it('uses task importDisposition rather than the misleading project importActiveTasks flag', () => {
    const result = importPreflight(bundle(), {
      sourceRepositoryVisibility: 'accepted_public_disclosure',
      projectControlTasks: { 'task:control': { disposition: 'map_to_anklav', targetProjectRef: 'project:anklav' } },
      milestoneClassifications: { 'milestone-review': 'archive_candidate' },
    }, true) as any;
    expect(result.blocking).toEqual([]);
    expect(result.planned.productTasks).toBe(1);
  });
});
