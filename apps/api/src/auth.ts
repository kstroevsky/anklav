import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Patch, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { and, count, eq, gt } from 'drizzle-orm';
import * as argon2 from 'argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_FLOW_STATES, DEFAULT_TASK_STATES } from './common/domain';
import { parseBody } from './common/http';
import { slugify } from './common/ids';
import { DatabaseService } from './db/database.service';
import { sessions, users, workflowStates, workspaceMemberships, workspaces } from './db/schema';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  instanceRole: 'user' | 'instance_admin';
  theme: 'system' | 'light' | 'dark';
}

export type AuthedRequest = FastifyRequest & { user: AuthUser; sessionId: string; csrfToken: string };

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
});

const setupSchema = credentialsSchema.extend({
  displayName: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(1).max(120),
  setupToken: z.string().min(16).max(512),
});

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    };
  }

  async isInitialized(): Promise<boolean> {
    const [result] = await this.database.db.select({ value: count() }).from(users);
    return (result?.value ?? 0) > 0;
  }

  async setup(input: z.infer<typeof setupSchema>, reply: FastifyReply) {
    const expectedToken = process.env.ANKLAV_SETUP_TOKEN;
    if (!expectedToken || input.setupToken.length !== expectedToken.length || !timingSafeEqual(Buffer.from(input.setupToken), Buffer.from(expectedToken))) {
      throw new UnauthorizedException('The setup token is invalid.');
    }
    if (await this.isInitialized()) throw new UnauthorizedException('Setup has already been completed.');

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const baseSlug = slugify(input.workspaceName) || 'workspace';
    const result = await this.database.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        instanceRole: 'instance_admin',
      }).returning();
      const [workspace] = await tx.insert(workspaces).values({ name: input.workspaceName, slug: baseSlug }).returning();
      await tx.insert(workspaceMemberships).values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' });
      await tx.insert(workflowStates).values([
        ...DEFAULT_TASK_STATES.map(([name, semantic, color], position) => ({ workspaceId: workspace!.id, entityType: 'task' as const, name, color, taskSemantic: semantic, position, isInitial: position === 0 })),
        ...DEFAULT_FLOW_STATES.map(([name, semantic, color], position) => ({ workspaceId: workspace!.id, entityType: 'flow' as const, name, color, flowSemantic: semantic, position, isInitial: position === 0 })),
      ]);
      return { user: user!, workspace: workspace! };
    });
    return this.createSession(result.user, reply);
  }

  async login(input: z.infer<typeof credentialsSchema>, reply: FastifyReply) {
    const [user] = await this.database.db.select().from(users).where(and(eq(users.email, input.email), eq(users.active, true))).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw new UnauthorizedException('Invalid email or password.');
    return this.createSession(user, reply);
  }

  async createSession(user: typeof users.$inferSelect, reply: FastifyReply) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.database.db.insert(sessions).values({ userId: user.id, tokenHash: this.hashToken(token), csrfToken, expiresAt });
    reply.setCookie('anklav_session', token, this.cookieOptions());
    return { user: publicUser(user), csrfToken };
  }

  async logout(request: AuthedRequest, reply: FastifyReply): Promise<void> {
    await this.database.db.delete(sessions).where(eq(sessions.id, request.sessionId));
    reply.clearCookie('anklav_session', { path: '/' });
  }

  async changePassword(request: AuthedRequest, currentPassword: string, nextPassword: string): Promise<void> {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, request.user.id)).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) throw new UnauthorizedException('Current password is incorrect.');
    await this.database.db.update(users).set({ passwordHash: await argon2.hash(nextPassword, { type: argon2.argon2id }), updatedAt: new Date() }).where(eq(users.id, user.id));
    await this.database.db.delete(sessions).where(eq(sessions.userId, user.id));
  }

  async updateTheme(request: AuthedRequest, theme: 'system' | 'light' | 'dark'): Promise<AuthUser> {
    const [updated] = await this.database.db.update(users).set({ theme, updatedAt: new Date() }).where(eq(users.id, request.user.id)).returning();
    return publicUser(updated!);
  }

  async createAccount(actor: AuthUser, input: { email: string; displayName: string; password: string }) {
    if (actor.instanceRole !== 'instance_admin') throw new ForbiddenException('Instance administrator access is required.');
    const [account] = await this.database.db.insert(users).values({
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
    }).returning();
    return publicUser(account!);
  }

  async resetPassword(actor: AuthUser, userId: string, password: string): Promise<void> {
    if (actor.instanceRole !== 'instance_admin') throw new ForbiddenException('Instance administrator access is required.');
    const [target] = await this.database.db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw new UnauthorizedException('User not found.');
    await this.database.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await argon2.hash(password, { type: argon2.argon2id }), updatedAt: new Date() }).where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
  }

  async validateSession(token: string | undefined): Promise<(AuthUser & { sessionId: string; csrfToken: string }) | null> {
    if (!token) return null;
    const [row] = await this.database.db.select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, this.hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
      .limit(1);
    if (!row) return null;
    await this.database.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
    return { ...publicUser(row.user), sessionId: row.session.id, csrfToken: row.session.csrfToken };
  }
}

export function publicUser(user: typeof users.$inferSelect): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, instanceRole: user.instanceRole, theme: user.theme as AuthUser['theme'] };
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const session = await this.auth.validateSession((request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.anklav_session);
    if (!session) throw new UnauthorizedException();
    const authed = request as AuthedRequest;
    authed.user = session;
    authed.sessionId = session.sessionId;
    authed.csrfToken = session.csrfToken;
    const method = request.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && request.headers['x-csrf-token'] !== session.csrfToken) {
      throw new UnauthorizedException('CSRF token is missing or invalid.');
    }
    return true;
  }
}

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('setup-status')
  async setupStatus() {
    return { initialized: await this.auth.isInitialized() };
  }

  @Post('setup')
  async setup(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.auth.setup(parseBody(setupSchema, body), reply);
  }

  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.auth.login(parseBody(credentialsSchema, body), reply);
  }

  @UseGuards(SessionGuard)
  @Get('me')
  async me(@Req() request: AuthedRequest) {
    return { user: request.user, csrfToken: request.csrfToken };
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  async logout(@Req() request: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(request, reply);
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Patch('password')
  async changePassword(@Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(12).max(256) }), body);
    await this.auth.changePassword(request, input.currentPassword, input.nextPassword);
    return { ok: true };
  }

  @Patch('preferences')
  async preferences(@Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(z.object({ theme: z.enum(['system', 'light', 'dark']) }), body);
    return { user: await this.auth.updateTheme(request, input.theme) };
  }
}
