import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../src/auth/auth.module';
import { SessionGuard } from '../src/auth/guard';
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

  it('injects AuthService into the session guard', async () => {
    const validateSession = vi.fn().mockResolvedValue(null);
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AuthService)
      .useValue({ validateSession })
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();
    const request = { cookies: { anklav_session: 'token' }, method: 'GET', headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    await expect(module.get(SessionGuard).canActivate(context)).rejects.toMatchObject({ status: 401 });
    expect(validateSession).toHaveBeenCalledWith('token');
    await module.close();
  });
});
