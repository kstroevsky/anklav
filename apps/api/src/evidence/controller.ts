import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import { parseBody } from '../common/http';
import { evidenceArtifactInput } from './inputs';
import { EvidenceService } from './service';

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/evidence-artifacts')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  list(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('taskId') taskId?: string, @Query('runId') runId?: string) { return this.evidence.list(workspaceId, request.user, { taskId, runId }); }

  @Post()
  @RouteConfig({ bodyLimit: 36_000_000 })
  record(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.evidence.record(workspaceId, request.user, parseBody(evidenceArtifactInput, body)); }

  @Get(':artifactId')
  get(@Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string, @Req() request: AuthedRequest) { return this.evidence.get(workspaceId, request.user, artifactId); }

  @Get(':artifactId/content')
  async content(@Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string, @Req() request: AuthedRequest, @Res({ passthrough: true }) response: FastifyReply) {
    const { artifact, stream } = await this.evidence.download(workspaceId, request.user, artifactId);
    response.header('Content-Type', artifact.mimeType);
    response.header('Content-Length', String(artifact.byteSize));
    response.header('ETag', `"sha256:${artifact.contentHash}"`);
    response.header('Content-Disposition', `attachment; filename="${safeFilename(artifact.title)}"`);
    return new StreamableFile(stream);
  }
}

function safeFilename(title: string): string {
  const value = title.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 160);
  if (!value) throw new BadRequestException('Evidence title cannot produce a safe download filename.');
  return value;
}
