import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { embeddingProfiles, retrievalDocuments, retrievalEmbeddingJobs, retrievalEmbeddings } from '../db/schema';
import { redactEmbeddingText } from './document';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding-provider';

type ClaimedJob = typeof retrievalEmbeddingJobs.$inferSelect;
type WorkItem = { job: ClaimedJob; document: typeof retrievalDocuments.$inferSelect; profile: typeof embeddingProfiles.$inferSelect };

@Injectable()
export class EmbeddingWorkerService {
  private readonly workerId = process.env.EMBEDDING_WORKER_ID ?? `embedding-worker-${process.pid}`;

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider) {}

  assertConfigured(): void {
    if (!this.provider.configured()) throw new Error('Embedding worker requires EMBEDDING_BASE_URL and EMBEDDING_MODEL_REVISION.');
    const leaseMs = environmentInteger('EMBEDDING_WORKER_LEASE_SECONDS', 300, 60, 3_600) * 1_000;
    const requestTimeoutMs = environmentInteger('EMBEDDING_REQUEST_TIMEOUT_MS', 30_000, 1_000, 120_000);
    if (leaseMs <= requestTimeoutMs + 5_000) throw new Error('EMBEDDING_WORKER_LEASE_SECONDS must exceed EMBEDDING_REQUEST_TIMEOUT_MS by at least five seconds.');
  }

  async runOnce(): Promise<number> {
    this.assertConfigured();
    const claimed = await this.claimJobs();
    if (!claimed.length) return 0;
    const rows = await this.database.db.select({ job: retrievalEmbeddingJobs, document: retrievalDocuments, profile: embeddingProfiles })
      .from(retrievalEmbeddingJobs)
      .innerJoin(retrievalDocuments, eq(retrievalDocuments.id, retrievalEmbeddingJobs.documentId))
      .innerJoin(embeddingProfiles, eq(embeddingProfiles.key, retrievalEmbeddingJobs.profileKey))
      .where(inArray(retrievalEmbeddingJobs.id, claimed.map((job) => job.id)));
    const valid: WorkItem[] = [];
    for (const row of rows) {
      const job = row.job;
      if (!row.profile.active || row.document.contentHash !== job.contentHash) await this.supersede(job.id);
      else valid.push({ job, document: row.document, profile: row.profile });
    }
    const groups = new Map<string, WorkItem[]>();
    for (const item of valid) groups.set(item.profile.key, [...(groups.get(item.profile.key) ?? []), item]);
    for (const items of groups.values()) await this.processProfileBatch(items);
    return claimed.length;
  }

  private async claimJobs(): Promise<Array<{ id: string }>> {
    const batchSize = environmentInteger('EMBEDDING_WORKER_BATCH_SIZE', 16, 1, 64);
    const leaseSeconds = environmentInteger('EMBEDDING_WORKER_LEASE_SECONDS', 300, 60, 3_600);
    await this.database.db.execute(sql`
      UPDATE retrieval_embedding_jobs
      SET status = 'dead', locked_at = NULL, locked_by = NULL, updated_at = now(), last_error = coalesce(last_error, 'Maximum attempts exhausted.')
      WHERE attempts >= max_attempts
        AND (status = 'queued' OR (status = 'running' AND locked_at < now() - (${leaseSeconds} * interval '1 second')))
    `);
    const result = await this.database.db.execute(sql`
      WITH selected_profile AS (
        SELECT profile_key
        FROM retrieval_embedding_jobs
        WHERE attempts < max_attempts
          AND ((status = 'queued' AND run_after <= now())
            OR (status = 'running' AND locked_at < now() - (${leaseSeconds} * interval '1 second')))
        ORDER BY run_after, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ), candidates AS (
        SELECT id
        FROM retrieval_embedding_jobs
        WHERE attempts < max_attempts
          AND profile_key = (SELECT profile_key FROM selected_profile)
          AND ((status = 'queued' AND run_after <= now())
            OR (status = 'running' AND locked_at < now() - (${leaseSeconds} * interval '1 second')))
        ORDER BY run_after, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE retrieval_embedding_jobs j
      SET status = 'running', attempts = j.attempts + 1, locked_at = now(), locked_by = ${this.workerId}, last_error = NULL, updated_at = now()
      FROM candidates
      WHERE j.id = candidates.id
      RETURNING j.id
    `);
    return result.rows as Array<{ id: string }>;
  }

  private async processProfileBatch(items: WorkItem[]): Promise<void> {
    if (!items.length) return;
    try {
      const vectors = await this.provider.embed(items[0]!.profile, 'document', items.map((item) => item.document.embeddingText));
      for (const [index, item] of items.entries()) await this.complete(item, vectors[index]!);
    } catch (error) {
      await Promise.all(items.map((item) => this.fail(item.job, error)));
    }
  }

  private async complete(item: WorkItem, embedding: number[]): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [job] = await tx.select().from(retrievalEmbeddingJobs).where(and(eq(retrievalEmbeddingJobs.id, item.job.id), eq(retrievalEmbeddingJobs.status, 'running'), eq(retrievalEmbeddingJobs.lockedBy, this.workerId))).limit(1);
      if (!job) return;
      const [document] = await tx.select({ contentHash: retrievalDocuments.contentHash }).from(retrievalDocuments).where(eq(retrievalDocuments.id, job.documentId)).limit(1);
      if (!document || document.contentHash !== job.contentHash) {
        await tx.update(retrievalEmbeddingJobs).set({ status: 'superseded', lockedAt: null, lockedBy: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(retrievalEmbeddingJobs.id, job.id));
        return;
      }
      await tx.insert(retrievalEmbeddings).values({ documentId: job.documentId, profileKey: job.profileKey, contentHash: job.contentHash, embedding }).onConflictDoUpdate({ target: [retrievalEmbeddings.documentId, retrievalEmbeddings.profileKey], set: { contentHash: job.contentHash, embedding, updatedAt: new Date() } });
      await tx.update(retrievalEmbeddingJobs).set({ status: 'completed', lockedAt: null, lockedBy: null, completedAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(retrievalEmbeddingJobs.id, job.id));
    });
  }

  private async supersede(jobId: string): Promise<void> {
    await this.database.db.update(retrievalEmbeddingJobs).set({ status: 'superseded', lockedAt: null, lockedBy: null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(retrievalEmbeddingJobs.id, jobId), eq(retrievalEmbeddingJobs.lockedBy, this.workerId)));
  }

  private async fail(job: ClaimedJob, error: unknown): Promise<void> {
    const exhausted = job.attempts >= job.maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.min(job.attempts, 8));
    const message = redactEmbeddingText(error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    await this.database.db.update(retrievalEmbeddingJobs).set({ status: exhausted ? 'dead' : 'queued', runAfter: new Date(Date.now() + delaySeconds * 1_000), lockedAt: null, lockedBy: null, completedAt: exhausted ? new Date() : null, lastError: message, updatedAt: new Date() }).where(and(eq(retrievalEmbeddingJobs.id, job.id), eq(retrievalEmbeddingJobs.status, 'running'), eq(retrievalEmbeddingJobs.lockedBy, this.workerId)));
  }
}

function environmentInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}
