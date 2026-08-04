import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type LocalGitState = {
  root: string;
  gitDirectory: string;
  head: string;
  branch: string | null;
  remoteUrl: string | null;
  repositoryFullName: string;
  dirty: boolean;
  patch: Buffer;
  changedPaths: string[];
  dependencyLockHashes: Record<string, string>;
};

export async function inspectGit(cwd = process.cwd()): Promise<LocalGitState> {
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const [gitDirectory, head, branchValue, remoteValue, status, patch, untracked] = await Promise.all([
    git(root, ['rev-parse', '--absolute-git-dir']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
    git(root, ['remote', 'get-url', 'origin']).catch(() => ''),
    gitRaw(root, ['status', '--porcelain=v1', '-z']),
    gitBuffer(root, ['diff', '--binary', '--no-ext-diff', 'HEAD']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const untrackedPatch = await Promise.all(untracked.split('\0').filter(Boolean).sort().map((path) => gitDiffUntracked(root, path)));
  const completePatch = Buffer.concat([patch, ...untrackedPatch]);
  const remoteUrl = remoteValue || null;
  const repositoryFullName = remoteUrl ? repositoryName(remoteUrl) : `local/${basename(root)}`;
  const changedPaths = status.split('\0').filter(Boolean).map((line) => line.slice(3)).filter(Boolean).sort();
  return {
    root: await realpath(root),
    gitDirectory: await realpath(gitDirectory),
    head,
    branch: branchValue || null,
    remoteUrl,
    repositoryFullName,
    dirty: Boolean(status),
    patch: completePatch,
    changedPaths,
    dependencyLockHashes: await lockHashes(root),
  };
}

export function gitSlice(state: LocalGitState, dirtyCapture?: { evidenceArtifactId: string; hash: string }) {
  return {
    repositoryFullName: state.repositoryFullName,
    baseCommitSha: state.head,
    headCommitSha: state.head,
    mergeBaseSha: state.head,
    branchName: state.branch,
    includedPaths: [],
    excludedPaths: [],
    diffHash: state.patch.length ? sha256(state.patch) : null,
    worktreeIdentity: state.root,
    dirtyState: state.dirty ? dirtyCapture ? 'dirty_captured' : 'dirty_missing' : 'clean',
    patchArtifactId: null,
    patchEvidenceArtifactId: dirtyCapture?.evidenceArtifactId ?? null,
    submoduleStates: {},
    dependencyLockHashes: state.dependencyLockHashes,
  };
}

export async function commitsSince(root: string, baseCommit: string | undefined): Promise<string[]> {
  if (!baseCommit) return [];
  const output = await git(root, ['log', '--format=%h %s', `${baseCommit}..HEAD`]).catch(() => '');
  return output.split('\n').map((value) => value.trim()).filter(Boolean);
}

export async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  try { await exec('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root }); return true; }
  catch (error: unknown) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) return false; throw error; }
}

export async function applyPatch(root: string, patch: Buffer): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'anklav-patch-'));
  const path = join(directory, 'handoff.patch');
  try {
    await writeFile(path, patch, { mode: 0o600 });
    await exec('git', ['apply', '--check', '--binary', path], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
    await exec('git', ['apply', '--binary', path], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })).stdout.trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  return (await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })).stdout;
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const result = await exec('git', args, { cwd, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  return result.stdout;
}

async function gitDiffUntracked(root: string, path: string): Promise<Buffer> {
  try { return await gitBuffer(root, ['diff', '--binary', '--no-index', '--', '/dev/null', path]); }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1 && 'stdout' in error && Buffer.isBuffer(error.stdout)) return error.stdout;
    throw error;
  }
}

function repositoryName(remote: string): string {
  const normalized = remote.trim().replace(/^git@[^:]+:/, '').replace(/^ssh:\/\/git@[^/]+\//, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/^\/+/, '');
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Cannot derive owner/name from Git remote: ${remote}`);
  return normalized;
}

async function lockHashes(root: string): Promise<Record<string, string>> {
  const names = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'Gemfile.lock', 'go.sum'];
  const values: Record<string, string> = {};
  await Promise.all(names.map(async (name) => {
    try { values[name] = sha256(await readFile(join(root, name))); } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }));
  return values;
}

export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
