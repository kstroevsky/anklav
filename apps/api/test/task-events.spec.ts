import { describe, expect, it, vi } from 'vitest';
import { reduceTaskEvents, TaskEventService, taskCommandHash } from '../src/resource/task-event.service';

describe('canonical task events', () => {
  it('hashes semantically identical commands deterministically', () => {
    expect(taskCommandHash({ type: 'task.update', input: { title: 'New', priority: 'high' } }))
      .toBe(taskCommandHash({ input: { priority: 'high', title: 'New' }, type: 'task.update' }));
  });

  it('rebuilds the latest task projection from an ordered stream', () => {
    const projection = reduceTaskEvents([
      { aggregateVersion: 4, payload: { state: { id: 'task-1', version: 4, title: 'Before', workflowStateId: 'planned' } } },
      { aggregateVersion: 5, payload: { state: { id: 'task-1', version: 5, title: 'After', workflowStateId: 'done' } } },
    ]);

    expect(projection).toEqual({ id: 'task-1', version: 5, title: 'After', workflowStateId: 'done' });
  });

  it('rejects a stream with a missing aggregate version', () => {
    expect(() => reduceTaskEvents([
      { aggregateVersion: 1, payload: { state: { id: 'task-1', version: 1 } } },
      { aggregateVersion: 3, payload: { state: { id: 'task-1', version: 3 } } },
    ])).toThrow('not contiguous');
  });

  it('replays an idempotent command without applying its mutation twice', async () => {
    const stored: any[] = [];
    const executor = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => stored.slice(0, 1) }) }) })),
      insert: vi.fn(() => ({ values: async (event: any) => { stored.push({ ...event, payload: event.payload }); } })),
    };
    const operation = vi.fn(async () => ({ aggregateId: '0198babc-1234-7000-8000-000000000001', aggregateVersion: 1, eventType: 'task.created', state: { id: '0198babc-1234-7000-8000-000000000001', version: 1 } as any, result: { id: '0198babc-1234-7000-8000-000000000001' } }));
    const service = new TaskEventService();
    const input = { workspaceId: '0198babc-1234-7000-8000-000000000002', idempotencyKey: 'create-1', command: { type: 'task.create', title: 'Task' }, actor: { id: '0198babc-1234-7000-8000-000000000003', email: 'agent@example.com', displayName: 'Agent', instanceRole: 'user' as const, theme: 'system' as const }, operation };

    const first = await service.execute(executor, input);
    const second = await service.execute(executor, input);

    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, result: first.result });
    expect(operation).toHaveBeenCalledOnce();
  });
});
