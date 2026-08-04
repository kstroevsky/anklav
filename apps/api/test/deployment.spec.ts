import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('deployment proxy contract', () => {
  it('preserves the external port in OAuth and MCP origin headers', async () => {
    const configuration = await readFile('../../nginx/default.conf', 'utf8');
    expect(configuration).not.toContain('proxy_set_header Host $host;');
    expect(configuration.match(/proxy_set_header Host \$http_host;/g)?.length).toBe(4);
    expect(configuration.match(/proxy_set_header X-Forwarded-Host \$http_host;/g)?.length).toBe(3);
  });

  it('pins the supported PostgreSQL and pgvector releases with the PostgreSQL 18 volume layout', async () => {
    const [compose, dockerfile, migration] = await Promise.all([
      readFile('../../docker-compose.yml', 'utf8'),
      readFile('../../docker/postgres/Dockerfile', 'utf8'),
      readFile('drizzle/0017_upgrade_vector_086.sql', 'utf8'),
    ]);
    expect(compose).toContain('anklav-postgres:18.4-pgvector0.8.6');
    expect(compose).toContain('PGVECTOR_VERSION: 0.8.6');
    expect(compose).toContain('PGVECTOR_REVISION: 8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c');
    expect(compose).toContain('PG_MAJOR: 18');
    expect(compose).toContain('anklav-postgres:/var/lib/postgresql');
    expect(dockerfile).toContain('FROM postgres:18.4-bookworm');
    expect(dockerfile).toContain('https://github.com/pgvector/pgvector.git#${PGVECTOR_REVISION}');
    expect(migration).toContain("ALTER EXTENSION vector UPDATE TO '0.8.6'");
  });
});
