import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type RepositoryState = {
  origin: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  repositoryId: string;
  repositoryFullName: string;
  machineIdentity: string;
  taskId?: string;
  taskIdentifier?: string;
  runId?: string;
  leaseId?: string;
  nativeSessionRecordId?: string;
  nativeSessionNativeId?: string;
  nativeSessionPath?: string;
  nativeSessionCursor?: number;
  nativeSessionRevision?: string;
  runStartedAt?: string;
  runBaseCommit?: string;
};

export class RepositoryStateStore {
  constructor(readonly path: string) {}

  static atRepositoryRoot(root: string): RepositoryStateStore {
    return new RepositoryStateStore(join(root, '.git', 'anklav', 'state.json'));
  }

  static atGitDirectory(gitDirectory: string): RepositoryStateStore {
    return new RepositoryStateStore(join(gitDirectory, 'anklav', 'state.json'));
  }

  async read(): Promise<RepositoryState | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as RepositoryState;
      if (!value.origin || !value.workspaceId || !value.projectId || !value.repositoryId || !value.machineIdentity) throw new Error('Repository binding is incomplete. Run anklav bind again.');
      return value;
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async require(): Promise<RepositoryState> {
    const value = await this.read();
    if (!value) throw new Error('This repository is not bound to Anklav. Run: anklav bind');
    return value;
  }

  async write(value: RepositoryState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }
}
