import { describe, expect, it } from 'vitest';
import { checkpointInput, claimLeaseInput, gitSliceInput, startRunInput } from '../src/execution/inputs';
import { normalizedPaths, pathsOverlap } from '../src/execution/service';

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
});
