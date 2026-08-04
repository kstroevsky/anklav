import { runLogin } from '../commands/login.js';
import { runLogout } from '../commands/logout.js';
import { runStdio } from '../commands/stdio.js';
import { normalizeOrigin } from '../config/origin.js';
import { booleanFlag, parseArguments, stringFlag } from './arguments.js';
import { inspectGit } from '../git/state.js';
import { RepositoryStateStore } from '../config/repository-state.js';
import { connectToolClient } from '../client/remote.js';
import { HandoffWorkflow } from '../workflow/service.js';

const USAGE = `Usage: anklav <command> [options]

Account:
  anklav login <https://anklav.example>
  anklav logout <https://anklav.example>
  anklav mcp <https://anklav.example>       Start the stdio MCP bridge

Repository workflow:
  anklav bind --origin <url> [--workspace <name>] [--project <name>]
  anklav start "Task title" [--objective <text>] [--model <model>] [--session <rollout.jsonl>]
  anklav start --task TASK-ID [--model <model>] [--session <rollout.jsonl>]
  anklav sync [--session <rollout.jsonl>]
  anklav import-codex TASK-ID [--sessions-root <dir>] [--since <iso-date>] [--limit <n>] [--include-incomplete] [--dry-run]
  anklav checkpoint [--summary <text>] [--next <text>] [--session <rollout.jsonl>]
  anklav continue [TASK-ID] [--model <model>] [--session <rollout.jsonl>]
  anklav status
  anklav finish [--status completed|failed|blocked|cancelled] [--summary <text>]

The repository binding is stored under .git/anklav and is never committed.`;

export async function runCli(argv: readonly string[], environment = process.env): Promise<void> {
  const parsed = parseArguments(argv);
  const command = parsed.command;
  if (!command || command === 'help' || parsed.flags.help) { console.error(USAGE); return; }
  if (command === 'login' || command === 'logout' || command === 'stdio' || command === 'mcp') {
    const origin = normalizeOrigin(stringFlag(parsed, 'origin') ?? parsed.positionals[0] ?? environment.ANKLAV_ORIGIN);
    if (command === 'login') return runLogin(origin);
    if (command === 'logout') return runLogout(origin);
    return runStdio(origin);
  }

  if (!['bind', 'start', 'sync', 'import-codex', 'checkpoint', 'continue', 'status', 'finish'].includes(command)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const git = await inspectGit();
  const store = RepositoryStateStore.atGitDirectory(git.gitDirectory);
  const stored = await store.read();
  const origin = normalizeOrigin(stringFlag(parsed, 'origin') ?? stored?.origin ?? environment.ANKLAV_ORIGIN);
  const client = await connectToolClient(origin);
  try {
    const workflow = new HandoffWorkflow(client, store, environment);
    if (command === 'bind') {
      const state = await workflow.bind(origin, { workspace: stringFlag(parsed, 'workspace'), project: stringFlag(parsed, 'project') });
      console.log(`Bound ${state.repositoryFullName} to ${state.workspaceName} / ${state.projectName} on ${state.machineIdentity}.`);
    } else if (command === 'start') {
      const result = await workflow.start({ title: parsed.positionals.join(' ') || undefined, objective: stringFlag(parsed, 'objective'), task: stringFlag(parsed, 'task'), model: stringFlag(parsed, 'model'), sessionPath: stringFlag(parsed, 'session'), readOnly: parsed.flags['read-only'] === true });
      console.log(`Started ${result.task.identifier}: ${result.task.title}\nRun: ${result.run.id}\nUse 'anklav checkpoint' before switching computers.`);
    } else if (command === 'sync') {
      const result = await workflow.sync({ sessionPath: stringFlag(parsed, 'session') });
      console.log(result.session ? `Synchronized ${result.uploaded} new Codex item(s) from ${result.session.nativeSessionId}.` : 'No current Codex rollout was found for this repository.');
    } else if (command === 'import-codex') {
      const task = parsed.positionals[0];
      if (!task) throw new Error('Usage: anklav import-codex TASK-ID [--sessions-root <dir>] [--since <iso-date>] [--limit <n>] [--include-incomplete] [--dry-run]');
      const sinceValue = stringFlag(parsed, 'since');
      const since = sinceValue ? new Date(sinceValue) : undefined;
      if (since && Number.isNaN(since.getTime())) throw new Error('--since must be an ISO date or timestamp.');
      const limitValue = stringFlag(parsed, 'limit');
      const limit = limitValue === undefined ? undefined : Number(limitValue);
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)) throw new Error('--limit must be an integer from 1 to 200.');
      const report = await workflow.importCodexHistory({ task, sessionsRoot: stringFlag(parsed, 'sessions-root'), since, limit, includeIncomplete: booleanFlag(parsed, 'include-incomplete'), dryRun: booleanFlag(parsed, 'dry-run') });
      console.log(JSON.stringify(report, null, 2));
      if (report.failures.length) process.exitCode = 1;
    } else if (command === 'checkpoint') {
      const checkpoint = await workflow.checkpoint({ summary: stringFlag(parsed, 'summary'), next: stringFlag(parsed, 'next'), sessionPath: stringFlag(parsed, 'session') });
      console.log(`Checkpoint ${checkpoint.sequence} saved. The task can now be continued from another computer.`);
    } else if (command === 'continue') {
      const result = await workflow.continue({ task: parsed.positionals[0], model: stringFlag(parsed, 'model'), sessionPath: stringFlag(parsed, 'session') });
      console.log(result.rendered);
    } else if (command === 'status') {
      console.log(JSON.stringify(await workflow.status(), null, 2));
    } else if (command === 'finish') {
      const result = await workflow.finish({ status: stringFlag(parsed, 'status'), summary: stringFlag(parsed, 'summary'), sessionPath: stringFlag(parsed, 'session') });
      console.log(`Run ${result.id} finished with status ${result.status}.`);
    }
  } finally { await client.close(); }
}
