import { describe, expect, it } from 'vitest';
import { buildContextualPrefix, buildEmbeddingText, semanticUnits } from '../src/retrieval/document';
import { retrievalSearchInput } from '../src/retrieval/inputs';
import { DEFAULT_EMBEDDING_MODEL_REVISION } from '../src/retrieval/profiles';
import { classifyRetrievalIntent, hybridScore } from '../src/retrieval/ranking';

describe('hybrid retrieval contracts', () => {
  it('requires task searches to remain inside an explicit project boundary', () => {
    const base = { query: 'Where is the session guard?', taskId: '0198babc-1234-7000-8000-000000000001' };
    expect(retrievalSearchInput.safeParse(base).success).toBe(false);
    expect(retrievalSearchInput.safeParse({ ...base, projectId: '0198babc-1234-7000-8000-000000000002' }).success).toBe(true);
  });

  it('requires semantic searches to name a server-side profile without treating 768 as a universal input fact', () => {
    const base = { query: 'session guard', projectId: '0198babc-1234-7000-8000-000000000002' };
    expect(retrievalSearchInput.safeParse({ ...base, embeddingProfileKey: 'nomic-v2-768' }).success).toBe(false);
    expect(retrievalSearchInput.safeParse({ ...base, queryEmbedding: [0.01] }).success).toBe(false);
    expect(retrievalSearchInput.safeParse({ ...base, embeddingProfileKey: 'future-profile', queryEmbedding: [0.01] }).success).toBe(true);
    expect(retrievalSearchInput.safeParse({ ...base, embeddingProfileKey: 'future-profile', queryEmbedding: [Number.NaN] }).success).toBe(false);
    expect(DEFAULT_EMBEDDING_MODEL_REVISION).toMatch(/^[a-f0-9]{40}$/);
  });

  it('builds bounded, contextualized, redacted semantic units', () => {
    const parts = semanticUnits(`${'a'.repeat(1_000)}\n\n${'b'.repeat(1_000)}`);
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.length <= 1_400)).toBe(true);
    expect(semanticUnits('x'.repeat(2_000)).map((part) => part.length)).toEqual([1_400, 600]);
    const prefix = buildContextualPrefix({ project: 'Anklav', task: 'ANK-42', sourceType: 'decision', sourceId: 'decision-1', sourcePart: 0, status: 'current', recordedAt: new Date('2026-08-04T00:00:00.000Z'), validFromAt: new Date('2026-08-01T00:00:00.000Z'), validUntilAt: null, authorityBasisPoints: 9_500, sensitivity: 'task', metadata: { effectiveRepository: 'anklav', effectiveFromCommit: 'abc1234', classification: 'fact', provider: 'codex' } });
    expect(prefix).toContain('git:abc1234..open');
    expect(prefix).toContain('authority:0.9500');
    expect(prefix).toContain('sensitivity:task');
    const embeddingText = buildEmbeddingText(prefix, 'Credential example', 'api_key=super-secret-value');
    expect(embeddingText).toContain('api_key=[REDACTED]');
    expect(embeddingText).not.toContain('super-secret-value');
  });

  it('classifies exact and historical intent before broad semantic retrieval', () => {
    expect(classifyRetrievalIntent('error TS2339 in execution/service.ts')).toBe('exact_error');
    expect(classifyRetrievalIntent('why did authentication change last year?')).toBe('historical_explanation');
    expect(classifyRetrievalIntent('what database is currently authoritative?')).toBe('current_fact');
  });

  it('reranks verified exact-task evidence above a semantically close low-authority episode', () => {
    const verified = hybridScore({ intent: 'current_fact', lexical: 0.8, semantic: 0.75, authority: 0.95, affinity: 1, recency: 0.7 });
    const episode = hybridScore({ intent: 'current_fact', lexical: 0.65, semantic: 0.9, authority: 0.45, affinity: 0.7, recency: 1 });
    expect(verified).toBeGreaterThan(episode);
    expect(verified).toBeLessThanOrEqual(1);
  });
});
