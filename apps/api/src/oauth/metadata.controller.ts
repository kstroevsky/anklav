import { Controller, Get, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { OAuthService } from './service';

@Controller()
export class OAuthMetadataController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('.well-known/oauth-protected-resource')
  protectedResource(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-protected-resource/mcp')
  protectedResourceAtMcp(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-authorization-server')
  authorizationServer(@Req() request: FastifyRequest) {
    this.oauth.assertCanonicalRequest(request);
    return this.oauth.authorizationServerMetadata();
  }
}


