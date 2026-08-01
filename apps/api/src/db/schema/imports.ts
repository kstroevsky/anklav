import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { importBatchStatus, importConflictSeverity, importConflictStatus, importMappingStatus } from './enums';
import { users, workspaces } from './identity';
import { flows, projects, tasks } from './work';
import { workflowStates } from './identity';
import { labels } from './collaboration';
import { knowledgeArtifacts } from './knowledge';

export const externalSources = pgTable('external_sources', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  system: text('system').notNull(),
  bundleVersion: text('bundle_version').notNull(),
  bundleChecksum: text('bundle_checksum').notNull(),
  sourceUri: text('source_uri').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('external_source_workspace_bundle_unique').on(table.workspaceId, table.system, table.bundleVersion, table.bundleChecksum)]);

export const importBatches = pgTable('import_batches', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  externalSourceId: uuid('external_source_id').notNull().references(() => externalSources.id),
  bundleVersion: text('bundle_version').notNull(),
  bundleChecksum: text('bundle_checksum').notNull(),
  bundlePathHash: text('bundle_path_hash').notNull(),
  status: importBatchStatus('status').notNull().default('planned'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  /** The checksummed bundle plus this hash is the frozen decision identity. */
  overridesHash: text('overrides_hash').notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
  error: text('error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('import_batch_workspace_status_index').on(table.workspaceId, table.status), index('import_batch_source_checksum_index').on(table.externalSourceId, table.bundleChecksum)]);

export const externalObjectMappings = pgTable('external_object_mappings', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  externalSourceId: uuid('external_source_id').notNull().references(() => externalSources.id),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id),
  sourceSystem: text('source_system').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceKey: text('source_key').notNull(),
  importKey: text('import_key').notNull(),
  sourceUrl: text('source_url'),
  bundleVersion: text('bundle_version').notNull(),
  sourcePayloadHash: text('source_payload_hash').notNull(),
  targetEntityType: text('target_entity_type').notNull(),
  targetEntityId: uuid('target_entity_id'),
  status: importMappingStatus('status').notNull(),
  createdTarget: boolean('created_target').notNull().default(false),
  importedAt: timestamp('imported_at', { withTimezone: true }),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  /** Retired mappings remain historical but cannot satisfy a reapplication. */
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  supersededByBatchId: uuid('superseded_by_batch_id').references(() => importBatches.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('external_object_mapping_workspace_source_key_active_unique').on(table.workspaceId, table.sourceKey).where(sql`${table.supersededAt} IS NULL`),
  uniqueIndex('external_object_mapping_import_key_active_unique').on(table.importKey).where(sql`${table.supersededAt} IS NULL`),
  index('external_object_mapping_batch_index').on(table.importBatchId), index('external_object_mapping_target_index').on(table.targetEntityType, table.targetEntityId),
]);

export const importCreatedObjects = pgTable('import_created_objects', {
  id: id(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id),
  mappingId: uuid('mapping_id').notNull().references(() => externalObjectMappings.id),
  targetEntityType: text('target_entity_type').notNull(),
  targetEntityId: uuid('target_entity_id').notNull(),
  importedVersion: integer('imported_version'),
  importedContentHash: text('imported_content_hash').notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('import_created_object_mapping_unique').on(table.mappingId), index('import_created_object_batch_index').on(table.importBatchId)]);

export const importConflicts = pgTable('import_conflicts', {
  id: id(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id),
  externalMappingId: uuid('external_mapping_id').references(() => externalObjectMappings.id),
  code: text('code').notNull(),
  severity: importConflictSeverity('severity').notNull(),
  status: importConflictStatus('status').notNull().default('open'),
  sourceKey: text('source_key'),
  message: text('message').notNull(),
  resolution: jsonb('resolution').$type<Record<string, unknown>>(),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [uniqueIndex('import_conflict_batch_code_source_unique').on(table.importBatchId, table.code, table.sourceKey), index('import_conflict_batch_status_index').on(table.importBatchId, table.status)]);

export const importVerifications = pgTable('import_verifications', {
  id: id(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id),
  reportPath: text('report_path').notNull(),
  reportChecksum: text('report_checksum').notNull(),
  result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),
}, (table) => [uniqueIndex('import_verification_batch_unique').on(table.importBatchId)]);

/** Failed verification is auditable, but can never be mistaken for an accepted verification. */

export const importVerificationAttempts = pgTable('import_verification_attempts', {
  id: id(),
  importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id),
  reportPath: text('report_path').notNull(),
  reportChecksum: text('report_checksum').notNull(),
  checks: jsonb('checks').$type<Record<string, unknown>[]>().notNull().default([]),
  failures: jsonb('failures').$type<Record<string, unknown>[]>().notNull().default([]),
  warnings: jsonb('warnings').$type<Record<string, unknown>[]>().notNull().default([]),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  attemptedByUserId: uuid('attempted_by_user_id').references(() => users.id),
}, (table) => [index('import_verification_attempt_batch_index').on(table.importBatchId, table.attemptedAt)]);
