import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { activitySubject, checklistKind, commentSubject, flowRelationType, taskRelationType } from './enums';
import { users, workspaces } from './identity';
import { flows, projects, tasks } from './work';

export const labels = pgTable('labels', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  color: text('color').notNull().default('#64748b'),
  description: text('description').notNull().default(''),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('labels_workspace_name_unique').on(table.workspaceId, table.name)]);

export const labelAssignments = pgTable('label_assignments', {
  id: id(),
  labelId: uuid('label_id').notNull().references(() => labels.id),
  projectId: uuid('project_id').references(() => projects.id),
  flowId: uuid('flow_id').references(() => flows.id),
  taskId: uuid('task_id').references(() => tasks.id),
  createdAt: createdAt(),
}, (table) => [index('label_assignments_label_index').on(table.labelId), index('label_assignments_task_index').on(table.taskId), index('label_assignments_flow_index').on(table.flowId), index('label_assignments_project_index').on(table.projectId)]);

export const checklistItems = pgTable('checklist_items', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  kind: checklistKind('kind').notNull(),
  text: text('text').notNull(),
  completed: boolean('completed').notNull().default(false),
  position: integer('position').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const convergenceCriteria = pgTable('convergence_criteria', {
  id: id(),
  flowId: uuid('flow_id').notNull().references(() => flows.id),
  text: text('text').notNull(),
  completed: boolean('completed').notNull().default(false),
  position: integer('position').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskRelations = pgTable('task_relations', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  sourceTaskId: uuid('source_task_id').notNull().references(() => tasks.id),
  targetTaskId: uuid('target_task_id').notNull().references(() => tasks.id),
  type: taskRelationType('type').notNull(),
  explanation: text('explanation').notNull().default(''),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('task_relation_unique').on(table.sourceTaskId, table.targetTaskId, table.type), index('task_relation_target_index').on(table.targetTaskId)]);

export const flowRelations = pgTable('flow_relations', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  sourceFlowId: uuid('source_flow_id').notNull().references(() => flows.id),
  targetFlowId: uuid('target_flow_id').notNull().references(() => flows.id),
  type: flowRelationType('type').notNull(),
  explanation: text('explanation').notNull().default(''),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('flow_relation_unique').on(table.sourceFlowId, table.targetFlowId, table.type), index('flow_relation_target_index').on(table.targetFlowId)]);

export const comments = pgTable('comments', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  subject: commentSubject('subject').notNull(),
  taskId: uuid('task_id').references(() => tasks.id),
  flowId: uuid('flow_id').references(() => flows.id),
  body: text('body').notNull(),
  authorUserId: uuid('author_user_id').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('comments_task_index').on(table.taskId, table.createdAt), index('comments_flow_index').on(table.flowId, table.createdAt)]);

export const activityEvents = pgTable('activity_events', {
  id: id(),
  sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  subjectType: activitySubject('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  action: text('action').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  before: jsonb('before').$type<Record<string, unknown> | null>(),
  after: jsonb('after').$type<Record<string, unknown> | null>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('activity_sequence_unique').on(table.sequence), index('activity_workspace_sequence_index').on(table.workspaceId, table.sequence)]);

/** A workspace-scoped GitHub App registration and its single GitHub.com installation. */
