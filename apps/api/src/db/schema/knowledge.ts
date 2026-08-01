import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { artifactCanonicality, artifactOrigin, artifactType, artifactVerification, milestoneStatus } from './enums';
import { users, workspaces } from './identity';
import { flows, projects, tasks } from './work';
import { githubRepositories } from './integrations';

export const milestones = pgTable('milestones', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  flowId: uuid('flow_id').references(() => flows.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: milestoneStatus('status').notNull().default('planned'),
  targetDate: date('target_date'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('milestone_project_name_unique').on(table.projectId, table.name), index('milestone_workspace_status_index').on(table.workspaceId, table.status), index('milestone_flow_index').on(table.flowId)]);

export const milestoneTasks = pgTable('milestone_tasks', {
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('milestone_task_unique').on(table.milestoneId, table.taskId), index('milestone_tasks_task_index').on(table.taskId)]);

/** Minimal knowledge layer: native content and Git references remain explicitly distinct. */

export const knowledgeArtifacts = pgTable('knowledge_artifacts', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').references(() => projects.id),
  flowId: uuid('flow_id').references(() => flows.id),
  taskId: uuid('task_id').references(() => tasks.id),
  type: artifactType('type').notNull(),
  origin: artifactOrigin('origin').notNull(),
  canonicality: artifactCanonicality('canonicality').notNull().default('candidate'),
  verification: artifactVerification('verification').notNull().default('unverified'),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  currentRevisionId: uuid('current_revision_id'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('knowledge_artifact_workspace_type_index').on(table.workspaceId, table.type), index('knowledge_artifact_project_index').on(table.projectId), index('knowledge_artifact_flow_index').on(table.flowId), index('knowledge_artifact_task_index').on(table.taskId)]);

export const knowledgeArtifactRevisions = pgTable('knowledge_artifact_revisions', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  artifactId: uuid('artifact_id').notNull().references(() => knowledgeArtifacts.id),
  revision: integer('revision').notNull(),
  nativeContent: text('native_content'),
  contentHash: text('content_hash'),
  importedAt: timestamp('imported_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('knowledge_artifact_revision_unique').on(table.artifactId, table.revision), index('knowledge_artifact_revision_workspace_index').on(table.workspaceId, table.artifactId)]);

export const repositoryArtifactReferences = pgTable('repository_artifact_references', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  artifactId: uuid('artifact_id').notNull().references(() => knowledgeArtifacts.id),
  githubRepositoryId: uuid('github_repository_id').references(() => githubRepositories.id),
  repositoryFullName: text('repository_full_name').notNull(),
  path: text('path').notNull(),
  commitSha: text('commit_sha'),
  contentHash: text('content_hash'),
  sourceProjectId: uuid('source_project_id').references(() => projects.id),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verificationNote: text('verification_note').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('repository_artifact_reference_unique').on(table.artifactId, table.repositoryFullName, table.path, table.commitSha), index('repository_artifact_reference_repository_index').on(table.githubRepositoryId), index('repository_artifact_reference_workspace_index').on(table.workspaceId, table.repositoryFullName)]);

export const artifactRelations = pgTable('artifact_relations', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  fromArtifactId: uuid('from_artifact_id').notNull().references(() => knowledgeArtifacts.id),
  toArtifactId: uuid('to_artifact_id').notNull().references(() => knowledgeArtifacts.id),
  relation: text('relation').notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('artifact_relation_unique').on(table.fromArtifactId, table.toArtifactId, table.relation), index('artifact_relation_to_index').on(table.toArtifactId)]);

/** Every imported source object has one durable, workspace-scoped outcome. */
