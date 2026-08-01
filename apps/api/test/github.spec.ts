import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { decryptIntegrationSecret, encryptIntegrationSecret, githubReferences, githubRetryDelay, taskBranchName, verifyGitHubWebhookSignature } from '../src/github';

describe('GitHub task linking primitives', () => {
  it('creates a safe, readable Git branch name from a stable task identifier', () => {
    expect(taskBranchName('API-123', 'Add GitHub: pull-request reviews!')).toBe('api-123-add-github-pull-request-reviews');
  });

  it('understands closing, reference, and ignore magic words for multiple tasks', () => {
    const links = githubReferences('Fixes api-12 and references WEB-7. Ignore API-99.', ['API-12', 'WEB-7', 'API-99']);
    expect(links).toEqual([
      { identifier: 'API-12', linkKind: 'closing' },
      { identifier: 'WEB-7', linkKind: 'reference' },
      { identifier: 'API-99', linkKind: 'ignored' },
    ]);
  });

  it('uses bounded jittered exponential retry delays', () => {
    expect(githubRetryDelay(1, () => 0)).toBe(750);
    expect(githubRetryDelay(1, () => 1)).toBe(1_250);
    expect(githubRetryDelay(20, () => 0.5)).toBe(3_600_000);
  });

  it('encrypts integration credentials and rejects a modified webhook signature', () => {
    const previous = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const encrypted = encryptIntegrationSecret('private GitHub credential');
      expect(encrypted).not.toContain('private GitHub credential');
      expect(decryptIntegrationSecret(encrypted)).toBe('private GitHub credential');
      const raw = Buffer.from('{"zen":"Keep it logically awesome."}');
      const signature = `sha256=${createHmac('sha256', 'webhook-secret').update(raw).digest('hex')}`;
      expect(verifyGitHubWebhookSignature(raw, 'webhook-secret', signature)).toBe(true);
      expect(verifyGitHubWebhookSignature(raw, 'webhook-secret', `${signature}0`)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = previous;
    }
  });
});
