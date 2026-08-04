import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { ToolClient } from '../src/client/remote.js';
import { RepositoryStateStore } from '../src/config/repository-state.js';
import { inspectGit, sha256 } from '../src/git/state.js';
import { HandoffWorkflow } from '../src/workflow/service.js';

const exec = promisify(execFile);

class FakeClient implements ToolClient {
  readonly calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  constructor(private readonly handler: (name: string, arguments_: Record<string, any>) => any) {}
  async call<T>(name: string, arguments_: Record<string, unknown>): Promise<T> {
    if (['list_projects', 'list_tasks'].includes(name) && Number(arguments_.limit) > 100) throw new Error(`${name} exceeds the public page limit.`);
    this.calls.push({ name, arguments: arguments_ });
    return await this.handler(name, arguments_) as T;
  }
  async close(): Promise<void> {}
}

describe('cross-device handoff workflow', () => {
  it('binds, ingests Codex, checkpoints exact dirty state, and restores it on another checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'anklav-handoff-'));
    const deviceA = join(root, 'device-a');
    const deviceB = join(root, 'device-b');
    const codexHome = join(root, 'codex-a');
    await exec('git', ['init', '-b', 'main', deviceA]);
    await exec('git', ['-C', deviceA, 'config', 'user.email', 'test@example.com']);
    await exec('git', ['-C', deviceA, 'config', 'user.name', 'Anklav Test']);
    await writeFile(join(deviceA, 'tracked.txt'), 'before\n');
    await exec('git', ['-C', deviceA, 'add', 'tracked.txt']);
    await exec('git', ['-C', deviceA, 'commit', '-m', 'Initial']);
    await exec('git', ['-C', deviceA, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
    await exec('git', ['clone', deviceA, deviceB]);
    await exec('git', ['-C', deviceB, 'remote', 'set-url', 'origin', 'https://github.com/example/project.git']);
    await writeFile(join(deviceA, 'tracked.txt'), 'after\n');
    await writeFile(join(deviceA, 'untracked.txt'), 'new\n');
    const captured = await inspectGit(deviceA);

    const sessionDirectory = join(codexHome, 'sessions', '2026', '08', '02');
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, 'rollout-test.jsonl'), [
      { timestamp: '2026-08-02T10:00:00.000Z', type: 'session_meta', payload: { session_id: 'codex-device-a', cwd: deviceA, cli_version: '1.0.0', model_provider: 'openai' } },
      { timestamp: '2026-08-02T10:00:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a', started_at: '2026-08-02T10:00:01.000Z' } },
      { timestamp: '2026-08-02T10:00:02.000Z', type: 'response_item', payload: { type: 'message', id: 'answer-a', role: 'assistant', content: [{ type: 'output_text', text: 'Implemented the tracked and untracked changes.' }] } },
      { timestamp: '2026-08-02T10:00:03.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-a', completed_at: '2026-08-02T10:00:03.000Z' } },
    ].map((entry) => JSON.stringify(entry)).join('\n'));

    let patchBase64 = '';
    const task = { id: 'task-1', identifier: 'PRJ-1', title: 'Cross-device task', objective: 'Continue on another device', includedPaths: [], followUpWork: '' };
    const common = (name: string) => {
      if (name === 'list_workspaces') return [{ id: 'workspace-1', name: 'Workspace', slug: 'workspace' }];
      if (name === 'list_projects') return { items: [{ project: { id: 'project-1', name: 'Project', issueKey: 'PRJ' } }] };
      if (name === 'list_repositories') return [{ id: 'repository-1', fullName: 'example/project' }];
      if (['link_project_repository', 'set_repository_local_alias', 'release_task_lease', 'ingest_native_session'].includes(name)) return {};
      if (name === 'get_task') return task;
      throw new Error(`Unexpected common tool ${name}`);
    };
    const clientA = new FakeClient((name, arguments_) => {
      if (name === 'create_task') return task;
      if (name === 'record_evidence_artifact') { patchBase64 = arguments_.contentBase64; return { id: 'patch-a' }; }
      if (name === 'start_run') return { id: 'run-a', startedAt: new Date().toISOString(), nativeSession: { id: 'session-a' } };
      if (name === 'claim_task_lease') return { lease: { id: 'lease-a' } };
      if (name === 'capture_git_slice') return { id: 'slice-a' };
      if (name === 'create_run_checkpoint') return { id: 'checkpoint-a', sequence: 1 };
      return common(name);
    });
    const storeA = new RepositoryStateStore(join(root, 'state-a.json'));
    const workflowA = new HandoffWorkflow(clientA, storeA, { ANKLAV_MACHINE_ID: 'device-a', CODEX_HOME: codexHome }, deviceA);
    await workflowA.bind('http://localhost:8080', { workspace: 'Workspace', project: 'Project' });
    await workflowA.start({ title: task.title });
    const checkpoint = await workflowA.checkpoint({ next: 'Continue on device B.' });
    expect(checkpoint.sequence).toBe(1);
    expect(clientA.calls.some((call) => call.name === 'ingest_native_session')).toBe(true);
    expect(clientA.calls.some((call) => call.name === 'ingest_native_session' && call.arguments.complete === true && Array.isArray(call.arguments.items) && call.arguments.items.length === 0)).toBe(true);
    const startingSlice = clientA.calls.find((call) => call.name === 'start_run')?.arguments.startingGitSlice as Record<string, unknown>;
    expect(startingSlice).toMatchObject({ dirtyState: 'dirty_captured', patchEvidenceArtifactId: 'patch-a' });
    expect(patchBase64).toBe(captured.patch.toString('base64'));

    const pack = {
      taskCheckpoint: { runId: 'run-a', nextAction: 'Continue on device B.' },
      operationalGitState: { repositoryFullName: 'example/project', headCommitSha: captured.head, dirtyState: 'dirty_captured', diffHash: sha256(captured.patch), patchEvidenceArtifactId: 'patch-a' },
      taskContract: { identifier: task.identifier, title: task.title, objective: task.objective },
      manifest: { packId: 'pack-1' },
    };
    const clientB = new FakeClient((name, arguments_) => {
      if (name === 'list_tasks') return { items: [{ task, state: { taskSemantic: 'in_progress' } }] };
      if (name === 'get_task_context_pack') return pack;
      if (name === 'read_evidence_artifact') return { contentBase64: patchBase64, nextOffset: null };
      if (name === 'record_evidence_artifact') return { id: 'patch-b' };
      if (name === 'start_run') return { id: 'run-b', startedAt: new Date().toISOString(), nativeSession: null };
      if (name === 'claim_task_lease') return { lease: { id: 'lease-b' } };
      if (name === 'finish_run') return { id: 'run-b', status: arguments_.status };
      return common(name);
    });
    const storeB = new RepositoryStateStore(join(root, 'state-b.json'));
    const workflowB = new HandoffWorkflow(clientB, storeB, { ANKLAV_MACHINE_ID: 'device-b', CODEX_HOME: join(root, 'codex-b') }, deviceB);
    await workflowB.bind('http://localhost:8080', { workspace: 'Workspace', project: 'Project' });
    const continued = await workflowB.continue({ task: 'PRJ-1' });
    const restored = await inspectGit(deviceB);
    expect(sha256(restored.patch)).toBe(sha256(captured.patch));
    expect(continued.reconciliation).toContain('Restored exact dirty patch');
    expect(continued.rendered).toContain('<anklav_context>');
    expect(await readFile(join(root, 'continuation.md'), 'utf8')).toBe(continued.rendered);
    expect((await storeB.require()).runId).toBe('run-b');
    const finished = await workflowB.finish({ status: 'completed', summary: 'Device B completed the task.' });
    expect(finished.status).toBe('completed');
    expect((await storeB.require()).runId).toBeUndefined();
  });
});
