#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli/runner.js';

export { normalizeOrigin } from './config/origin.js';
export { runCli } from './cli/runner.js';

if (isMainModule()) {
  void runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Anklav command failed.');
    process.exitCode = 1;
  });
}

export function isMainModule(entry = process.argv[1], modulePath = fileURLToPath(import.meta.url)): boolean {
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(modulePath); }
  catch { return false; }
}
