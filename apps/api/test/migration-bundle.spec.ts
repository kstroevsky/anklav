import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertVerificationOutputOutsideBundle, loadMigrationBundle } from '../src/migration-bundle';

const ndjson = [
  'activity.ndjson', 'chat-session-metadata.ndjson', 'comments.ndjson', 'knowledge-artifact-candidates.ndjson', 'labels.ndjson', 'linear-documents.ndjson',
  'linear-milestones.ndjson', 'milestone-classifications.ndjson', 'projects.ndjson', 'repository-context.ndjson', 'repository-evidence.ndjson', 'source-mappings.ndjson', 'tasks.ndjson', 'workflow-states.ndjson',
];

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'anklav-bundle-'));
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify({ schemaVersion: '1.2.0', generatedAt: '2026-08-01T00:00:00.000Z', sourceSnapshot: { capturedAt: '2026-08-01T00:00:00.000Z', mode: 'live-linear-graphql' }, bundle: { path: 'migration/anklav/v1', version: 'v1' }, safeguards: ['test'] }),
    'schema.json': JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', schemaVersion: '1.2.0' }),
    'expected-counts.json': JSON.stringify({ workspace: 1, teams: 0, initiatives: 0, projects: 0, workflowStates: 0, labels: 0, sourceMilestones: 0, milestoneClassifications: 0, tasks: 0, comments: 0, activity: 0, linearDocuments: 0, repositoryEvidence: 0, repositoryContextMappings: 0, knowledgeArtifactCandidates: 0, privacySafeChatMetadata: 0, sourceMappings: 0, unresolvedConflicts: 0 }),
    'import-contract.json': JSON.stringify({ schemaVersion: '1.2.0' }),
    'source-of-truth.json': JSON.stringify({ schemaVersion: '1.2.0' }),
    'unresolved-conflicts.json': '[]',
    'workspace.json': JSON.stringify({ ref: 'workspace:personal-r-and-d' }),
  };
  for (const name of ndjson) files[name] = '';
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  await writeFile(join(root, 'checksums.sha256'), Object.entries(files).map(([name, content]) => `${hash(content)}  ${name}`).join('\n'));
  return root;
}

describe('neutral migration bundle guard', () => {
  it('validates the immutable v1 contract and makes no writes', async () => {
    const root = await fixture();
    const loaded = await loadMigrationBundle(root);
    expect(loaded.manifest.schemaVersion).toBe('1.2.0');
    expect(loaded.expectedCounts.sourceMappings).toBe(0);
  });

  it('rejects a generated verification output inside the immutable bundle', async () => {
    const root = await fixture();
    await expect(loadMigrationBundle(root)).resolves.toBeDefined();
    await writeFile(join(root, 'anklav-import-verification.json'), '{}');
    await expect(loadMigrationBundle(root)).rejects.toThrow(/checksum/i);
    expect(() => assertVerificationOutputOutsideBundle(root, join(root, 'anklav-import-verification.json'))).toThrow(/outside/i);
    expect(assertVerificationOutputOutsideBundle(root, join(root, '..', 'verification', 'anklav-import-verification.json'))).toContain('verification');
  });

  it('rejects symbolic links before reading source content', async () => {
    const root = await fixture();
    await mkdir(join(root, 'nested'));
    await symlink('../manifest.json', join(root, 'nested', 'linked.json'));
    await expect(loadMigrationBundle(root)).rejects.toThrow(/symlink/i);
  });
});
