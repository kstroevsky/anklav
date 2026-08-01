import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { parseBody } from '../common/http';
import { OAuthService } from './service';
import { z } from 'zod';

@UseGuards(SessionGuard)
@Controller('api/v1/oauth')
export class OAuthSettingsController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('requests/:requestId')
  request(@Param('requestId') requestId: string, @Req() request: AuthedRequest) {
    return this.oauth.consentRequest(requestId, request.user);
  }

  @Post('requests/:requestId/decision')
  decide(@Param('requestId') requestId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(z.object({ approve: z.boolean(), workspaceIds: z.array(z.string().uuid()).max(100).default([]) }), body);
    return this.oauth.decideConsent(requestId, request.user, input);
  }

  @Get('grants')
  grants(@Req() request: AuthedRequest) { return this.oauth.listGrants(request.user); }

  @Delete('grants/:grantId')
  async revokeGrant(@Param('grantId') grantId: string, @Req() request: AuthedRequest) {
    await this.oauth.revokeGrant(request.user, grantId);
    return { ok: true };
  }
}


