import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { parseBody } from '../common/http';
import { listRetrievalDocumentsInput, refreshRetrievalInput, retrievalSearchInput } from './inputs';
import { RetrievalService } from './service';

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/retrieval')
export class RetrievalController {
  constructor(private readonly retrieval: RetrievalService) {}

  @Get('embedding-profiles')
  listEmbeddingProfiles(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.retrieval.listEmbeddingProfiles(workspaceId, request.user); }

  @Post('search')
  @HttpCode(200)
  search(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.retrieval.search(workspaceId, request.user, parseBody(retrievalSearchInput, body)); }

  @Post('refresh')
  refresh(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.retrieval.refresh(workspaceId, request.user, parseBody(refreshRetrievalInput, body)); }

  @Get('documents')
  listDocuments(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) {
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && !Number.isSafeInteger(limit)) throw new BadRequestException('limit must be an integer.');
    return this.retrieval.listDocuments(workspaceId, request.user, parseBody(listRetrievalDocumentsInput, { projectId: query.projectId, embeddingProfileKey: query.embeddingProfileKey, missingEmbedding: query.missingEmbedding === 'true', limit }));
  }

  @Get('traces/:traceId')
  getTrace(@Param('workspaceId') workspaceId: string, @Param('traceId') traceId: string, @Req() request: AuthedRequest) { return this.retrieval.getTrace(workspaceId, request.user, traceId); }
}
