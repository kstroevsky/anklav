import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common';
import { users, workspaces } from './identity';
import { projects, tasks } from './work';
import { agentRuns } from './execution';

export const retrievalDocuments = pgTable('retrieval_documents', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  taskId: uuid('task_id').references(() => tasks.id),
  runId: uuid('run_id').references(() => agentRuns.id),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  contextualPrefix: text('contextual_prefix').notNull(),
  searchText: text('search_text').notNull(),
  contentHash: text('content_hash').notNull(),
  authorityBasisPoints: integer('authority_basis_points').notNull(),
  sensitivity: text('sensitivity').notNull().default('project'),
  status: text('status').notNull().default('current'),
  validFromAt: timestamp('valid_from_at', { withTimezone: true }),
  validUntilAt: timestamp('valid_until_at', { withTimezone: true }),
  sourceRecordedAt: timestamp('source_recorded_at', { withTimezone: true }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('retrieval_documents_source_unique').on(table.workspaceId, table.sourceType, table.sourceId),
  index('retrieval_documents_project_status_index').on(table.projectId, table.status, table.sourceType),
  index('retrieval_documents_task_index').on(table.taskId, table.sourceType),
  index('retrieval_documents_search_index').using('gin', sql`to_tsvector('simple', ${table.searchText})`),
]);

export const retrievalEmbeddings = pgTable('retrieval_embeddings', {
  documentId: uuid('document_id').notNull().references(() => retrievalDocuments.id),
  model: text('model').notNull(),
  contentHash: text('content_hash').notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  primaryKey({ columns: [table.documentId, table.model] }),
  index('retrieval_embeddings_cosine_index').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const retrievalTraces = pgTable('retrieval_traces', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  taskId: uuid('task_id').references(() => tasks.id),
  queryHash: text('query_hash').notNull(),
  intent: text('intent').notNull(),
  embeddingModel: text('embedding_model'),
  filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
  candidateCounts: jsonb('candidate_counts').$type<Record<string, number>>().notNull().default({}),
  scoring: jsonb('scoring').$type<Record<string, unknown>>().notNull().default({}),
  resultRefs: jsonb('result_refs').$type<Record<string, unknown>[]>().notNull().default([]),
  semanticUsed: boolean('semantic_used').notNull().default(false),
  requestedByUserId: uuid('requested_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [index('retrieval_traces_workspace_created_index').on(table.workspaceId, table.createdAt), index('retrieval_traces_task_created_index').on(table.taskId, table.createdAt)]);
