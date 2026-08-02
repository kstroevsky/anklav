import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

@Injectable()
export class EvidenceStorageService {
  private readonly root = resolve(process.env.EVIDENCE_STORAGE_PATH ?? resolve(process.cwd(), '.anklav/evidence'));

  decode(contentBase64: string): Buffer {
    if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw new BadRequestException('contentBase64 must be canonical base64.');
    const content = Buffer.from(contentBase64, 'base64');
    if (!content.length) throw new BadRequestException('Evidence content must not be empty.');
    if (content.length > MAX_EVIDENCE_BYTES) throw new BadRequestException(`Evidence content exceeds the ${MAX_EVIDENCE_BYTES}-byte upload limit.`);
    if (content.toString('base64') !== contentBase64) throw new BadRequestException('contentBase64 must be canonical base64.');
    return content;
  }

  hash(content: Buffer): string { return createHash('sha256').update(content).digest('hex'); }

  storageKey(hash: string): string { return `${hash.slice(0, 2)}/${hash}`; }

  async persist(hash: string, content: Buffer): Promise<{ storageKey: string; byteSize: number; verifiedAt: Date }> {
    const target = this.path(hash);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      const existing = await readFile(target);
      if (this.hash(existing) !== hash) throw new InternalServerErrorException('Content-addressed evidence storage is corrupt.');
      return { storageKey: this.storageKey(hash), byteSize: existing.length, verifiedAt: new Date() };
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: any) => { if (error?.code !== 'ENOENT') throw error; });
    }
    const stored = await readFile(target);
    if (stored.length !== content.length || this.hash(stored) !== hash) throw new InternalServerErrorException('Evidence failed post-write integrity verification.');
    return { storageKey: this.storageKey(hash), byteSize: stored.length, verifiedAt: new Date() };
  }

  async readRange(hash: string, offset: number, length: number) {
    const target = this.path(hash);
    await this.verify(hash);
    const metadata = await stat(target);
    if (offset > metadata.size) throw new BadRequestException('Evidence range starts beyond the end of the artifact.');
    const safeLength = Math.min(length, metadata.size - offset);
    const handle = await open(target, 'r');
    try {
      const content = Buffer.alloc(safeLength);
      await handle.read(content, 0, safeLength, offset);
      return { content, totalBytes: metadata.size, offset, nextOffset: offset + safeLength < metadata.size ? offset + safeLength : null };
    } finally { await handle.close(); }
  }

  createReadStream(hash: string) { return createReadStream(this.path(hash)); }

  async verify(hash: string): Promise<void> {
    const content = await readFile(this.path(hash));
    if (this.hash(content) !== hash) throw new InternalServerErrorException('Content-addressed evidence storage is corrupt.');
  }

  private path(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new BadRequestException('Invalid evidence content hash.');
    return resolve(this.root, this.storageKey(hash));
  }
}
