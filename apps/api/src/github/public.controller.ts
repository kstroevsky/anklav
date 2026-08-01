import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GitHubService } from './service';

@Controller('api/v1/github')
export class GitHubPublicController {
  constructor(private readonly github: GitHubService) {}
  @Get('manifest/redirect') redirect(@Query('state') state: string, @Res() reply: FastifyReply) { return this.github.manifestRedirect(state, reply); }
  @Get('manifest/callback') async callback(@Query('code') code: string, @Query('state') state: string, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeManifest(code, state)); }
  @Get('manifest/setup') async setup(@Query('state') state: string, @Query('installation_id') installationId: string | undefined, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeSetup(state, installationId)); }
  @Get('oauth/callback') async oauth(@Query('code') code: string, @Query('state') state: string, @Res() reply: FastifyReply) { reply.redirect(await this.github.completeUserOAuth(code, state)); }
  @Post('webhook') webhook(@Req() request: FastifyRequest, @Res() reply: FastifyReply) { return this.github.webhook(request, reply); }
}

