import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { flowScope, health, priority, projectStatus, reviewStatus, taskFlowRole } from './enums';
import { users, workspaces, workflowStates, workspaceMemberships } from './identity';

export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: projectStatus('status').notNull().default('proposed'),
    priority: priority('priority').notNull().default('none'),
    health: health('health').notNull().default('unknown'),
    currentFocus: text('current_focus').notNull().default(''),
    currentStateSummary: text('current_state_summary').notNull().default(''),
    repositoryReference: text('repository_reference').notNull().default(''),
    /** Stable, human-readable prefix used by task identifiers such as API-123. */
    issueKey: text('issue_key').notNull(),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('projects_workspace_index').on(table.workspaceId, table.status), uniqueIndex('projects_workspace_issue_key_unique').on(table.workspaceId, table.issueKey)],
);

/** Provider-neutral repository identity. Provider installations are linked to this record. */
export const repositories = pgTable(
  'repositories',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    provider: text('provider').notNull().default('git'),
    providerRepositoryId: text('provider_repository_id'),
    owner: text('owner').notNull().default(''),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    remoteUrl: text('remote_url').notNull().default(''),
    defaultBranch: text('default_branch').notNull().default('main'),
    visibility: text('visibility').notNull().default('private'),
    archived: boolean('archived').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('repositories_workspace_full_name_unique').on(table.workspaceId, table.fullName), index('repositories_workspace_index').on(table.workspaceId, table.archived)],
);

/** Machine-specific checkout paths are aliases, never repository identity. */
export const repositoryLocalAliases = pgTable(
  'repository_local_aliases',
  {
    id: id(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    machineIdentity: text('machine_identity').notNull(),
    localPath: text('local_path').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('repository_local_alias_machine_path_unique').on(table.machineIdentity, table.localPath), uniqueIndex('repository_local_alias_repository_machine_unique').on(table.repositoryId, table.machineIdentity)],
);

export const projectRepositories = pgTable(
  'project_repositories',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    role: text('role').notNull().default('supporting'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('project_repositories_unique').on(table.projectId, table.repositoryId),
    uniqueIndex('project_primary_repository_unique')
      .on(table.projectId)
      .where(sql`${table.role} = 'primary'`),
    index('project_repositories_repository_index').on(table.repositoryId),
  ],
);

export const flows = pgTable(
  'flows',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    purpose: text('purpose').notNull().default(''),
    workflowStateId: uuid('workflow_state_id')
      .notNull()
      .references(() => workflowStates.id),
    priority: priority('priority').notNull().default('none'),
    health: health('health').notNull().default('unknown'),
    currentFocus: text('current_focus').notNull().default(''),
    currentStateSummary: text('current_state_summary').notNull().default(''),
    importantFindings: text('important_findings').notNull().default(''),
    nextRecommendedAction: text('next_recommended_action').notNull().default(''),
    scope: flowScope('scope').notNull().default('all_projects'),
    responsibleMembershipId: uuid('responsible_membership_id').references(() => workspaceMemberships.id),
    primaryCurrentTaskId: uuid('primary_current_task_id'),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('flows_workspace_state_index').on(table.workspaceId, table.workflowStateId)],
);

export const flowAllowedProjects = pgTable(
  'flow_allowed_projects',
  {
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('flow_allowed_projects_unique').on(table.flowId, table.projectId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    parentTaskId: uuid('parent_task_id'),
    title: text('title').notNull(),
    taskNumber: integer('task_number').notNull(),
    identifier: text('identifier').notNull(),
    description: text('description').notNull().default(''),
    objective: text('objective').notNull().default(''),
    constraints: jsonb('constraints').$type<string[]>().notNull().default([]),
    riskLevel: text('risk_level').notNull().default('medium'),
    expectedArtifacts: jsonb('expected_artifacts').$type<string[]>().notNull().default([]),
    targetRepositoryId: uuid('target_repository_id').references(() => repositories.id),
    targetBranch: text('target_branch').notNull().default(''),
    includedPaths: jsonb('included_paths').$type<string[]>().notNull().default([]),
    excludedPaths: jsonb('excluded_paths').$type<string[]>().notNull().default([]),
    contextPolicy: jsonb('context_policy').$type<Record<string, unknown>>().notNull().default({}),
    memoryMode: text('memory_mode').notNull().default('project'),
    requiredApprovals: jsonb('required_approvals').$type<string[]>().notNull().default([]),
    coordinatingMembershipId: uuid('coordinating_membership_id').references(() => workspaceMemberships.id),
    workflowStateId: uuid('workflow_state_id')
      .notNull()
      .references(() => workflowStates.id),
    priority: priority('priority').notNull().default('none'),
    assigneeMembershipId: uuid('assignee_membership_id').references(() => workspaceMemberships.id),
    dueDate: date('due_date'),
    humanReviewRequired: boolean('human_review_required').notNull().default(false),
    reviewStatus: reviewStatus('review_status').notNull().default('not_required'),
    reviewerMembershipId: uuid('reviewer_membership_id').references(() => workspaceMemberships.id),
    reviewDecidedAt: timestamp('review_decided_at', { withTimezone: true }),
    reviewNote: text('review_note').notNull().default(''),
    verificationPerformed: text('verification_performed').notNull().default(''),
    /** What must be verified before completion. It is not evidence that verification happened. */
    verificationRequirements: text('verification_requirements').notNull().default(''),
    completionEvidence: text('completion_evidence').notNull().default(''),
    /** Explicit exclusions are context, not a limitation discovered after delivery. */
    nonGoals: text('non_goals').notNull().default(''),
    remainingLimitations: text('remaining_limitations').notNull().default(''),
    followUpWork: text('follow_up_work').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('tasks_workspace_state_index').on(table.workspaceId, table.workflowStateId), index('tasks_project_index').on(table.projectId), index('tasks_target_repository_index').on(table.targetRepositoryId), index('tasks_parent_index').on(table.parentTaskId), uniqueIndex('tasks_workspace_identifier_unique').on(table.workspaceId, table.identifier), uniqueIndex('tasks_project_number_unique').on(table.projectId, table.taskNumber)],
);

/** Allocates task numbers without relying on a process-local counter. */

export const projectTaskCounters = pgTable('project_task_counters', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id),
  nextNumber: integer('next_number').notNull().default(1),
  updatedAt: updatedAt(),
});

/** Old identifiers remain resolvable after a task is moved to a different project. */

export const taskIdentifierAliases = pgTable(
  'task_identifier_aliases',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    identifier: text('identifier').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('task_identifier_alias_workspace_unique').on(table.workspaceId, table.identifier), index('task_identifier_alias_task_index').on(table.taskId)],
);

export const taskFlows = pgTable(
  'task_flows',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id),
    role: taskFlowRole('role').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('task_flow_unique').on(table.taskId, table.flowId),
    uniqueIndex('task_primary_flow_unique')
      .on(table.taskId)
      .where(sql`${table.role} = 'primary'`),
    index('task_flows_flow_index').on(table.flowId),
  ],
);
