import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { ActivityService } from '../activity.service';
import { slugify } from '../common/ids';
import { DatabaseService } from '../db/database.service';
import {
  checklistItems, externalObjectMappings, externalSources, flows, githubConnections, githubProjectRepositories, githubRepositories, importBatches, importConflicts, importCreatedObjects, importVerificationAttempts, importVerifications,
  knowledgeArtifactRevisions, knowledgeArtifacts, labels, labelAssignments, milestoneTasks, milestones, projectTaskCounters, projects, repositoryArtifactReferences,
  taskFlows, taskIdentifierAliases, tasks, workflowStates, workspaces,
} from '../db/schema';
import { assertVerificationOutputOutsideBundle, loadMigrationBundle, type BundleRecord, type MigrationBundle } from '../migration-bundle';
import { PortfolioKnowledgeService } from '../portfolio-knowledge.service';
import { asDate, asDateOnly, checklist, digest, isProjectControlTask, normalized, section, source, sourceKeyFor, type ImportContext, type ImportOverrides, type ImportOutcome, type ImportRequest, type ResolvedTarget } from './types';
import { importPreflight } from './preflight';

import { PortfolioImportApplyService } from './apply.service';

export abstract class PortfolioImportTargetService extends PortfolioImportApplyService {
  protected override async resolveTarget(tx: any, context: ImportContext, mapping: BundleRecord, record?: BundleRecord): Promise<ResolvedTarget> {
    const kind = String(mapping.sourceKind);
    if (kind === 'workspace' || kind === 'team') return { status: 'matched', targetType: 'workspace', targetId: context.workspaceId };
    if (kind === 'initiative') return { status: 'skipped', targetType: 'portfolio_provenance' };
    if (!record) return { status: 'deferred', targetType: String(mapping.targetType) };
    if (kind === 'workflow_state') return this.importWorkflow(tx, context, record);
    if (kind === 'label') return this.importLabel(tx, context, record);
    if (kind === 'project') return this.importProject(tx, context, record);
    if (kind === 'milestone') return this.importMilestoneOrFlow(tx, context, record);
    if (kind === 'issue') return this.importTask(tx, context, record);
    if (kind === 'document') return this.importDocument(tx, context, record);
    return { status: 'deferred', targetType: String(mapping.targetType) };
  }

  private async importWorkflow(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    if (record.importDisposition !== 'target_workflow') return { status: 'skipped', targetType: 'workflow_state_provenance' };
    const semantic = String(record.semantic);
    const [matched] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.taskSemantic, semantic as any), isNull(workflowStates.archivedAt))).orderBy(asc(workflowStates.position)).limit(1);
    if (matched) return { status: 'matched', targetType: 'workflow_state', targetId: matched.id, version: matched.version };
    const detail = source(record) ?? {};
    const [created] = await tx.insert(workflowStates).values({ workspaceId: context.workspaceId, entityType: 'task', name: String(detail.name), color: typeof detail.color === 'string' ? detail.color : '#64748b', taskSemantic: semantic as any, position: Number(detail.position) || 1000, isInitial: semantic === 'inbox' }).returning();
    return { status: 'created', targetType: 'workflow_state', targetId: created!.id, created: true, version: created!.version };
  }

  private async importLabel(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const detail = source(record) ?? {};
    if (record.importDisposition !== 'target_label' && context.overrides.legacyLabels?.[String(record.ref)] !== 'target_label') return { status: 'skipped', targetType: 'label_provenance' };
    const name = String(detail.name);
    const [matched] = await tx.select().from(labels).where(and(eq(labels.workspaceId, context.workspaceId), sql`LOWER(${labels.name}) = ${normalized(name)}`, isNull(labels.deletedAt))).limit(1);
    if (matched) return { status: 'matched', targetType: 'label', targetId: matched.id, version: matched.version };
    const [deleted] = await tx.select().from(labels).where(and(eq(labels.workspaceId, context.workspaceId), sql`LOWER(${labels.name}) = ${normalized(name)}`)).orderBy(desc(labels.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(labels).set({ deletedAt: null, deletedByUserId: null, version: sql`${labels.version} + 1`, updatedAt: new Date() }).where(eq(labels.id, deleted.id)).returning();
      return { status: 'created', targetType: 'label', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [created] = await tx.insert(labels).values({ workspaceId: context.workspaceId, name, color: typeof detail.color === 'string' ? detail.color : '#64748b', description: typeof detail.description === 'string' ? detail.description : '' }).returning();
    return { status: 'created', targetType: 'label', targetId: created!.id, created: true, version: created!.version };
  }

  private async importProject(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    if (record.migrationRole !== 'product' || record.createActiveTargetProject !== true) return { status: 'skipped', targetType: 'source_system_project' };
    const repository = (record.repository as BundleRecord | undefined)?.fullName;
    const [matched] = await tx.select().from(projects).where(and(eq(projects.workspaceId, context.workspaceId), isNull(projects.deletedAt), or(sql`LOWER(${projects.name}) = ${normalized(String(record.name))}`, typeof repository === 'string' ? sql`LOWER(${projects.repositoryReference}) = ${normalized(repository)}` : undefined))).limit(1);
    if (matched) { await this.linkConfiguredRepository(tx, context.workspaceId, matched.id, repository); return { status: 'matched', targetType: 'project', targetId: matched.id, version: matched.version }; }
    const [deleted] = await tx.select().from(projects).where(and(eq(projects.workspaceId, context.workspaceId), or(sql`LOWER(${projects.name}) = ${normalized(String(record.name))}`, typeof repository === 'string' ? sql`LOWER(${projects.repositoryReference}) = ${normalized(repository)}` : undefined))).orderBy(desc(projects.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(projects).set({ deletedAt: null, deletedByUserId: null, version: sql`${projects.version} + 1`, updatedAt: new Date() }).where(eq(projects.id, deleted.id)).returning();
      await this.linkConfiguredRepository(tx, context.workspaceId, restored!.id, repository);
      return { status: 'created', targetType: 'project', targetId: restored!.id, created: true, version: restored!.version };
    }
    const base = slugify(String(record.name)).replaceAll('-', '').toUpperCase().slice(0, 8) || 'PROJ';
    const [created] = await tx.insert(projects).values({ workspaceId: context.workspaceId, name: String(record.name), issueKey: base, status: 'active', repositoryReference: typeof repository === 'string' ? repository : '', currentStateSummary: typeof (record.context as BundleRecord | undefined)?.state === 'string' ? `Git-backed state: ${(record.context as BundleRecord).state}` : '' }).returning();
    await this.linkConfiguredRepository(tx, context.workspaceId, created!.id, repository);
    return { status: 'created', targetType: 'project', targetId: created!.id, created: true, version: created!.version };
  }

  private async importMilestoneOrFlow(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const detail = source(record) ?? {};
    const classification = context.bundle.records['milestone-classifications.ndjson']!.find((entry) => entry.sourceLinearId === detail.id);
    const desired = classification?.reviewRequired ? context.overrides.milestoneClassifications?.[String(detail.id)] : record.proposedTarget;
    if (!desired || desired === 'archive_candidate') return { status: 'skipped', targetType: 'milestone_provenance' };
    if (desired === 'anklav_flow') {
      const isSourceSystemFlow = record.projectRef === 'project:project-control';
      const linkedTasks = context.bundle.records['tasks.ndjson']!.filter((task) => (task.milestone as BundleRecord | null)?.sourceId === detail.id);
      const hasMappedTask = linkedTasks.some((task) => context.overrides.projectControlTasks?.[String(task.ref)]?.disposition === 'map_to_anklav');
      const explicitlyRetained = context.overrides.sourceFlowDispositions?.[String(detail.id)] === 'retain_as_active_flow';
      if (isSourceSystemFlow && !hasMappedTask && !explicitlyRetained) return { status: 'skipped', targetType: 'flow_provenance' };
      const [existing] = await tx.select().from(flows).where(and(eq(flows.workspaceId, context.workspaceId), sql`LOWER(${flows.name}) = ${normalized(String(detail.name))}`, isNull(flows.deletedAt))).limit(1);
      if (existing) return { status: 'matched', targetType: 'flow', targetId: existing.id, version: existing.version };
      const [state] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'flow'), eq(workflowStates.flowSemantic, 'active'), isNull(workflowStates.archivedAt))).limit(1);
      if (!state) return { status: 'deferred', targetType: 'flow' };
      const [created] = await tx.insert(flows).values({ workspaceId: context.workspaceId, name: String(detail.name), purpose: String(detail.description ?? classification?.rationale ?? ''), workflowStateId: state.id, priority: 'none', health: 'unknown', scope: 'all_projects' }).returning();
      return { status: 'created', targetType: 'flow', targetId: created!.id, created: true, version: created!.version };
    }
    const project = await this.projectForMilestone(context, record);
    if (!project) return { status: 'deferred', targetType: 'milestone' };
    const [existing] = await tx.select().from(milestones).where(and(eq(milestones.projectId, project), eq(milestones.name, String(detail.name)), isNull(milestones.deletedAt))).limit(1);
    if (existing) return { status: 'matched', targetType: 'milestone', targetId: existing.id, version: existing.version };
    const [deleted] = await tx.select().from(milestones).where(and(eq(milestones.projectId, project), eq(milestones.name, String(detail.name)))).orderBy(desc(milestones.updatedAt)).limit(1);
    if (deleted?.deletedAt) {
      const [restored] = await tx.update(milestones).set({ deletedAt: null, deletedByUserId: null, version: sql`${milestones.version} + 1`, updatedAt: new Date() }).where(eq(milestones.id, deleted.id)).returning();
      return { status: 'created', targetType: 'milestone', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [created] = await tx.insert(milestones).values({ workspaceId: context.workspaceId, projectId: project, name: String(detail.name), description: String(detail.description ?? classification?.rationale ?? ''), targetDate: typeof detail.targetDate === 'string' ? detail.targetDate : null }).returning();
    return { status: 'created', targetType: 'milestone', targetId: created!.id, created: true, version: created!.version };
  }

  private async projectForMilestone(context: ImportContext, record: BundleRecord): Promise<string | undefined> {
    const projectRef = record.projectRef;
    const mapped = typeof projectRef === 'string' ? context.targets.get(projectRef) : undefined;
    if (mapped?.targetId) return mapped.targetId;
    if (projectRef === 'project:project-control') {
      const linkedTasks = context.bundle.records['tasks.ndjson']!.filter((task) => (task.milestone as BundleRecord | null)?.sourceId === (source(record) ?? {}).id);
      return linkedTasks.some((task) => context.overrides.projectControlTasks?.[String(task.ref)]?.disposition === 'map_to_anklav') ? context.anklavProjectId : undefined;
    }
    return undefined;
  }

  private async importTask(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    let projectRef = record.targetProjectRef as string | null;
    if (isProjectControlTask(record)) {
      const decision = context.overrides.projectControlTasks?.[String(record.ref)];
      if (!decision || decision.disposition !== 'map_to_anklav') return { status: 'skipped', targetType: 'task_provenance' };
      projectRef = 'project:anklav';
    }
    const projectId = projectRef === 'project:anklav' ? context.anklavProjectId : context.targets.get(String(projectRef))?.targetId;
    if (!projectId) return { status: 'deferred', targetType: 'task' };
    const originalIdentifier = String((source(record) ?? {}).identifier);
    const [matched] = await tx.select({ task: tasks }).from(tasks).leftJoin(taskIdentifierAliases, eq(taskIdentifierAliases.taskId, tasks.id)).where(and(eq(tasks.workspaceId, context.workspaceId), or(eq(tasks.identifier, originalIdentifier), eq(taskIdentifierAliases.identifier, originalIdentifier)))).orderBy(desc(tasks.updatedAt)).limit(1);
    if (matched?.task && !matched.task.deletedAt) return { status: 'matched', targetType: 'task', targetId: matched.task.id, version: matched.task.version };
    if (matched?.task?.deletedAt) {
      const [restored] = await tx.update(tasks).set({ deletedAt: null, deletedByUserId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(eq(tasks.id, matched.task.id)).returning();
      return { status: 'created', targetType: 'task', targetId: restored!.id, created: true, version: restored!.version };
    }
    const [state] = await tx.select().from(workflowStates).where(and(eq(workflowStates.workspaceId, context.workspaceId), eq(workflowStates.entityType, 'task'), eq(workflowStates.taskSemantic, String((record.status as BundleRecord).semantic) as any), isNull(workflowStates.archivedAt))).limit(1);
    if (!state) return { status: 'deferred', targetType: 'task' };
    await tx.insert(projectTaskCounters).values({ projectId, nextNumber: 1 }).onConflictDoNothing();
    const [counter] = await tx.update(projectTaskCounters).set({ nextNumber: sql`${projectTaskCounters.nextNumber} + 1`, updatedAt: new Date() }).where(eq(projectTaskCounters.projectId, projectId)).returning();
    const [project] = await tx.select({ issueKey: projects.issueKey }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const number = counter!.nextNumber - 1;
    const description = String(record.description);
    const dates = (record.dates ?? source(record)?.dates ?? {}) as BundleRecord;
    const semantic = String((record.status as BundleRecord).semantic);
    const completed = asDate(dates.completedAt ?? dates.completed_at);
    const [created] = await tx.insert(tasks).values({
      workspaceId: context.workspaceId, projectId, title: String(record.title), description, taskNumber: number, identifier: `${project!.issueKey}-${number}`, workflowStateId: state.id, priority: record.priority as any,
      humanReviewRequired: semantic === 'human_review', reviewStatus: semantic === 'human_review' ? 'pending' : 'not_required',
      dueDate: asDateOnly(dates.dueDate ?? dates.due_date), startedAt: asDate(dates.startedAt ?? dates.started_at), completedAt: completed, cancelledAt: asDate(dates.cancelledAt ?? dates.canceledAt ?? dates.cancelled_at ?? dates.canceled_at),
      verificationRequirements: section(description, 'Verification required'),
      verificationPerformed: completed && typeof record.verificationPerformed === 'string' ? String(record.verificationPerformed) : '',
      completionEvidence: completed && typeof record.completionEvidence === 'string' ? String(record.completionEvidence) : '',
      nonGoals: section(description, 'Non-goals'), remainingLimitations: section(description, 'Remaining limitations'), followUpWork: section(description, 'Follow-up work'),
    }).returning();
    await tx.insert(taskIdentifierAliases).values({ workspaceId: context.workspaceId, taskId: created!.id, identifier: originalIdentifier }).onConflictDoNothing();
    const acceptance = checklist(description, 'Acceptance criteria');
    if (acceptance.length) await tx.insert(checklistItems).values(acceptance.map((text, position) => ({ taskId: created!.id, kind: 'acceptance' as const, text, position })));
    for (const label of record.labels as BundleRecord[]) {
      if (label.importDisposition !== 'target_label') continue;
      const target = context.targets.get(`label:${label.sourceId}`);
      if (target?.targetId) await tx.insert(labelAssignments).values({ labelId: target.targetId, taskId: created!.id }).onConflictDoNothing();
    }
    const milestone = record.milestone as BundleRecord | null;
    if (milestone?.sourceId) {
      const target = context.targets.get(`milestone:${milestone.sourceId}`);
      if (target?.targetType === 'flow' && target.targetId) await tx.insert(taskFlows).values({ taskId: created!.id, flowId: target.targetId, role: 'primary', createdByUserId: context.actor.id }).onConflictDoNothing();
      if (target?.targetType === 'milestone' && target.targetId) await tx.insert(milestoneTasks).values({ milestoneId: target.targetId, taskId: created!.id }).onConflictDoNothing();
    }
    for (const url of record.githubLinks as string[]) await tx.insert(importConflicts).values({ importBatchId: context.batchId, code: 'github-link-deferred', severity: 'prerequisite', status: 'deferred', sourceKey: url, message: `Deferred GitHub evidence for ${created!.identifier}: ${url}`, resolution: { taskId: created!.id, url } }).onConflictDoNothing();
    return { status: 'created', targetType: 'task', targetId: created!.id, created: true, version: created!.version };
  }

  private async linkConfiguredRepository(tx: any, workspaceId: string, projectId: string, repository: unknown): Promise<void> {
    if (typeof repository !== 'string') return;
    const [github] = await tx.select({ repositoryId: githubRepositories.id }).from(githubRepositories).innerJoin(githubConnections, eq(githubRepositories.connectionId, githubConnections.id)).where(and(eq(githubConnections.workspaceId, workspaceId), eq(githubRepositories.fullName, repository), eq(githubRepositories.installed, true))).limit(1);
    if (github) await tx.insert(githubProjectRepositories).values({ repositoryId: github.repositoryId, projectId, syncMode: 'none' }).onConflictDoNothing();
  }

  private async importDocument(tx: any, context: ImportContext, record: BundleRecord): Promise<ResolvedTarget> {
    const projectId = context.targets.get(String(record.projectRef))?.targetId;
    const [existing] = await tx.select().from(knowledgeArtifacts).where(and(eq(knowledgeArtifacts.workspaceId, context.workspaceId), eq(knowledgeArtifacts.title, String(record.title)), eq(knowledgeArtifacts.origin, 'legacy_source'), projectId ? eq(knowledgeArtifacts.projectId, projectId) : undefined, isNull(knowledgeArtifacts.deletedAt))).limit(1);
    if (existing) return { status: 'matched', targetType: 'knowledge_artifact', targetId: existing.id, version: existing.version };
    const [artifact] = await tx.insert(knowledgeArtifacts).values({ workspaceId: context.workspaceId, projectId: projectId ?? null, type: 'legacy_document', origin: 'legacy_source', canonicality: 'candidate', verification: 'unverified', title: String(record.title), summary: `Imported Linear document; canonical repository path candidate: ${String(record.canonicalPath ?? '')}`, createdByUserId: context.actor.id }).returning();
    const content = String(record.content ?? '');
    const [revision] = await tx.insert(knowledgeArtifactRevisions).values({ workspaceId: context.workspaceId, artifactId: artifact!.id, revision: 1, nativeContent: content, contentHash: digest(content), importedAt: new Date(), createdByUserId: context.actor.id }).returning();
    await tx.update(knowledgeArtifacts).set({ currentRevisionId: revision!.id }).where(eq(knowledgeArtifacts.id, artifact!.id));
    return { status: 'created', targetType: 'knowledge_artifact', targetId: artifact!.id, created: true, version: artifact!.version, contentHash: digest(content) };
  }


}
