import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { parseBody } from '../common/http';
import { listEmbeddingJobsInput, listRetrievalDocumentsInput, refreshRetrievalInput, retrievalEvaluationInput, retrievalSearchInput } from './inputs';
import { RetrievalService } from './service';

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/retrieval')
export class RetrievalController {
  constructor(private readonly retrieval: RetrievalService) {}

  @Get('embedding-profiles')
  listEmbeddingProfiles(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.retrieval.listEmbeddingProfiles(workspaceId, request.user); }

  @Get('embedding-jobs')
  listEmbeddingJobs(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) {
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && !Number.isSafeInteger(limit)) throw new BadRequestException('limit must be an integer.');
    const input = parseBody(listEmbeddingJobsInput, { projectId: query.projectId, status: query.status, profileKey: query.profileKey, limit }); const offset = query.offset === undefined ? undefined : Number(query.offset);
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) throw new BadRequestException('offset must be a non-negative integer.');
    return offset === undefined ? this.retrieval.listEmbeddingJobs(workspaceId, request.user, input) : this.retrieval.listEmbeddingJobsPage(workspaceId, request.user, input, offset);
  }

  @Post('embedding-jobs/:jobId/retry')
  retryEmbeddingJob(@Param('workspaceId') workspaceId: string, @Param('jobId') jobId: string, @Req() request: AuthedRequest) { return this.retrieval.retryEmbeddingJob(workspaceId, request.user, jobId); }

  @Post('search')
  @HttpCode(200)
  search(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.retrieval.search(workspaceId, request.user, parseBody(retrievalSearchInput, body)); }

  @Post('evaluations')
  @HttpCode(200)
  evaluate(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.retrieval.evaluate(workspaceId, request.user, parseBody(retrievalEvaluationInput, body)); }

  @Post('refresh')
  refresh(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.retrieval.refresh(workspaceId, request.user, parseBody(refreshRetrievalInput, body)); }

  @Get('documents')
  listDocuments(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) {
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && !Number.isSafeInteger(limit)) throw new BadRequestException('limit must be an integer.');
    const input = parseBody(listRetrievalDocumentsInput, { projectId: query.projectId, embeddingProfileKey: query.embeddingProfileKey, missingEmbedding: query.missingEmbedding === 'true', limit }); const offset = query.offset === undefined ? undefined : Number(query.offset);
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) throw new BadRequestException('offset must be a non-negative integer.');
    return offset === undefined ? this.retrieval.listDocuments(workspaceId, request.user, input) : this.retrieval.listDocumentsPage(workspaceId, request.user, input, offset);
  }

  @Get('traces/:traceId')
  getTrace(@Param('workspaceId') workspaceId: string, @Param('traceId') traceId: string, @Req() request: AuthedRequest) { return this.retrieval.getTrace(workspaceId, request.user, traceId); }
}
