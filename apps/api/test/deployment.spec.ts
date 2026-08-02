import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('deployment proxy contract', () => {
  it('preserves the external port in OAuth and MCP origin headers', async () => {
    const configuration = await readFile('../../nginx/default.conf', 'utf8');
    expect(configuration).not.toContain('proxy_set_header Host $host;');
    expect(configuration.match(/proxy_set_header Host \$http_host;/g)?.length).toBe(4);
    expect(configuration.match(/proxy_set_header X-Forwarded-Host \$http_host;/g)?.length).toBe(3);
  });
});
