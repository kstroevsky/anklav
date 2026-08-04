import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { DatabaseService } from '../db/database.service';
import { agentRuns, embeddingProfiles, evidenceArtifacts, knowledgeArtifactRevisions, knowledgeArtifacts, memoryClaims, nativeSessionItems, nativeSessions, projectDecisions, projects, retrievalDocuments, retrievalEmbeddingJobs, retrievalEmbeddings, retrievalTraces, runCheckpoints, taskRelations, tasks } from '../db/schema';
import { WorkspaceService } from '../workspace.service';
import { buildContextualPrefix, buildEmbeddingText, semanticUnits } from './document';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding-provider';
import type { ListEmbeddingJobsInput, ListRetrievalDocumentsInput, RefreshRetrievalInput, RetrievalIntent, RetrievalSearchInput } from './inputs';
import { EMBEDDING_STORAGE_LANE } from './profiles';
import { classifyRetrievalIntent, hybridScore, retrievalWeights } from './ranking';

type DerivedDocument = {
  workspaceId: string; projectId: string; taskId: string | null; runId: string | null; sourceType: string; sourceId: string; sourcePart: number;
  title: string; content: string; contextualPrefix: string; searchText: string; embeddingText: string; contentHash: string; authorityBasisPoints: number;
  sensitivity: string; status: string; validFromAt: Date | null; validUntilAt: Date | null; sourceRecordedAt: Date; metadata: Record<string, unknown>;
};

type CandidateRow = typeof retrievalDocuments.$inferSelect & { lexical_score: number | string; semantic_score: number | string };

@Injectable()
export class RetrievalService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(WorkspaceService) private readonly workspaces: WorkspaceService, @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider) {}

  async listEmbeddingProfiles(workspaceId: string, user: AuthUser) {
    await this.workspaces.requireMembership(workspaceId, user);
    return this.database.db.select().from(embeddingProfiles).where(eq(embeddingProfiles.active, true)).orderBy(asc(embeddingProfiles.key));
  }

  async listEmbeddingJobs(workspaceId: string, user: AuthUser, input: ListEmbeddingJobsInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.requireProject(workspaceId, input.projectId);
    return this.database.db.select().from(retrievalEmbeddingJobs).where(and(eq(retrievalEmbeddingJobs.workspaceId, workspaceId), eq(retrievalEmbeddingJobs.projectId, input.projectId), input.status ? eq(retrievalEmbeddingJobs.status, input.status) : undefined)).orderBy(asc(retrievalEmbeddingJobs.status), asc(retrievalEmbeddingJobs.runAfter)).limit(input.limit);
  }

  async refresh(workspaceId: string, user: AuthUser, input: RefreshRetrievalInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    const project = await this.requireProject(workspaceId, input.projectId);
    const [taskRows, claimRows, decisionRows, checkpointRows, runRows, artifactRows, evidenceRows, sessionRows] = await Promise.all([
      this.database.db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, project.id), isNull(tasks.deletedAt))).orderBy(asc(tasks.identifier)),
      this.database.db.select().from(memoryClaims).where(and(eq(memoryClaims.workspaceId, workspaceId), eq(memoryClaims.projectId, project.id), inArray(memoryClaims.status, ['verified', 'superseded']))),
      this.database.db.select().from(projectDecisions).where(and(eq(projectDecisions.workspaceId, workspaceId), eq(projectDecisions.projectId, project.id), inArray(projectDecisions.status, ['accepted', 'superseded']))),
      this.database.db.select({ checkpoint: runCheckpoints, task: tasks }).from(runCheckpoints).innerJoin(tasks, eq(runCheckpoints.taskId, tasks.id)).where(and(eq(runCheckpoints.workspaceId, workspaceId), eq(tasks.projectId, project.id))),
      this.database.db.select({ run: agentRuns, task: tasks }).from(agentRuns).innerJoin(tasks, eq(agentRuns.taskId, tasks.id)).where(and(eq(agentRuns.workspaceId, workspaceId), eq(tasks.projectId, project.id), inArray(agentRuns.status, ['completed', 'failed', 'blocked', 'cancelled']), sql`length(${agentRuns.outcomeSummary}) > 0`)),
      this.database.db.select({ artifact: knowledgeArtifacts, revision: knowledgeArtifactRevisions }).from(knowledgeArtifacts).leftJoin(knowledgeArtifactRevisions, eq(knowledgeArtifacts.currentRevisionId, knowledgeArtifactRevisions.id)).where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), eq(knowledgeArtifacts.projectId, project.id), eq(knowledgeArtifacts.canonicality, 'canonical'), eq(knowledgeArtifacts.verification, 'verified'), isNull(knowledgeArtifacts.deletedAt))),
      this.database.db.select({ evidence: evidenceArtifacts, task: tasks }).from(evidenceArtifacts).innerJoin(tasks, eq(evidenceArtifacts.taskId, tasks.id)).where(and(eq(evidenceArtifacts.workspaceId, workspaceId), eq(tasks.projectId, project.id), eq(evidenceArtifacts.redactionStatus, 'redacted'), sql`length(${evidenceArtifacts.preview}) > 0`)),
      this.database.db.select({ item: nativeSessionItems, session: nativeSessions, run: agentRuns, task: tasks }).from(nativeSessionItems).innerJoin(nativeSessions, eq(nativeSessionItems.nativeSessionId, nativeSessions.id)).innerJoin(agentRuns, eq(nativeSessions.runId, agentRuns.id)).innerJoin(tasks, eq(agentRuns.taskId, tasks.id)).where(and(eq(nativeSessionItems.workspaceId, workspaceId), eq(tasks.projectId, project.id), inArray(nativeSessionItems.redactionStatus, ['safe', 'redacted']))),
    ]);
    const taskMap = new Map(taskRows.map((task) => [task.id, task]));
    const latestCheckpointByRun = new Map<string, number>();
    for (const { checkpoint } of checkpointRows) latestCheckpointByRun.set(checkpoint.runId, Math.max(latestCheckpointByRun.get(checkpoint.runId) ?? 0, checkpoint.sequence));
    const documents: DerivedDocument[] = [];
    const add = (values: Omit<DerivedDocument, 'workspaceId' | 'projectId' | 'sourcePart' | 'contextualPrefix' | 'searchText' | 'embeddingText' | 'contentHash' | 'sensitivity'>) => {
      const task = values.taskId ? taskMap.get(values.taskId) : null;
      const sensitivity = values.taskId ? 'task' : 'project';
      const parts = semanticUnits(values.content);
      for (const [sourcePart, content] of parts.entries()) {
        const metadata = { repositoryReference: project.repositoryReference, ...values.metadata, semanticUnit: { part: sourcePart, count: parts.length } };
        const contextualPrefix = buildContextualPrefix({ project: project.name, task: task?.identifier, sourceType: values.sourceType, sourceId: values.sourceId, sourcePart, status: values.status, recordedAt: values.sourceRecordedAt, validFromAt: values.validFromAt, validUntilAt: values.validUntilAt, authorityBasisPoints: values.authorityBasisPoints, sensitivity, metadata });
        const searchText = `${contextualPrefix}\n${values.title}\n${content}`;
        const embeddingText = buildEmbeddingText(contextualPrefix, values.title, content);
        documents.push({ ...values, content, metadata, workspaceId, projectId: project.id, sourcePart, contextualPrefix, searchText, embeddingText, contentHash: sha256(embeddingText), sensitivity });
      }
    };

    add({ taskId: null, runId: null, sourceType: 'project', sourceId: project.id, title: project.name, content: text([project.description, project.currentFocus, project.currentStateSummary, project.repositoryReference]), authorityBasisPoints: 9_500, status: 'current', validFromAt: project.createdAt, validUntilAt: null, sourceRecordedAt: project.updatedAt, metadata: { issueKey: project.issueKey } });
    for (const task of taskRows) add({ taskId: task.id, runId: null, sourceType: 'task', sourceId: task.id, title: `${task.identifier}: ${task.title}`, content: text([task.description, task.objective, task.constraints, task.nonGoals, task.verificationRequirements, task.verificationPerformed, task.completionEvidence, task.remainingLimitations, task.followUpWork]), authorityBasisPoints: 9_000, status: 'current', validFromAt: task.startedAt ?? task.createdAt, validUntilAt: task.completedAt ?? task.cancelledAt, sourceRecordedAt: task.updatedAt, metadata: { identifier: task.identifier, riskLevel: task.riskLevel, targetBranch: task.targetBranch } });
    for (const claim of claimRows) add({ taskId: claim.taskId, runId: claim.runId, sourceType: 'claim', sourceId: claim.id, title: `${claim.subject} ${claim.predicate}`, content: text([JSON.stringify(claim.value), claim.resolutionNote]), authorityBasisPoints: Math.min(9_500, 6_000 + Math.round(claim.confidenceBasisPoints * 0.35)), status: claim.status === 'verified' && !claim.validUntilAt && !claim.validUntilCommit ? 'current' : 'historical', validFromAt: claim.validFromAt, validUntilAt: claim.validUntilAt, sourceRecordedAt: claim.recordedAt, metadata: { classification: claim.classification, validFromCommit: claim.validFromCommit, validUntilCommit: claim.validUntilCommit, sourceEvidenceArtifactId: claim.sourceEvidenceArtifactId, sourceKnowledgeArtifactId: claim.sourceKnowledgeArtifactId } });
    for (const decision of decisionRows) add({ taskId: decision.taskId, runId: decision.proposedByRunId, sourceType: 'decision', sourceId: decision.id, title: decision.question, content: text([decision.selectedOption, decision.rationale, decision.rejectedAlternatives, decision.consequences, decision.resolutionNote]), authorityBasisPoints: 9_500, status: decision.status === 'accepted' && !decision.effectiveUntilCommit ? 'current' : 'historical', validFromAt: decision.decidedAt, validUntilAt: null, sourceRecordedAt: decision.updatedAt, metadata: { effectiveRepository: decision.effectiveRepository, effectiveFromCommit: decision.effectiveFromCommit, effectiveUntilCommit: decision.effectiveUntilCommit, evidenceArtifactIds: decision.evidenceArtifactIds } });
    for (const { checkpoint, task } of checkpointRows) add({ taskId: task.id, runId: checkpoint.runId, sourceType: 'checkpoint', sourceId: checkpoint.id, title: `${task.identifier} checkpoint ${checkpoint.sequence}`, content: text([checkpoint.objective, checkpoint.summary, checkpoint.completedWork, checkpoint.remainingWork, checkpoint.failures.map((failure) => JSON.stringify(failure)), checkpoint.nextAction, checkpoint.assumptions.map((assumption) => JSON.stringify(assumption))]), authorityBasisPoints: 8_500, status: latestCheckpointByRun.get(checkpoint.runId) === checkpoint.sequence ? 'current' : 'historical', validFromAt: checkpoint.createdAt, validUntilAt: null, sourceRecordedAt: checkpoint.createdAt, metadata: { sequence: checkpoint.sequence, evidenceArtifactIds: checkpoint.evidenceArtifactIds, artifactIds: checkpoint.artifactIds } });
    for (const { run, task } of runRows) add({ taskId: task.id, runId: run.id, sourceType: 'run_episode', sourceId: run.id, title: `${task.identifier} ${run.provider} run`, content: run.outcomeSummary, authorityBasisPoints: 7_000, status: 'current', validFromAt: run.startedAt, validUntilAt: run.endedAt, sourceRecordedAt: run.endedAt ?? run.startedAt, metadata: { provider: run.provider, client: run.client, model: run.model, status: run.status } });
    for (const { artifact, revision } of artifactRows) add({ taskId: artifact.taskId, runId: null, sourceType: 'knowledge_artifact', sourceId: artifact.id, title: artifact.title, content: text([artifact.summary, revision?.nativeContent ?? '']), authorityBasisPoints: 9_000, status: 'current', validFromAt: artifact.createdAt, validUntilAt: null, sourceRecordedAt: artifact.updatedAt, metadata: { artifactType: artifact.type, contentHash: revision?.contentHash ?? null } });
    for (const { evidence, task } of evidenceRows) add({ taskId: task.id, runId: evidence.runId, sourceType: 'evidence_preview', sourceId: evidence.id, title: evidence.title, content: evidence.preview, authorityBasisPoints: 8_000, status: 'current', validFromAt: evidence.createdAt, validUntilAt: null, sourceRecordedAt: evidence.createdAt, metadata: { evidenceType: evidence.type, blobHash: evidence.blobHash, producer: evidence.producer } });
    for (const { item, session, run, task } of sessionRows) add({ taskId: task.id, runId: run.id, sourceType: 'session_episode', sourceId: item.id, title: item.summary || `${session.provider} ${item.type}`, content: text([item.summary, JSON.stringify(item.redactedContent)]), authorityBasisPoints: 4_500, status: 'current', validFromAt: item.occurredAt, validUntilAt: null, sourceRecordedAt: item.createdAt, metadata: { provider: session.provider, nativeSessionId: session.nativeSessionId, itemType: item.type, contentHash: item.contentHash, redactionStatus: item.redactionStatus } });

    return this.database.db.transaction(async (tx) => {
      const storedIds: string[] = [];
      const activeProfiles = await tx.select({ key: embeddingProfiles.key }).from(embeddingProfiles).where(eq(embeddingProfiles.active, true));
      let queuedEmbeddingJobs = 0;
      for (const document of documents) {
        const [stored] = await tx.insert(retrievalDocuments).values(document).onConflictDoUpdate({ target: [retrievalDocuments.workspaceId, retrievalDocuments.sourceType, retrievalDocuments.sourceId, retrievalDocuments.sourcePart], set: { projectId: document.projectId, taskId: document.taskId, runId: document.runId, title: document.title, content: document.content, contextualPrefix: document.contextualPrefix, searchText: document.searchText, embeddingText: document.embeddingText, contentHash: document.contentHash, authorityBasisPoints: document.authorityBasisPoints, sensitivity: document.sensitivity, status: document.status, validFromAt: document.validFromAt, validUntilAt: document.validUntilAt, sourceRecordedAt: document.sourceRecordedAt, metadata: document.metadata, indexedAt: new Date(), updatedAt: new Date() } }).returning({ id: retrievalDocuments.id });
        storedIds.push(stored!.id);
        for (const profile of activeProfiles) {
          const inserted = await tx.insert(retrievalEmbeddingJobs).values({ workspaceId, projectId: project.id, documentId: stored!.id, profileKey: profile.key, contentHash: document.contentHash }).onConflictDoNothing().returning({ id: retrievalEmbeddingJobs.id });
          queuedEmbeddingJobs += inserted.length;
        }
      }
      const existing = await tx.select({ id: retrievalDocuments.id }).from(retrievalDocuments).where(and(eq(retrievalDocuments.workspaceId, workspaceId), eq(retrievalDocuments.projectId, project.id)));
      const staleIds = existing.map((entry) => entry.id).filter((id) => !storedIds.includes(id));
      if (staleIds.length) {
        await tx.delete(retrievalEmbeddings).where(inArray(retrievalEmbeddings.documentId, staleIds));
        await tx.delete(retrievalDocuments).where(inArray(retrievalDocuments.id, staleIds));
      }
      return { projectId: project.id, indexedDocuments: documents.length, queuedEmbeddingJobs, removedDocuments: staleIds.length, sourceCounts: countBy(documents, (document) => document.sourceType) };
    });
  }

  async listDocuments(workspaceId: string, user: AuthUser, input: ListRetrievalDocumentsInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.requireProject(workspaceId, input.projectId);
    const profile = await this.requireEmbeddingProfile(input.embeddingProfileKey);
    const rows = await this.database.db.select({ document: retrievalDocuments, embeddingDocumentId: retrievalEmbeddings.documentId }).from(retrievalDocuments).leftJoin(retrievalEmbeddings, and(eq(retrievalEmbeddings.documentId, retrievalDocuments.id), eq(retrievalEmbeddings.profileKey, profile.key), eq(retrievalEmbeddings.contentHash, retrievalDocuments.contentHash))).where(and(eq(retrievalDocuments.workspaceId, workspaceId), eq(retrievalDocuments.projectId, input.projectId), input.missingEmbedding ? isNull(retrievalEmbeddings.documentId) : undefined)).orderBy(asc(retrievalDocuments.sourceType), asc(retrievalDocuments.sourceId), asc(retrievalDocuments.sourcePart)).limit(input.limit);
    return rows.map(({ document, embeddingDocumentId }) => ({ ...document, embeddingPresent: Boolean(embeddingDocumentId), embeddingProfile: profile, embeddingText: `${profile.documentPrefix}${document.embeddingText}` }));
  }

  async search(workspaceId: string, user: AuthUser, input: RetrievalSearchInput) {
    await this.workspaces.requireMembership(workspaceId, user);
    await this.requireProject(workspaceId, input.projectId);
    if (input.taskId) await this.requireTask(workspaceId, input.projectId, input.taskId);
    const intent = input.intent ?? classifyRetrievalIntent(input.query);
    const relatedTaskIds = input.taskId && input.expandRelatedTasks ? await this.relatedTasks(workspaceId, input.projectId, input.taskId) : [];
    const allowedTaskIds = input.taskId ? [input.taskId, ...relatedTaskIds] : [];
    const profile = input.embeddingProfileKey ? await this.requireEmbeddingProfile(input.embeddingProfileKey) : null;
    let queryEmbedding: number[] | null = null;
    if (profile) {
      if (!this.embeddingProvider.configured()) throw new ServiceUnavailableException('Semantic retrieval is unavailable because the embedding provider is not configured.');
      try {
        const [generated] = await this.embeddingProvider.embed(profile, 'query', [input.query]);
        if (!generated) throw new Error('Embedding provider returned no query vector.');
        queryEmbedding = generated;
      }
      catch (error) { throw new ServiceUnavailableException(error instanceof Error ? error.message : 'Embedding provider failed.'); }
    }
    const vectorLiteral = queryEmbedding ? `[${queryEmbedding.join(',')}]` : null;
    const searchVector = sql`to_tsvector('simple', d.search_text)`;
    const textQuery = sql`websearch_to_tsquery('simple', ${input.query})`;
    const lexical = sql`ts_rank_cd(${searchVector}, ${textQuery})`;
    const sourceFilter = input.sourceTypes.length ? sql`AND d.source_type IN (${sql.join(input.sourceTypes.map((sourceType) => sql`${sourceType}`), sql`, `)})` : sql``;
    const taskFilter = input.taskId ? sql`AND (d.task_id IS NULL OR d.task_id IN (${sql.join(allowedTaskIds.map((taskId) => sql`${taskId}::uuid`), sql`, `)}))` : sql``;
    const temporalFilter = input.includeHistorical || intent === 'historical_explanation' ? sql`` : sql`AND d.status = 'current' AND (d.valid_from_at IS NULL OR d.valid_from_at <= now()) AND (d.valid_until_at IS NULL OR d.valid_until_at > now())`;
    const semanticCandidates = profile && vectorLiteral ? sql`
      SELECT e.document_id AS id, greatest(0, 1 - (e.embedding <=> ${vectorLiteral}::vector)) AS semantic_score
      FROM retrieval_embeddings e
      INNER JOIN retrieval_documents d ON d.id = e.document_id AND e.content_hash = d.content_hash
      WHERE e.profile_key = ${profile.key}
        AND d.workspace_id = ${workspaceId}::uuid AND d.project_id = ${input.projectId}::uuid
        ${taskFilter} ${sourceFilter} ${temporalFilter}
      ORDER BY e.embedding <=> ${vectorLiteral}::vector
      LIMIT 250
    ` : sql`SELECT NULL::uuid AS id, 0::double precision AS semantic_score WHERE false`;
    const candidates = await this.database.db.execute(sql`
      WITH lexical_candidates AS MATERIALIZED (
        SELECT d.id, ${lexical} AS lexical_score
        FROM retrieval_documents d
        WHERE d.workspace_id = ${workspaceId}::uuid AND d.project_id = ${input.projectId}::uuid
          ${taskFilter} ${sourceFilter} ${temporalFilter}
          AND ${searchVector} @@ ${textQuery}
        ORDER BY lexical_score DESC
        LIMIT 250
      ), semantic_candidates AS MATERIALIZED (
        ${semanticCandidates}
      ), candidate_ids AS (
        SELECT id FROM lexical_candidates
        UNION
        SELECT id FROM semantic_candidates
      )
      SELECT d.id, d.workspace_id AS "workspaceId", d.project_id AS "projectId", d.task_id AS "taskId", d.run_id AS "runId",
        d.source_type AS "sourceType", d.source_id AS "sourceId", d.source_part AS "sourcePart", d.title, d.content, d.contextual_prefix AS "contextualPrefix",
        d.search_text AS "searchText", d.embedding_text AS "embeddingText", d.content_hash AS "contentHash", d.authority_basis_points AS "authorityBasisPoints",
        d.sensitivity, d.status, d.valid_from_at AS "validFromAt", d.valid_until_at AS "validUntilAt",
        d.source_recorded_at AS "sourceRecordedAt", d.metadata, d.indexed_at AS "indexedAt", d.created_at AS "createdAt", d.updated_at AS "updatedAt",
        coalesce(l.lexical_score, 0::double precision) AS lexical_score,
        coalesce(s.semantic_score, 0::double precision) AS semantic_score
      FROM candidate_ids c
      INNER JOIN retrieval_documents d ON d.id = c.id
      LEFT JOIN lexical_candidates l ON l.id = d.id
      LEFT JOIN semantic_candidates s ON s.id = d.id
    `);
    const now = Date.now();
    const ranked = (candidates.rows as unknown as CandidateRow[]).map((row) => {
      const normalized = { ...row, validFromAt: row.validFromAt ? new Date(row.validFromAt) : null, validUntilAt: row.validUntilAt ? new Date(row.validUntilAt) : null, sourceRecordedAt: new Date(row.sourceRecordedAt), indexedAt: new Date(row.indexedAt), createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
      const lexicalScore = Number(row.lexical_score);
      const semanticScore = Number(row.semantic_score);
      const lexicalNormalized = lexicalScore / (lexicalScore + 0.1);
      const affinity = !input.taskId ? 0.6 : row.taskId === input.taskId ? 1 : row.taskId && relatedTaskIds.includes(row.taskId) ? 0.7 : 0.4;
      const ageDays = Math.max(0, (now - new Date(row.sourceRecordedAt).getTime()) / 86_400_000);
      const recency = Math.exp(-ageDays / 180);
      const score = hybridScore({ intent, lexical: lexicalNormalized, semantic: semanticScore, authority: row.authorityBasisPoints / 10_000, affinity, recency });
      return { document: stripSearchText(normalized), score, scores: { lexical: lexicalNormalized, semantic: semanticScore, authority: row.authorityBasisPoints / 10_000, affinity, recency } };
    }).sort((left, right) => right.score - left.score || right.document.sourceRecordedAt.getTime() - left.document.sourceRecordedAt.getTime()).slice(0, input.limit);
    const [trace] = await this.database.db.insert(retrievalTraces).values({ workspaceId, projectId: input.projectId, taskId: input.taskId ?? null, queryHash: sha256(input.query), intent, embeddingProfileKey: profile?.key ?? null, filters: { projectId: input.projectId, taskId: input.taskId ?? null, sourceTypes: input.sourceTypes, includeHistorical: input.includeHistorical, expandedRelatedTaskIds: relatedTaskIds }, candidateCounts: { hybrid: candidates.rows.length, lexical: (candidates.rows as any[]).filter((entry) => Number(entry.lexical_score) > 0).length, semantic: (candidates.rows as any[]).filter((entry) => Number(entry.semantic_score) > 0).length }, scoring: { weights: retrievalWeights(intent), lexicalCandidateLimit: 250, semanticCandidateLimit: 250, embeddingProfile: profile ? { key: profile.key, model: profile.model, modelRevision: profile.modelRevision, dimensions: profile.dimensions, distanceMetric: profile.distanceMetric } : null }, resultRefs: ranked.map((entry) => ({ documentId: entry.document.id, sourceType: entry.document.sourceType, sourceId: entry.document.sourceId, sourcePart: entry.document.sourcePart, score: entry.score })), semanticUsed: Boolean(profile && queryEmbedding), requestedByUserId: user.id }).returning();
    return { intent, results: ranked, trace: { id: trace!.id, queryHash: trace!.queryHash, filters: trace!.filters, candidateCounts: trace!.candidateCounts, scoring: trace!.scoring, semanticUsed: trace!.semanticUsed, createdAt: trace!.createdAt } };
  }

  async getTrace(workspaceId: string, user: AuthUser, traceId: string) {
    await this.workspaces.requireMembership(workspaceId, user);
    const [trace] = await this.database.db.select().from(retrievalTraces).where(and(eq(retrievalTraces.id, traceId), eq(retrievalTraces.workspaceId, workspaceId))).limit(1);
    if (!trace) throw new NotFoundException('Retrieval trace not found.');
    return trace;
  }

  private async requireProject(workspaceId: string, projectId: string) {
    const [project] = await this.database.db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  private async requireEmbeddingProfile(key: string) {
    const [profile] = await this.database.db.select().from(embeddingProfiles).where(and(eq(embeddingProfiles.key, key), eq(embeddingProfiles.active, true))).limit(1);
    if (!profile) throw new BadRequestException('The selected embedding profile does not exist or is inactive.');
    if (profile.storageLane !== EMBEDDING_STORAGE_LANE) throw new BadRequestException(`Embedding profile ${profile.key} uses unsupported storage lane ${profile.storageLane}.`);
    if (profile.distanceMetric !== 'cosine') throw new BadRequestException(`Embedding profile ${profile.key} uses unsupported distance metric ${profile.distanceMetric}.`);
    return profile;
  }

  private async requireTask(workspaceId: string, projectId: string, taskId: string) {
    const [task] = await this.database.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1);
    if (!task) throw new BadRequestException('The retrieval task must belong to the selected project.');
    return task;
  }

  private async relatedTasks(workspaceId: string, projectId: string, taskId: string) {
    const rows = await this.database.db.select({ sourceTaskId: taskRelations.sourceTaskId, targetTaskId: taskRelations.targetTaskId }).from(taskRelations).where(and(eq(taskRelations.workspaceId, workspaceId), or(eq(taskRelations.sourceTaskId, taskId), eq(taskRelations.targetTaskId, taskId)))).limit(100);
    const candidateIds = [...new Set(rows.flatMap((row) => [row.sourceTaskId, row.targetTaskId]).filter((id) => id !== taskId))];
    if (!candidateIds.length) return [];
    const related = await this.database.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId), inArray(tasks.id, candidateIds), isNull(tasks.deletedAt)));
    return related.map((task) => task.id);
  }
}

function text(values: unknown[]): string { return values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => typeof value === 'string' ? value.trim() : value == null ? '' : JSON.stringify(value)).filter(Boolean).join('\n'); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function countBy<T>(values: T[], key: (value: T) => string) { return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [key(value)]: (counts[key(value)] ?? 0) + 1 }), {}); }
function stripSearchText(row: CandidateRow) { const { searchText: _searchText, lexical_score: _lexical, semantic_score: _semantic, ...document } = row; return document; }
