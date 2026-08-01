import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { GitHubService } from './service';

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/github')
export class GitHubController {
  constructor(private readonly github: GitHubService) {}
  @Get() status(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.status(workspaceId, request.user); }
  @Post('manifest') manifest(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.startManifest(workspaceId, request.user, body); }
  @Post('account') account(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.startUserOAuth(workspaceId, request.user); }
  @Post('repositories/mappings') mapping(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.mapRepository(workspaceId, request.user, body); }
  @Get('tasks/:taskRef/branch') branch(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Req() request: AuthedRequest) { return this.github.branch(workspaceId, request.user, taskRef); }
  @Post('tasks/:taskRef/issues') issue(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.createIssue(workspaceId, request.user, taskRef, body); }
  @Post('tasks/:taskRef/pull-requests/:pullRequestId') pullRequest(@Param('workspaceId') workspaceId: string, @Param('taskRef') taskRef: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: any) { return this.github.linkPullRequest(workspaceId, request.user, taskRef, pullRequestId, body?.linkKind); }
  @Get('reviews') reviews(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('mode') mode: 'for-me' | 'created' | undefined) { return this.github.listReviews(workspaceId, request.user, mode === 'created' ? 'created' : 'for-me'); }
  @Get('reviews/:pullRequestId') review(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.reviewDetail(workspaceId, request.user, pullRequestId); }
  @Get('reviews/:pullRequestId/diff') diff(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.diff(workspaceId, request.user, pullRequestId); }
  @Post('reviews/:pullRequestId/reviews') submitReview(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.submitReview(workspaceId, request.user, pullRequestId, body); }
  @Post('reviews/:pullRequestId/comments') comment(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.commentOnPullRequest(workspaceId, request.user, pullRequestId, body); }
  @Post('reviews/:pullRequestId/ready') ready(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest) { return this.github.markPullRequestReady(workspaceId, request.user, pullRequestId); }
  @Post('reviews/:pullRequestId/merge') merge(@Param('workspaceId') workspaceId: string, @Param('pullRequestId') pullRequestId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.github.merge(workspaceId, request.user, pullRequestId, body); }
  @Get('notifications') notifications(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.listNotifications(workspaceId, request.user); }
  @Get('notifications/unread-count') unreadCount(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.notificationCount(workspaceId, request.user); }
  @Patch('notifications/:notificationId/read') read(@Param('workspaceId') workspaceId: string, @Param('notificationId') notificationId: string, @Req() request: AuthedRequest) { return this.github.markNotificationRead(workspaceId, request.user, notificationId); }
  @Get('health') health(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.health(workspaceId, request.user); }
  @Post('jobs/:jobId/retry') retryJob(@Param('workspaceId') workspaceId: string, @Param('jobId') jobId: string, @Req() request: AuthedRequest) { return this.github.retryJob(workspaceId, request.user, jobId); }
  @Post('disconnect') disconnect(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.github.disconnect(workspaceId, request.user); }
}

