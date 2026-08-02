import { runLogin } from '../commands/login.js';
import { runLogout } from '../commands/logout.js';
import { runStdio } from '../commands/stdio.js';
import { normalizeOrigin } from '../config/origin.js';

const USAGE = 'Usage: anklav-mcp <login|stdio|logout> <https://anklav.example>';

export async function runCli(argv: readonly string[], environment = process.env): Promise<void> {
  const [command, suppliedOrigin] = argv;
  const origin = normalizeOrigin(suppliedOrigin ?? environment.ANKLAV_ORIGIN);

  if (command === 'login') return runLogin(origin);
  if (command === 'stdio') return runStdio(origin);
  if (command === 'logout') return runLogout(origin);

  console.error(USAGE);
  process.exitCode = 2;
}
