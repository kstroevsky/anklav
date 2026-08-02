import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { parseBody } from '../common/http';
import { appendRunEventInput, checkpointInput, claimLeaseInput, finishRunInput, gitSliceInput, nativeSessionInput, renewLeaseInput, startRunInput } from './inputs';
import { ExecutionService } from './service';

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId')
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  @Get('tasks/:taskId/runs')
  listTaskRuns(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest) { return this.execution.listTaskRuns(workspaceId, request.user, taskId); }

  @Get('tasks/:taskId/leases')
  listTaskLeases(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest) { return this.execution.listTaskLeases(workspaceId, request.user, taskId); }

  @Post('tasks/:taskId/runs')
  startRun(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.startRun(workspaceId, request.user, taskId, parseBody(startRunInput, body)); }

  @Get('runs/:runId')
  getRun(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest) { return this.execution.getRun(workspaceId, request.user, runId); }

  @Get('runs/:runId/events')
  listRunEvents(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Query('after') after?: string) {
    const cursor = after === undefined ? undefined : Number(after);
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new BadRequestException('after must be a non-negative event sequence.');
    return this.execution.listRunEvents(workspaceId, request.user, runId, cursor);
  }

  @Post('runs/:runId/events')
  appendEvent(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.appendEvent(workspaceId, request.user, runId, parseBody(appendRunEventInput, body)); }

  @Post('runs/:runId/git-slices')
  captureGitSlice(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.captureGitSlice(workspaceId, request.user, runId, parseBody(gitSliceInput, body)); }

  @Post('runs/:runId/native-sessions')
  attachNativeSession(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.attachNativeSession(workspaceId, request.user, runId, parseBody(nativeSessionInput, body)); }

  @Post('runs/:runId/lease')
  claimLease(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.claimLease(workspaceId, request.user, runId, parseBody(claimLeaseInput, body)); }

  @Post('leases/:leaseId/renew')
  renewLease(@Param('workspaceId') workspaceId: string, @Param('leaseId') leaseId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.renewLease(workspaceId, request.user, leaseId, parseBody(renewLeaseInput, body).ttlSeconds); }

  @Post('leases/:leaseId/release')
  releaseLease(@Param('workspaceId') workspaceId: string, @Param('leaseId') leaseId: string, @Req() request: AuthedRequest) { return this.execution.releaseLease(workspaceId, request.user, leaseId); }

  @Post('runs/:runId/checkpoints')
  createCheckpoint(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.createCheckpoint(workspaceId, request.user, runId, parseBody(checkpointInput, body)); }

  @Post('runs/:runId/finish')
  finishRun(@Param('workspaceId') workspaceId: string, @Param('runId') runId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.execution.finishRun(workspaceId, request.user, runId, parseBody(finishRunInput, body)); }
}
