import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { isMainModule, normalizeOrigin } from '../src/main.js';
import { parseArguments } from '../src/cli/arguments.js';
import { discoverCodexSession, parseCodexSession } from '../src/codex/session.js';
import { applyPatch, inspectGit, sha256 } from '../src/git/state.js';

const exec = promisify(execFile);

describe('MCP bridge origin validation', () => {
  it('accepts HTTPS origins and loopback HTTP', () => {
    expect(normalizeOrigin('https://anklav.example')).toBe('https://anklav.example');
    expect(normalizeOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('rejects non-loopback HTTP and origins with paths', () => {
    expect(() => normalizeOrigin('http://anklav.example')).toThrow('Plain HTTP');
    expect(() => normalizeOrigin('https://anklav.example/mcp')).toThrow('Origin must');
  });
});

describe('usable handoff CLI contracts', () => {
  it('runs when invoked through a package-manager symlink', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anklav-bin-'));
    const executable = join(directory, 'anklav');
    const entry = join(process.cwd(), 'src', 'main.ts');
    await symlink(entry, executable);
    expect(isMainModule(executable, entry)).toBe(true);
  });

  it('parses repository workflow commands without exposing UUID-oriented arguments', () => {
    expect(parseArguments(['bind', '--workspace', 'Personal', '--project', 'Anklav'])).toEqual({ command: 'bind', positionals: [], flags: { workspace: 'Personal', project: 'Anklav' } });
    expect(parseArguments(['continue', 'ANK-12', '--model', 'gpt-5'])).toEqual({ command: 'continue', positionals: ['ANK-12'], flags: { model: 'gpt-5' } });
  });

  it('normalizes a Codex rollout while redacting credentials and preserving tool relationships', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anklav-codex-'));
    const path = join(directory, 'rollout.jsonl');
    const records = [
      { timestamp: '2026-08-02T10:00:00.000Z', type: 'session_meta', payload: { session_id: 'thread-1', cwd: directory, cli_version: '1.2.3', model_provider: 'openai' } },
      { timestamp: '2026-08-02T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1', started_at: '2026-08-02T10:00:01.000Z' } },
      { timestamp: '2026-08-02T10:00:02.000Z', type: 'response_item', payload: { type: 'message', id: 'm1', role: 'user', content: [{ type: 'input_text', text: 'use token=super-secret-value-now' }] } },
      { timestamp: '2026-08-02T10:00:03.000Z', type: 'response_item', payload: { type: 'function_call', id: 'c1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"README.md","token":"quoted-secret-value"}' } },
      { timestamp: '2026-08-02T10:00:04.000Z', type: 'response_item', payload: { type: 'function_call_output', id: 'o1', call_id: 'call-1', output: 'done' } },
      { timestamp: '2026-08-02T10:00:05.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', completed_at: '2026-08-02T10:00:05.000Z' } },
    ];
    await writeFile(path, records.map((value) => JSON.stringify(value)).join('\n'));
    const parsed = await parseCodexSession(path);
    expect(parsed.nativeSessionId).toBe('thread-1');
    expect(parsed.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.complete).toBe(true);
    expect(parsed.turns[0]?.status).toBe('completed');
    expect(parsed.items[0]?.summary).toContain('[REDACTED]');
    expect(parsed.items[1]?.summary).toContain('"token":"[REDACTED]"');
    expect(parsed.items[1]?.summary).not.toContain('quoted-secret-value');
    expect(parsed.items[2]).toMatchObject({ relatedNativeItemId: 'call:call-1', relationshipType: 'tool_result_for' });
  });

  it('accepts repository subdirectories but rejects a rollout rooted above the repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anklav-codex-scope-'));
    const repository = join(directory, 'repository');
    const subdirectory = join(repository, 'packages', 'api');
    await mkdir(subdirectory, { recursive: true });
    const nestedSession = join(directory, 'nested.jsonl');
    const parentSession = join(directory, 'parent.jsonl');
    await writeFile(nestedSession, JSON.stringify({ type: 'session_meta', payload: { session_id: 'nested', cwd: subdirectory } }));
    await writeFile(parentSession, JSON.stringify({ type: 'session_meta', payload: { session_id: 'parent', cwd: directory } }));
    await expect(discoverCodexSession(repository, { explicitPath: nestedSession })).resolves.toBe(nestedSession);
    await expect(discoverCodexSession(repository, { explicitPath: parentSession })).rejects.toThrow('belongs to');
  });

  it('captures and restores tracked and untracked dirty work as one reproducible patch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'anklav-git-'));
    const source = join(directory, 'source');
    const target = join(directory, 'target');
    await exec('git', ['init', '-b', 'main', source]);
    await exec('git', ['-C', source, 'config', 'user.email', 'test@example.com']);
    await exec('git', ['-C', source, 'config', 'user.name', 'Anklav Test']);
    await writeFile(join(source, 'tracked.txt'), 'before\n');
    await exec('git', ['-C', source, 'add', 'tracked.txt']);
    await exec('git', ['-C', source, 'commit', '-m', 'Initial']);
    await exec('git', ['clone', source, target]);
    await exec('git', ['-C', target, 'remote', 'remove', 'origin']);
    await writeFile(join(source, 'tracked.txt'), 'after\n');
    await writeFile(join(source, 'untracked.txt'), 'new\n');
    const captured = await inspectGit(source);
    await applyPatch(target, captured.patch);
    const restored = await inspectGit(target);
    expect(restored.changedPaths).toEqual(captured.changedPaths);
    expect(sha256(restored.patch)).toBe(sha256(captured.patch));
  });
});
