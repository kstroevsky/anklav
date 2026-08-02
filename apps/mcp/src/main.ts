#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runCli } from './cli/runner.js';

export { normalizeOrigin } from './config/origin.js';
export { runCli } from './cli/runner.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Anklav MCP command failed.');
    process.exitCode = 1;
  });
}
