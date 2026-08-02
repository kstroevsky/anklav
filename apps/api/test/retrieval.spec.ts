import { describe, expect, it } from 'vitest';
import { embeddingInput, retrievalSearchInput } from '../src/retrieval/inputs';
import { classifyRetrievalIntent, hybridScore } from '../src/retrieval/ranking';

describe('hybrid retrieval contracts', () => {
  it('requires task searches to remain inside an explicit project boundary', () => {
    const base = { query: 'Where is the session guard?', taskId: '0198babc-1234-7000-8000-000000000001' };
    expect(retrievalSearchInput.safeParse(base).success).toBe(false);
    expect(retrievalSearchInput.safeParse({ ...base, projectId: '0198babc-1234-7000-8000-000000000002' }).success).toBe(true);
  });

  it('accepts only the configured embedding dimension and finite values', () => {
    const valid = { model: 'nomic-embed-text-v1.5', contentHash: 'a'.repeat(64), embedding: Array.from({ length: 768 }, () => 0.01) };
    expect(embeddingInput.safeParse(valid).success).toBe(true);
    expect(embeddingInput.safeParse({ ...valid, embedding: [0.01] }).success).toBe(false);
    expect(embeddingInput.safeParse({ ...valid, embedding: [...valid.embedding.slice(0, -1), Number.NaN] }).success).toBe(false);
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
