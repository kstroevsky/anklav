import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, type AuthedRequest, SessionGuard } from './auth';
import { parseBody } from './common/http';
import { PortfolioKnowledgeService } from './portfolio-knowledge.service';
import { requireVersion } from './workspace.service';

const milestoneInput = z.object({
  projectId: z.string().uuid(), flowId: z.string().uuid().nullable().optional(), name: z.string().trim().min(1).max(160), description: z.string().max(50_000).optional(),
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled', 'archived']).optional(), targetDate: z.string().date().nullable().optional(), taskIds: z.array(z.string().uuid()).max(500).optional(),
});

const artifactInput = z.object({
  projectId: z.string().uuid().nullable().optional(), flowId: z.string().uuid().nullable().optional(), taskId: z.string().uuid().nullable().optional(),
  type: z.enum(['legacy_document', 'git_reference', 'research', 'specification', 'decision', 'evaluation', 'handoff', 'project_state', 'roadmap', 'agent_instructions']),
  title: z.string().trim().min(1).max(240), summary: z.string().max(50_000).optional(), nativeContent: z.string().max(500_000).nullable().optional(),
  repositoryReference: z.object({ repositoryFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/), path: z.string().min(1).max(4_000).refine((path) => !path.split('/').includes('..'), 'Repository path may not traverse upward.'), commitSha: z.string().min(7).max(128).nullable().optional(), contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), githubRepositoryId: z.string().uuid().nullable().optional(), verificationNote: z.string().max(10_000).optional() }).nullable().optional(),
  canonicality: z.enum(['candidate', 'canonical', 'superseded', 'rejected']).optional(), verification: z.enum(['unverified', 'verified']).optional(),
});

function user(request: AuthedRequest): AuthUser { return request.user; }

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId')
export class PortfolioKnowledgeController {
  constructor(private readonly knowledge: PortfolioKnowledgeService) {}

  @Get('milestones')
  listMilestones(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: { projectId?: string; flowId?: string; status?: string }) { return this.knowledge.listMilestones(workspaceId, user(request), query); }

  @Post('milestones')
  createMilestone(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.knowledge.createMilestone(workspaceId, user(request), parseBody(milestoneInput, body)); }

  @Get('milestones/:milestoneId')
  getMilestone(@Param('workspaceId') workspaceId: string, @Param('milestoneId') milestoneId: string, @Req() request: AuthedRequest) { return this.knowledge.getMilestone(workspaceId, user(request), milestoneId); }

  @Patch('milestones/:milestoneId')
  updateMilestone(@Param('workspaceId') workspaceId: string, @Param('milestoneId') milestoneId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) { return this.knowledge.updateMilestone(workspaceId, user(request), milestoneId, requireVersion(ifMatch), parseBody(milestoneInput.partial(), body)); }

  @Delete('milestones/:milestoneId')
  deleteMilestone(@Param('workspaceId') workspaceId: string, @Param('milestoneId') milestoneId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined) { return this.knowledge.softDeleteMilestone(workspaceId, user(request), milestoneId, requireVersion(ifMatch)); }

  @Get('knowledge-artifacts')
  listArtifacts(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: { projectId?: string; flowId?: string; taskId?: string; type?: string }) { return this.knowledge.listArtifacts(workspaceId, user(request), query); }

  @Post('knowledge-artifacts')
  recordArtifact(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.knowledge.recordArtifact(workspaceId, user(request), parseBody(artifactInput, body)); }

  @Get('knowledge-artifacts/:artifactId')
  getArtifact(@Param('workspaceId') workspaceId: string, @Param('artifactId') artifactId: string, @Req() request: AuthedRequest) { return this.knowledge.getArtifact(workspaceId, user(request), artifactId); }

  @Get('tasks/:taskId/context-pack')
  contextPack(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest) { return this.knowledge.getTaskContextPack(workspaceId, user(request), taskId); }
}
