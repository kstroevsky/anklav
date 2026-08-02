import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth'; import { SessionGuard } from '../auth'; import { parseBody } from '../common/http';
import { proposeClaimInput, proposeDecisionInput, resolutionInput, supersedeInput } from './inputs'; import { MemoryService } from './service';

@UseGuards(SessionGuard) @Controller('api/v1/workspaces/:workspaceId/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}
  @Get('claims') listClaims(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('projectId') projectId?: string, @Query('taskId') taskId?: string, @Query('current') current?: string) { return this.memory.listClaims(workspaceId, request.user, { projectId, taskId, current: current === 'true' }); }
  @Post('claims') proposeClaim(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.memory.proposeClaim(workspaceId, request.user, parseBody(proposeClaimInput, body)); }
  @Post('claims/:claimId/resolve') resolveClaim(@Param('workspaceId') workspaceId: string, @Param('claimId') claimId: string, @Req() request: AuthedRequest, @Body() body: unknown) { const input = parseBody(resolutionInput, body); return this.memory.resolveClaim(workspaceId, request.user, claimId, input.action, input.note); }
  @Post('claims/:claimId/supersede') supersedeClaim(@Param('workspaceId') workspaceId: string, @Param('claimId') claimId: string, @Req() request: AuthedRequest, @Body() body: unknown) { const input = parseBody(supersedeInput, body); return this.memory.supersedeClaim(workspaceId, request.user, claimId, input.replacementId, input.note, input.validUntilAt, input.validUntilCommit); }
  @Get('decisions') listDecisions(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('projectId') projectId: string, @Query('current') current?: string) { return this.memory.listDecisions(workspaceId, request.user, projectId, current === 'true'); }
  @Post('decisions') proposeDecision(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.memory.proposeDecision(workspaceId, request.user, parseBody(proposeDecisionInput, body)); }
  @Post('decisions/:decisionId/resolve') resolveDecision(@Param('workspaceId') workspaceId: string, @Param('decisionId') decisionId: string, @Req() request: AuthedRequest, @Body() body: unknown) { const input = parseBody(resolutionInput, body); return this.memory.resolveDecision(workspaceId, request.user, decisionId, input.action, input.note); }
  @Post('decisions/:decisionId/supersede') supersedeDecision(@Param('workspaceId') workspaceId: string, @Param('decisionId') decisionId: string, @Req() request: AuthedRequest, @Body() body: unknown) { const input = parseBody(supersedeInput, body); return this.memory.supersedeDecision(workspaceId, request.user, decisionId, input.replacementId, input.note, input.validUntilCommit); }
}
