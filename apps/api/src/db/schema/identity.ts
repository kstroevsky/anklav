import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { flowSemantic, instanceRole, membershipRole, taskSemantic, workflowEntity } from './enums';

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  instanceRole: instanceRole('instance_role').notNull().default('user'),
  theme: text('theme').notNull().default('system'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('users_email_unique').on(table.email)]);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  lastSeenAt: updatedAt(),
}, (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash), index('sessions_user_index').on(table.userId)]);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('workspaces_slug_unique').on(table.slug)]);

export const workspaceMemberships = pgTable('workspace_memberships', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: membershipRole('role').notNull().default('member'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('membership_workspace_user_unique').on(table.workspaceId, table.userId), index('membership_user_index').on(table.userId)]);

export const workflowStates = pgTable('workflow_states', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  entityType: workflowEntity('entity_type').notNull(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  taskSemantic: taskSemantic('task_semantic'),
  flowSemantic: flowSemantic('flow_semantic'),
  position: integer('position').notNull(),
  isInitial: boolean('is_initial').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('workflow_state_workspace_entity_index').on(table.workspaceId, table.entityType, table.position)]);
