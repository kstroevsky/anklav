import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OAuthService } from './service';
import { oauthResult } from './utils';

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Post('register')
  register(@Body() body: unknown, @Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.register(body, request.ip);
  }

  @Get('authorize')
  async authorize(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    const pending = await this.oauth.beginAuthorization(query);
    return reply.code(302).redirect(`${this.oauth.appOrigin()}/oauth/consent?request=${encodeURIComponent(pending.id)}`);
  }

  @Post('token')
  async token(@Body() body: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    try {
      const result = await this.oauth.exchangeToken(body, request.ip);
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      return reply.send(result);
    } catch (error) {
      const result = oauthResult(error);
      reply.code(result.status).header('cache-control', 'no-store').header('pragma', 'no-cache');
      return reply.send(result.body);
    }
  }

  @Post('revoke')
  async revoke(@Body() body: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    this.oauth.assertCanonicalRequest(request);
    await this.oauth.revoke(body, request.ip);
    return reply.code(200).send();
  }
}


