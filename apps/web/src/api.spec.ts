import { describe, expect, it } from 'vitest';
import { mutation } from './api';

describe('API mutation requests', () => {
  it('adds an optimistic concurrency precondition for versioned changes', () => {
    expect(mutation('PATCH', { name: 'Renamed' }, 4)).toMatchObject({
      method: 'PATCH',
      body: '{"name":"Renamed"}',
      headers: { 'If-Match': '4' },
    });
  });
});
