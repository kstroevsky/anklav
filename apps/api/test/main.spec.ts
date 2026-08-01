import { afterEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

process.env.DATABASE_URL ??= 'postgres://anklav:anklav@127.0.0.1:5432/anklav';

const applications: NestFastifyApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('API bootstrap', () => {
  it('initializes with the raw-body parser enabled', async () => {
    const { createApplication } = await import('../src/main');
    const app = await createApplication();
    applications.push(app);

    await app.init();
    expect(app.getHttpAdapter().getInstance().hasContentTypeParser('application/json')).toBe(true);
  });
});
