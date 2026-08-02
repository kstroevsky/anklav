import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname, homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

export async function machineIdentity(environment = process.env): Promise<string> {
  const explicit = environment.ANKLAV_MACHINE_ID?.trim();
  if (explicit) return explicit;
  const path = machineIdentityPath(environment);
  try {
    const stored = (await readFile(path, 'utf8')).trim();
    if (stored) return stored;
  } catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const created = `${hostname() || 'machine'}:${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${created}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
  return created;
}

function machineIdentityPath(environment: NodeJS.ProcessEnv): string {
  const base = environment.XDG_CONFIG_HOME ?? (platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.config'));
  return join(base, 'anklav', 'machine-id');
}
