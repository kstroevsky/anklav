import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evidenceArtifactInput } from '../src/evidence/inputs';
import { EvidenceStorageService } from '../src/evidence/storage.service';

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
  delete process.env.EVIDENCE_STORAGE_PATH;
});

describe('content-addressed evidence', () => {
  it('persists immutable bytes under their SHA-256 hash and reads exact ranges', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'anklav-evidence-'));
    process.env.EVIDENCE_STORAGE_PATH = temporaryRoot;
    const storage = new EvidenceStorageService();
    const content = storage.decode(Buffer.from('first exact error\nfinal exact error').toString('base64'));
    const contentHash = storage.hash(content);
    const first = await storage.persist(contentHash, content);
    const second = await storage.persist(contentHash, content);
    const range = await storage.readRange(contentHash, 6, 11);

    expect(first.storageKey).toBe(`${contentHash.slice(0, 2)}/${contentHash}`);
    expect(second.byteSize).toBe(content.length);
    expect(range.content.toString()).toBe('exact error');
    expect(range.nextOffset).toBe(17);
  });

  it('rejects non-canonical base64 and mismatched run-event scope', () => {
    const storage = new EvidenceStorageService();
    expect(() => storage.decode('not base64')).toThrow();
    expect(evidenceArtifactInput.safeParse({ idempotencyKey: 'evidence-1', type: 'terminal_log', mimeType: 'text/plain', title: 'Log', producer: 'codex', contentBase64: 'YQ==', runEventId: '0198babc-1234-7000-8000-000000000001' }).success).toBe(false);
  });
});
