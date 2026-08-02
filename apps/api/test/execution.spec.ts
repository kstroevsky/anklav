import { describe, expect, it } from 'vitest';
import { checkpointInput, claimLeaseInput, gitSliceInput, nativeSessionIngestionInput, startRunInput } from '../src/execution/inputs';
import { nativeSessionIngestionHash, normalizedPaths, pathsOverlap } from '../src/execution/service';

const slice = { repositoryFullName: 'kstroevsky/anklav', baseCommitSha: 'abcdef1', headCommitSha: 'abcdef2', dirtyState: 'clean' as const };

describe('execution contracts', () => {
  it('requires modifying runs to start from an exact Git slice', () => {
    const base = { provider: 'codex' as const, client: 'codex-app', machineIdentity: 'machine-a', modifiesCode: true };
    expect(startRunInput.safeParse(base).success).toBe(false);
    expect(startRunInput.safeParse({ ...base, startingGitSlice: slice }).success).toBe(true);
  });

  it('requires a patch artifact whenever dirty work is declared captured', () => {
    expect(gitSliceInput.safeParse({ ...slice, dirtyState: 'dirty_captured' }).success).toBe(false);
    expect(gitSliceInput.safeParse({ ...slice, dirtyState: 'dirty_captured', patchArtifactId: '0198babc-1234-7000-8000-000000000001' }).success).toBe(true);
    expect(gitSliceInput.safeParse({ ...slice, patchArtifactId: '0198babc-1234-7000-8000-000000000001' }).success).toBe(false);
  });

  it('requires checkpoint event coverage to form a complete ordered interval', () => {
    const base = { objective: 'Continue safely', summary: 'Work is checkpointed', nextAction: 'Run tests' };
    expect(checkpointInput.safeParse({ ...base, coveredEventSequenceStart: 4 }).success).toBe(false);
    expect(checkpointInput.safeParse({ ...base, coveredEventSequenceStart: 5, coveredEventSequenceEnd: 4 }).success).toBe(false);
    expect(checkpointInput.safeParse({ ...base, coveredEventSequenceStart: 4, coveredEventSequenceEnd: 5 }).success).toBe(true);
  });

  it('normalizes lease scopes and detects overlapping worktree paths', () => {
    expect(normalizedPaths(['./src/auth/', 'src/auth', 'src/api'])).toEqual(['src/api', 'src/auth']);
    expect(pathsOverlap(['src/auth'], ['src/auth/session.ts'])).toBe(true);
    expect(pathsOverlap(['src/auth'], ['src/billing'])).toBe(false);
    expect(pathsOverlap([], ['src/billing'])).toBe(true);
    expect(claimLeaseInput.safeParse({ activity: 'Inspect', exclusive: true }).success).toBe(false);
  });

  it('validates native ingestion identity, ordering, and relationship pairs', () => {
    const item = { nativeItemId: 'message-1', sequence: 1, type: 'assistant_message' as const, contentHash: 'a'.repeat(64), occurredAt: '2026-08-02T10:00:00.000Z' };
    const base = { idempotencyKey: 'ingestion-1', sourceRevision: 'revision-1', parserVersion: 'codex-rollout/2', items: [item] };
    expect(nativeSessionIngestionInput.safeParse(base).success).toBe(true);
    expect(nativeSessionIngestionInput.safeParse({ ...base, items: [item, { ...item, sequence: 2 }] }).success).toBe(false);
    expect(nativeSessionIngestionInput.safeParse({ ...base, items: [{ ...item, relatedNativeItemId: 'tool-1' }] }).success).toBe(false);
    expect(nativeSessionIngestionInput.safeParse({ ...base, items: [{ ...item, relationshipType: 'tool_result_for' }] }).success).toBe(false);
  });

  it('hashes the immutable ingestion content independently of idempotency keys and object key order', () => {
    const left = { idempotencyKey: 'ingestion-a', sourceRevision: 'revision-1', parserVersion: 'parser/1', complete: true, manifest: { z: 1, a: 2 }, pathMappings: {}, parseErrors: [], turns: [], items: [] };
    const right = { ...left, idempotencyKey: 'ingestion-b', manifest: { a: 2, z: 1 } };
    expect(nativeSessionIngestionHash(left)).toBe(nativeSessionIngestionHash(right));
    expect(nativeSessionIngestionHash(left)).not.toBe(nativeSessionIngestionHash({ ...right, sourceRevision: 'revision-2' }));
  });
});
