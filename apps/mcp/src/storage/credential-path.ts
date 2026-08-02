import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function credentialStorePath(environment = process.env): string {
  const base = environment.XDG_CONFIG_HOME ?? (
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config')
  );
  return join(base, 'anklav', 'mcp-credentials.json');
}
