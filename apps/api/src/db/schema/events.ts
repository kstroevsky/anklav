import { bigint, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './common';
import { users, workspaces } from './identity';

/** Canonical, append-only history for control-plane aggregate mutations. */
export const domainEvents = pgTable('domain_events', {
  id: id(),
  sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  eventType: text('event_type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  commandHash: text('command_hash').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  source: jsonb('source').$type<Record<string, unknown>>().notNull().default({}),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  recordedAt: createdAt(),
}, (table) => [
  uniqueIndex('domain_events_sequence_unique').on(table.sequence),
  uniqueIndex('domain_events_idempotency_unique').on(table.workspaceId, table.idempotencyKey),
  uniqueIndex('domain_events_aggregate_version_unique').on(table.aggregateType, table.aggregateId, table.aggregateVersion),
  index('domain_events_aggregate_sequence_index').on(table.aggregateType, table.aggregateId, table.sequence),
  index('domain_events_workspace_sequence_index').on(table.workspaceId, table.sequence),
]);
