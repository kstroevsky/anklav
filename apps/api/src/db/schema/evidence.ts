import { bigint, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './common';
import { agentRuns, nativeSessions, runEvents } from './execution';
import { users, workspaces } from './identity';
import { projects, tasks } from './work';

/** One immutable physical object may be referenced by manifests in several authorized scopes. */
export const evidenceBlobs = pgTable('evidence_blobs', {
  hash: text('hash').primaryKey(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const evidenceArtifacts = pgTable('evidence_artifacts', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').references(() => projects.id),
  taskId: uuid('task_id').references(() => tasks.id),
  runId: uuid('run_id').references(() => agentRuns.id),
  blobHash: text('blob_hash').notNull().references(() => evidenceBlobs.hash),
  idempotencyKey: text('idempotency_key').notNull(),
  type: text('type').notNull(),
  mimeType: text('mime_type').notNull(),
  title: text('title').notNull(),
  producer: text('producer').notNull(),
  preview: text('preview').notNull().default(''),
  redactionStatus: text('redaction_status').notNull().default('unreviewed'),
  retentionPolicy: text('retention_policy').notNull().default('project_default'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('evidence_artifacts_workspace_idempotency_unique').on(table.workspaceId, table.idempotencyKey), index('evidence_artifacts_task_index').on(table.taskId, table.createdAt), index('evidence_artifacts_run_index').on(table.runId, table.createdAt), index('evidence_artifacts_blob_index').on(table.blobHash)]);

export const evidenceEventLinks = pgTable('evidence_event_links', {
  evidenceArtifactId: uuid('evidence_artifact_id').notNull().references(() => evidenceArtifacts.id),
  runEventId: uuid('run_event_id').notNull().references(() => runEvents.id),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.evidenceArtifactId, table.runEventId] }), index('evidence_event_links_event_index').on(table.runEventId)]);

export const nativeSessionEvidence = pgTable('native_session_evidence', {
  nativeSessionId: uuid('native_session_id').notNull().references(() => nativeSessions.id),
  evidenceArtifactId: uuid('evidence_artifact_id').notNull().references(() => evidenceArtifacts.id),
  role: text('role').notNull().default('archive'),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.nativeSessionId, table.evidenceArtifactId] }), index('native_session_evidence_artifact_index').on(table.evidenceArtifactId)]);
