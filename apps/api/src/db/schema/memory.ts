import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common';
import { agentRuns } from './execution';
import { evidenceArtifacts } from './evidence';
import { users, workspaces } from './identity';
import { knowledgeArtifacts } from './knowledge';
import { projects, tasks } from './work';

export const memoryClaims = pgTable('memory_claims', {
  id: id(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id), projectId: uuid('project_id').references(() => projects.id), taskId: uuid('task_id').references(() => tasks.id), runId: uuid('run_id').references(() => agentRuns.id),
  subject: text('subject').notNull(), predicate: text('predicate').notNull(), value: jsonb('value').$type<unknown>().notNull(),
  classification: text('classification').notNull(), status: text('status').notNull().default('proposed'), confidenceBasisPoints: integer('confidence_basis_points').notNull(),
  validFromAt: timestamp('valid_from_at', { withTimezone: true }), validUntilAt: timestamp('valid_until_at', { withTimezone: true }), validFromCommit: text('valid_from_commit'), validUntilCommit: text('valid_until_commit'),
  sourceEvidenceArtifactId: uuid('source_evidence_artifact_id').references(() => evidenceArtifacts.id), sourceKnowledgeArtifactId: uuid('source_knowledge_artifact_id').references(() => knowledgeArtifacts.id), sourceSpan: jsonb('source_span').$type<Record<string, unknown>>().notNull().default({}), extraction: jsonb('extraction').$type<Record<string, unknown>>().notNull().default({}),
  supersededByClaimId: uuid('superseded_by_claim_id'), resolutionNote: text('resolution_note').notNull().default(''), proposedByUserId: uuid('proposed_by_user_id').references(() => users.id), verifiedByUserId: uuid('verified_by_user_id').references(() => users.id), verifiedAt: timestamp('verified_at', { withTimezone: true }), recordedAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index('memory_claims_current_project_index').on(table.projectId, table.status), index('memory_claims_task_index').on(table.taskId, table.recordedAt), index('memory_claims_subject_index').on(table.workspaceId, table.subject, table.predicate)]);

export const projectDecisions = pgTable('project_decisions', {
  id: id(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id), projectId: uuid('project_id').notNull().references(() => projects.id), taskId: uuid('task_id').references(() => tasks.id), proposedByRunId: uuid('proposed_by_run_id').references(() => agentRuns.id),
  question: text('question').notNull(), selectedOption: text('selected_option').notNull(), rejectedAlternatives: jsonb('rejected_alternatives').$type<string[]>().notNull().default([]), rationale: text('rationale').notNull(), consequences: jsonb('consequences').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('proposed'), effectiveRepository: text('effective_repository'), effectiveFromCommit: text('effective_from_commit'), effectiveUntilCommit: text('effective_until_commit'), evidenceArtifactIds: jsonb('evidence_artifact_ids').$type<string[]>().notNull().default([]),
  supersededByDecisionId: uuid('superseded_by_decision_id'), resolutionNote: text('resolution_note').notNull().default(''), proposedByUserId: uuid('proposed_by_user_id').references(() => users.id), decidedByUserId: uuid('decided_by_user_id').references(() => users.id), decidedAt: timestamp('decided_at', { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [index('project_decisions_current_index').on(table.projectId, table.status), index('project_decisions_task_index').on(table.taskId)]);

export const claimRelations = pgTable('claim_relations', {
  id: id(), workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id), fromClaimId: uuid('from_claim_id').notNull().references(() => memoryClaims.id), toClaimId: uuid('to_claim_id').notNull().references(() => memoryClaims.id), relation: text('relation').notNull(), createdByUserId: uuid('created_by_user_id').references(() => users.id), createdAt: createdAt(),
}, (table) => [uniqueIndex('claim_relations_unique').on(table.fromClaimId, table.toClaimId, table.relation), index('claim_relations_to_index').on(table.toClaimId)]);
