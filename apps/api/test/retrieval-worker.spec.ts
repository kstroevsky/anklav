import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../src/db/database.service';
import type { EmbeddingProvider } from '../src/retrieval/embedding-provider';
import { EmbeddingWorkerService } from '../src/retrieval/worker.service';

afterEach(() => {
  delete process.env.EMBEDDING_WORKER_LEASE_SECONDS;
  delete process.env.EMBEDDING_REQUEST_TIMEOUT_MS;
});

describe('durable embedding worker', () => {
  it('keeps the lease, retry, and hash-guard contracts in the durable PostgreSQL worker', async () => {
    const [source, migration] = await Promise.all([
      readFile('src/retrieval/worker.service.ts', 'utf8'),
      readFile('drizzle/0019_add_embedding_jobs.sql', 'utf8'),
    ]);
    expect(source).toContain('FOR UPDATE SKIP LOCKED');
    expect(source).toContain("status: 'superseded'");
    expect(source).toContain('document.contentHash !== job.contentHash');
    expect(migration).toContain('retrieval_embedding_jobs_claim_index');
    expect(migration).toContain('ON DELETE cascade');
  });

  it('performs exhaustion cleanup and an atomic skip-locked claim without work', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const database = { db: { execute } } as unknown as DatabaseService;
    const provider = { configured: () => true, embed: vi.fn() } satisfies EmbeddingProvider;
    const worker = new EmbeddingWorkerService(database, provider);
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(provider.embed).not.toHaveBeenCalled();
  });

  it('rejects a lease shorter than the provider request timeout', () => {
    process.env.EMBEDDING_WORKER_LEASE_SECONDS = '60';
    process.env.EMBEDDING_REQUEST_TIMEOUT_MS = '60000';
    const worker = new EmbeddingWorkerService({} as DatabaseService, { configured: () => true, embed: vi.fn() });
    expect(() => worker.assertConfigured()).toThrow(/must exceed/);
  });
});
