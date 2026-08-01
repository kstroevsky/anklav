import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { parseBody } from '../common/http';
import type { AuthedRequest } from '../auth';
import { AuthService, SessionGuard } from '../auth';
import { DatabaseService } from '../db/database.service';
import { users } from '../db/schema';

@UseGuards(SessionGuard)
@Controller('api/v1/accounts')
export class AccountController {
  constructor(private readonly database: DatabaseService, private readonly auth: AuthService) {}

  private instanceAdmin(request: AuthedRequest) {
    if (request.user.instanceRole !== 'instance_admin') throw new ForbiddenException('Instance administrator access is required.');
  }

  @Get()
  async list(@Req() request: AuthedRequest, @Query('q') q?: string) {
    this.instanceAdmin(request);
    const rows = await this.database.db.select({ id: users.id, email: users.email, displayName: users.displayName, active: users.active, instanceRole: users.instanceRole, createdAt: users.createdAt })
      .from(users).orderBy(asc(users.displayName)).limit(100);
    return q?.trim() ? rows.filter((entry) => `${entry.displayName} ${entry.email}`.toLowerCase().includes(q.toLowerCase())) : rows;
  }

  @Post()
  create(@Req() request: AuthedRequest, @Body() body: unknown) {
    this.instanceAdmin(request);
    const input = parseBody(z.object({ email: z.string().email(), displayName: z.string().trim().min(1).max(100), password: z.string().min(12).max(256) }), body);
    return this.auth.createAccount(request.user, input);
  }

  @Patch(':userId/password')
  resetPassword(@Param('userId') userId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    this.instanceAdmin(request);
    const input = parseBody(z.object({ password: z.string().min(12).max(256) }), body);
    return this.auth.resetPassword(request.user, userId, input.password).then(() => ({ ok: true }));
  }
}

