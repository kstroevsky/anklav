import { describe, expect, it } from 'vitest';
import { mergeAfterPages } from './hooks/useAfterList';
import { renderContextPackMarkdown } from './features/knowledge/renderContextPackMarkdown';

describe('operational UI helpers', () => {
  it('merges every nextAfter page in order', () => expect(mergeAfterPages([{ items: [1, 2], nextAfter: 2 }, { items: [3], nextAfter: null }])).toEqual([1, 2, 3]));
  it('renders provider-ready context with omissions and blockers', () => { const markdown = renderContextPackMarkdown({ contentHash: 'abc', taskContract: { title: 'Test' }, blockers: ['lease conflict'], manifest: { target: { adapter: 'codex', projection: 'handoff' }, includedSourceIds: ['taskContract'], omittedSources: [{ sourceId: 'history', reason: 'projection' }], staleSourceWarnings: ['old checkpoint'] } }); expect(markdown).toContain('# Anklav task context'); expect(markdown).toContain('lease conflict'); expect(markdown).toContain('old checkpoint'); });
});
