import { createCipheriv, createDecipheriv, createHash, createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { slugify } from '../common/ids';

export const GITHUB_API = 'https://api.github.com';

export function githubFeatureEnabled() { return process.env.GITHUB_INTEGRATION_ENABLED === 'true'; }

export function taskBranchName(identifier: string, title: string, template = '{identifier}-{slug}') {
  const slug = slugify(title) || 'task';
  return template.replaceAll('{identifier}', identifier.toLowerCase()).replaceAll('{slug}', slug).slice(0, 240);
}

export function githubReferences(text: string, identifiers: string[]) {
  const lookup = new Map(identifiers.map((identifier) => [identifier.toUpperCase(), identifier]));
  const found = new Map<string, 'closing' | 'reference' | 'ignored'>();
  const pattern = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/gi;
  for (const match of text.matchAll(pattern)) {
    const identifier = lookup.get(match[0]!.toUpperCase());
    if (!identifier) continue;
    const prefix = text.slice(Math.max(0, match.index! - 48), match.index!);
    found.set(identifier, githubLinkKindForPrefix(prefix));
  }
  return [...found].map(([identifier, linkKind]) => ({ identifier, linkKind }));
}

/** Exponential retry with bounded jitter avoids synchronized GitHub retry storms. */
export function githubRetryDelay(attempt: number, random = Math.random) {
  const capped = Math.min(60 * 60_000, 2 ** Math.max(0, attempt - 1) * 1_000);
  return Math.round(capped * (0.75 + random() * 0.5));
}

function githubLinkKindForPrefix(prefix: string): 'closing' | 'reference' | 'ignored' {
  const candidates: Array<{ kind: 'closing' | 'reference' | 'ignored'; index: number }> = [];
  for (const [kind, pattern] of [
    ['closing', /\b(close|closes|closed|closing|fix|fixes|fixed|fixing|resolve|resolves|resolved|resolving|complete|completes|completed|completing|implement|implements|implemented|implementing)\b/gi],
    ['reference', /\b(ref|refs|reference|references|part of|related to|relates to|contributes to|toward|towards)\b/gi],
    ['ignored', /\b(skip|ignore)\b/gi],
  ] as const) for (const match of prefix.matchAll(pattern)) candidates.push({ kind, index: match.index! });
  return candidates.sort((left, right) => right.index - left.index)[0]?.kind ?? 'closing';
}

export function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function publicBaseUrl() {
  const value = process.env.PUBLIC_BASE_URL ?? process.env.APP_ORIGIN;
  if (!value) throw new BadRequestException('PUBLIC_BASE_URL is required before GitHub can be configured.');
  if (!value.startsWith('https://') && process.env.NODE_ENV === 'production') throw new BadRequestException('PUBLIC_BASE_URL must use HTTPS in production.');
  return value.replace(/\/$/, '');
}

export function encryptionKey() {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY is required before GitHub can be configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new BadRequestException('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptIntegrationSecret(value: string) {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Malformed encrypted integration secret.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function verifyGitHubWebhookSignature(raw: Buffer, secret: string, signature: string) {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function appJwt(appId: number, privateKey: string) {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (entry: unknown) => Buffer.from(JSON.stringify(entry)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 540, iss: appId })}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
}

export function githubHeaders(token?: string) { return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }
export function escapeHtml(value: string) { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
