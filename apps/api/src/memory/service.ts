import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, claimRelations, evidenceArtifacts, knowledgeArtifacts, memoryClaims, projectDecisions, projects, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import type { ProposeClaimInput, ProposeDecisionInput } from './inputs';

@Injectable()
export class MemoryService {
  constructor(private readonly database: DatabaseService, private readonly workspaces: WorkspaceService) {}

  async listClaims(workspaceId: string, user: AuthUser, filters: { projectId?: string; taskId?: string; current?: boolean } = {}) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(memoryClaims).where(and(eq(memoryClaims.workspaceId, workspaceId), filters.projectId ? eq(memoryClaims.projectId, filters.projectId) : undefined, filters.taskId ? eq(memoryClaims.taskId, filters.taskId) : undefined, filters.current ? eq(memoryClaims.status, 'verified') : undefined, filters.current ? isNull(memoryClaims.validUntilAt) : undefined, filters.current ? isNull(memoryClaims.validUntilCommit) : undefined)).orderBy(desc(memoryClaims.recordedAt), desc(memoryClaims.id));
  }

  async proposeClaim(workspaceId: string, user: AuthUser, input: ProposeClaimInput) {
    const scope = await this.validateScope(workspaceId, user, input);
    await this.validateSource(workspaceId, input.sourceEvidenceArtifactId, input.sourceKnowledgeArtifactId);
    const [claim] = await this.database.db.insert(memoryClaims).values({ workspaceId, ...scope, subject: input.subject, predicate: input.predicate, value: input.value as any, classification: input.classification, confidenceBasisPoints: input.confidenceBasisPoints, validFromAt: input.validFromAt ? new Date(input.validFromAt) : null, validUntilAt: input.validUntilAt ? new Date(input.validUntilAt) : null, validFromCommit: input.validFromCommit ?? null, validUntilCommit: input.validUntilCommit ?? null, sourceEvidenceArtifactId: input.sourceEvidenceArtifactId ?? null, sourceKnowledgeArtifactId: input.sourceKnowledgeArtifactId ?? null, sourceSpan: input.sourceSpan, extraction: input.extraction, proposedByUserId: user.id }).returning();
    return claim!;
  }

  async resolveClaim(workspaceId: string, user: AuthUser, claimId: string, action: 'accept' | 'reject', note: string) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const before = await this.claim(workspaceId, claimId);
    if (before.status !== 'proposed') throw new ConflictException('Only a proposed claim can be adjudicated.');
    const [claim] = await this.database.db.update(memoryClaims).set({ status: action === 'accept' ? 'verified' : 'rejected', classification: action === 'accept' && before.classification === 'hypothesis' ? 'verified_current_fact' : before.classification, resolutionNote: note, verifiedByUserId: user.id, verifiedAt: new Date(), validFromAt: action === 'accept' ? before.validFromAt ?? new Date() : before.validFromAt, updatedAt: new Date() }).where(and(eq(memoryClaims.id, claimId), eq(memoryClaims.status, 'proposed'))).returning();
    if (!claim) throw new ConflictException('Claim was adjudicated elsewhere.');
    return claim;
  }

  async supersedeClaim(workspaceId: string, user: AuthUser, claimId: string, replacementId: string, note: string, validUntilAt?: string | null, validUntilCommit?: string | null) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin');
    const before = await this.claim(workspaceId, claimId); const replacement = await this.claim(workspaceId, replacementId);
    if (before.status !== 'verified' || !['proposed', 'verified'].includes(replacement.status) || before.projectId !== replacement.projectId) throw new BadRequestException('Supersession requires a verified claim and a compatible current replacement.');
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx.update(memoryClaims).set({ status: 'superseded', supersededByClaimId: replacementId, validUntilAt: validUntilAt ? new Date(validUntilAt) : new Date(), validUntilCommit: validUntilCommit ?? null, resolutionNote: note, updatedAt: new Date() }).where(and(eq(memoryClaims.id, claimId), eq(memoryClaims.status, 'verified'))).returning();
      if (!updated) throw new ConflictException('Claim was changed elsewhere.');
      await tx.update(memoryClaims).set({ status: 'verified', verifiedByUserId: user.id, verifiedAt: new Date(), validFromAt: replacement.validFromAt ?? new Date(), updatedAt: new Date() }).where(eq(memoryClaims.id, replacementId));
      await tx.insert(claimRelations).values({ workspaceId, fromClaimId: replacementId, toClaimId: claimId, relation: 'supersedes', createdByUserId: user.id }).onConflictDoNothing();
      return updated;
    });
  }

  async listDecisions(workspaceId: string, user: AuthUser, projectId: string, current = false) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(projectDecisions).where(and(eq(projectDecisions.workspaceId, workspaceId), eq(projectDecisions.projectId, projectId), current ? eq(projectDecisions.status, 'accepted') : undefined, current ? isNull(projectDecisions.effectiveUntilCommit) : undefined)).orderBy(desc(projectDecisions.createdAt));
  }

  async proposeDecision(workspaceId: string, user: AuthUser, input: ProposeDecisionInput) {
    const scope = await this.validateScope(workspaceId, user, { projectId: input.projectId, taskId: input.taskId, runId: input.proposedByRunId });
    await this.requireEvidence(workspaceId, input.evidenceArtifactIds, scope.taskId);
    const [decision] = await this.database.db.insert(projectDecisions).values({ workspaceId, projectId: input.projectId, taskId: scope.taskId, proposedByRunId: input.proposedByRunId ?? null, question: input.question, selectedOption: input.selectedOption, rejectedAlternatives: input.rejectedAlternatives, rationale: input.rationale, consequences: input.consequences, effectiveRepository: input.effectiveRepository ?? null, effectiveFromCommit: input.effectiveFromCommit ?? null, evidenceArtifactIds: input.evidenceArtifactIds, proposedByUserId: user.id }).returning();
    return decision!;
  }

  async resolveDecision(workspaceId: string, user: AuthUser, decisionId: string, action: 'accept' | 'reject', note: string) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin'); const before = await this.decision(workspaceId, decisionId);
    if (before.status !== 'proposed') throw new ConflictException('Only a proposed decision can be adjudicated.');
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${before.projectId}::uuid FOR UPDATE`);
      if (action === 'accept') { const [active] = await tx.select({ id: projectDecisions.id }).from(projectDecisions).where(and(eq(projectDecisions.projectId, before.projectId), eq(projectDecisions.question, before.question), eq(projectDecisions.status, 'accepted'), ne(projectDecisions.id, decisionId))).limit(1); if (active) throw new ConflictException('An accepted decision already answers this question. Supersede it explicitly.'); }
      const [decision] = await tx.update(projectDecisions).set({ status: action === 'accept' ? 'accepted' : 'rejected', resolutionNote: note, decidedByUserId: user.id, decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(projectDecisions.id, decisionId), eq(projectDecisions.status, 'proposed'))).returning();
      if (!decision) throw new ConflictException('Decision was adjudicated elsewhere.'); return decision;
    });
  }

  async supersedeDecision(workspaceId: string, user: AuthUser, decisionId: string, replacementId: string, note: string, effectiveUntilCommit?: string | null) {
    await this.workspaces.requireMembership(workspaceId, user, 'admin'); const before = await this.decision(workspaceId, decisionId); const replacement = await this.decision(workspaceId, replacementId);
    if (before.status !== 'accepted' || !['proposed', 'accepted'].includes(replacement.status) || before.projectId !== replacement.projectId) throw new BadRequestException('Supersession requires an accepted decision and a compatible replacement.');
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${before.projectId}::uuid FOR UPDATE`);
      const [updated] = await tx.update(projectDecisions).set({ status: 'superseded', supersededByDecisionId: replacementId, effectiveUntilCommit: effectiveUntilCommit ?? replacement.effectiveFromCommit, resolutionNote: note, updatedAt: new Date() }).where(and(eq(projectDecisions.id, decisionId), eq(projectDecisions.status, 'accepted'))).returning();
      if (!updated) throw new ConflictException('Decision was changed elsewhere.');
      await tx.update(projectDecisions).set({ status: 'accepted', decidedByUserId: user.id, decidedAt: new Date(), resolutionNote: note, updatedAt: new Date() }).where(eq(projectDecisions.id, replacementId));
      return updated;
    });
  }

  private async validateScope(workspaceId: string, user: AuthUser, input: { projectId?: string | null; taskId?: string | null; runId?: string | null }) {
    await this.workspaces.requireMembership(workspaceId, user); let projectId = input.projectId ?? null; let taskId = input.taskId ?? null;
    if (input.runId) { const [run] = await this.database.db.select().from(agentRuns).where(and(eq(agentRuns.id, input.runId), eq(agentRuns.workspaceId, workspaceId))).limit(1); if (!run) throw new BadRequestException('Run not found in workspace.'); if (taskId && taskId !== run.taskId) throw new BadRequestException('Run and task scopes differ.'); taskId = run.taskId; }
    if (taskId) { const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1); if (!task) throw new BadRequestException('Task not found in workspace.'); if (projectId && projectId !== task.projectId) throw new BadRequestException('Task and project scopes differ.'); projectId = task.projectId; }
    if (projectId) { const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId))).limit(1); if (!project) throw new BadRequestException('Project not found in workspace.'); }
    return { projectId, taskId, runId: input.runId ?? null };
  }

  private async validateSource(workspaceId: string, evidenceId?: string | null, knowledgeId?: string | null) {
    if (evidenceId) { const [row] = await this.database.db.select().from(evidenceArtifacts).where(and(eq(evidenceArtifacts.id, evidenceId), eq(evidenceArtifacts.workspaceId, workspaceId))).limit(1); if (!row) throw new BadRequestException('Claim evidence not found in workspace.'); }
    if (knowledgeId) { const [row] = await this.database.db.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.id, knowledgeId), eq(knowledgeArtifacts.workspaceId, workspaceId))).limit(1); if (!row) throw new BadRequestException('Claim knowledge source not found in workspace.'); }
  }

  private async requireEvidence(workspaceId: string, ids: string[], taskId: string | null) { const rows = await this.database.db.select({ id: evidenceArtifacts.id, taskId: evidenceArtifacts.taskId }).from(evidenceArtifacts).where(and(eq(evidenceArtifacts.workspaceId, workspaceId), inArray(evidenceArtifacts.id, ids))); if (rows.length !== new Set(ids).size || (taskId && rows.some((row) => row.taskId && row.taskId !== taskId))) throw new BadRequestException('Decision evidence is missing or outside its task scope.'); }
  private async claim(workspaceId: string, id: string) { const [row] = await this.database.db.select().from(memoryClaims).where(and(eq(memoryClaims.id, id), eq(memoryClaims.workspaceId, workspaceId))).limit(1); if (!row) throw new NotFoundException('Claim not found.'); return row; }
  private async decision(workspaceId: string, id: string) { const [row] = await this.database.db.select().from(projectDecisions).where(and(eq(projectDecisions.id, id), eq(projectDecisions.workspaceId, workspaceId))).limit(1); if (!row) throw new NotFoundException('Decision not found.'); return row; }
}
