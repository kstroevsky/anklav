import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { type AuthUser, type AuthedRequest, SessionGuard } from './auth';
import { parseBody } from './common/http';
import { PortfolioImportService, type ImportOverrides } from './portfolio-import.service';
import { WorkspaceService } from './workspace.service';

const overrides = z.object({
  sourceRepositoryVisibility: z.enum(['accepted_public_disclosure', 'repository_private']).optional(),
  projectControlTasks: z.record(z.string(), z.object({ disposition: z.enum(['map_to_anklav', 'archive_as_source_only', 'cancel_as_superseded']), targetProjectRef: z.string().optional() })).optional(),
  milestoneClassifications: z.record(z.string(), z.enum(['anklav_flow', 'anklav_milestone', 'archive_candidate'])).optional(),
  sourceFlowDispositions: z.record(z.string(), z.enum(['retain_as_active_flow', 'archive_as_source_only'])).optional(),
  legacyLabels: z.record(z.string(), z.enum(['target_label', 'provenance_only'])).optional(),
}).optional();

function user(request: AuthedRequest): AuthUser { return request.user; }

/** REST uses a server-configured bundle root; arbitrary filesystem paths are CLI-only. */
@UseGuards(SessionGuard)
@Controller('api/v1/workspaces/:workspaceId/imports/anklav')
export class PortfolioImportController {
  constructor(private readonly imports: PortfolioImportService, private readonly workspaces: WorkspaceService) {}

  private bundleRoot(): string {
    const configured = process.env.ANKLAV_MIGRATION_BUNDLE_ROOT;
    if (!configured) throw new Error('ANKLAV_MIGRATION_BUNDLE_ROOT is not configured. Use the guarded CLI importer for local bundles.');
    return configured;
  }

  private verificationReportPath(): string {
    const root = resolve(process.env.ANKLAV_MIGRATION_VERIFICATION_DIR ?? join(process.cwd(), 'migration/anklav/verification'));
    return join(root, 'anklav-import-verification.json');
  }

  private async admin(workspaceId: string, request: AuthedRequest) { await this.workspaces.requireMembership(workspaceId, user(request), 'admin'); }

  @Get('plan')
  async plan(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('verifyChecksums') verifyChecksums?: string) {
    await this.admin(workspaceId, request);
    return this.imports.plan({ bundle: this.bundleRoot(), workspace: workspaceId, verifyChecksums: verifyChecksums !== 'false', requireSourceMappings: true });
  }

  @Post('apply')
  async apply(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    await this.admin(workspaceId, request);
    const input = parseBody(z.object({ overrides }), body);
    return this.imports.apply({ bundle: this.bundleRoot(), workspace: workspaceId, overrides: input.overrides as ImportOverrides, verifyChecksums: true, requireSourceMappings: true }, user(request));
  }

  @Post('resume')
  async resume(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    await this.admin(workspaceId, request);
    const input = parseBody(z.object({ overrides }), body);
    return this.imports.resume({ bundle: this.bundleRoot(), workspace: workspaceId, overrides: input.overrides as ImportOverrides, verifyChecksums: true, requireSourceMappings: true }, user(request));
  }

  @Post('verify')
  async verify(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    await this.admin(workspaceId, request);
    const input = parseBody(z.object({ overrides }), body);
    return this.imports.verify({ bundle: this.bundleRoot(), workspace: workspaceId, overrides: input.overrides as ImportOverrides, verifyChecksums: true, requireSourceMappings: true }, user(request), this.verificationReportPath());
  }

  @Post('rollback')
  async rollback(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    await this.admin(workspaceId, request);
    const input = parseBody(z.object({ guardedOverride: z.boolean().optional().default(false), overrides }), body);
    return this.imports.rollback({ bundle: this.bundleRoot(), workspace: workspaceId, overrides: input.overrides as ImportOverrides, verifyChecksums: true, requireSourceMappings: true }, user(request), input.guardedOverride);
  }
}
