import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CredentialStore, Credentials } from '../config/types.js';
import { credentialStorePath } from './credential-path.js';

export class CredentialStoreRepository {
  constructor(private readonly path = credentialStorePath()) {}

  async find(origin: string): Promise<Credentials | undefined> {
    return (await this.read())[origin];
  }

  async save(credentials: Credentials): Promise<void> {
    const store = await this.read();
    store[credentials.origin] = credentials;
    await this.write(store);
  }

  async remove(origin: string): Promise<boolean> {
    const store = await this.read();
    if (!store[origin]) return false;
    delete store[origin];
    await this.write(store);
    return true;
  }

  private async read(): Promise<CredentialStore> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as CredentialStore;
    } catch (error: unknown) {
      if (isMissingFile(error)) return {};
      throw error;
    }
  }

  private async write(store: CredentialStore): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
