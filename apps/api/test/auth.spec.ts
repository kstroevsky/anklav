import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthService } from '../src/auth/service';
import { DatabaseService } from '../src/db/database.service';

describe('AuthService dependency injection', () => {
  it('uses the injected database when checking setup status', async () => {
    const from = vi.fn().mockResolvedValue([{ value: 1 }]);
    const database = { db: { select: vi.fn(() => ({ from })) } };
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

    await expect(module.get(AuthService).isInitialized()).resolves.toBe(true);
    expect(from).toHaveBeenCalledOnce();
    await module.close();
  });
});
