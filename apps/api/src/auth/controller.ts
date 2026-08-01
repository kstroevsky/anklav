import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../common/http';
import type { AuthedRequest } from './types';
import { AuthService } from './service';
import { SessionGuard } from './guard';
import { credentialsSchema, setupSchema } from './inputs';

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

