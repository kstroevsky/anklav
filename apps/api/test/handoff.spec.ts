import { describe, expect, it } from 'vitest';
import { handoffBlockers } from '../src/execution/handoff';

describe('handoff readiness', () => {
  it('accepts a checkpointed clean slice without an active lease', () => expect(handoffBlockers({ checkpointPresent: true, gitSlice: { dirtyState: 'clean' }, activeWriteLeaseCount: 0 })).toEqual([]));
  it('requires exact patch evidence for captured dirty state', () => expect(handoffBlockers({ checkpointPresent: true, gitSlice: { dirtyState: 'dirty_captured' }, activeWriteLeaseCount: 0 })).toContain('The latest dirty Git slice has no exact patch evidence.'));
  it('blocks overlapping writers but does not require an active lease', () => expect(handoffBlockers({ checkpointPresent: true, gitSlice: { dirtyState: 'clean' }, activeWriteLeaseCount: 2 })).toContain('2 active write leases must be released or expire.'));
});
