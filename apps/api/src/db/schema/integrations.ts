import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common';
import { users, workspaces, workflowStates } from './identity';
import { projects, repositories, tasks } from './work';

export const githubConnections = pgTable(
  'github_connections',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    organizationLogin: text('organization_login'),
    installationId: bigint('installation_id', { mode: 'number' }),
    appId: bigint('app_id', { mode: 'number' }),
    clientId: text('client_id'),
    encryptedCredentials: text('encrypted_credentials'),
    status: text('status').notNull().default('disconnected'),
    linkbacksEnabled: boolean('linkbacks_enabled').notNull().default(false),
    branchTemplate: text('branch_template').notNull().default('{identifier}-{slug}'),
    lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('github_connections_workspace_unique').on(table.workspaceId)],
);

export const githubOauthStates = pgTable(
  'github_oauth_states',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id').references(() => users.id),
    purpose: text('purpose').notNull(),
    stateHash: text('state_hash').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    usedAt: timestamp('used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('github_oauth_state_hash_unique').on(table.stateHash), index('github_oauth_state_expiry_index').on(table.expiresAt)],
);

export const githubUserConnections = pgTable(
  'github_user_connections',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    githubUserId: bigint('github_user_id', { mode: 'number' }).notNull(),
    login: text('login').notNull(),
    avatarUrl: text('avatar_url').notNull().default(''),
    encryptedToken: text('encrypted_token').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    encryptedRefreshToken: text('encrypted_refresh_token'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('github_user_connection_workspace_user_unique').on(table.workspaceId, table.userId), uniqueIndex('github_user_connection_workspace_github_unique').on(table.workspaceId, table.githubUserId)],
);

export const githubRepositories = pgTable(
  'github_repositories',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => githubConnections.id),
    canonicalRepositoryId: uuid('canonical_repository_id').references(() => repositories.id),
    githubRepositoryId: bigint('github_repository_id', {
      mode: 'number',
    }).notNull(),
    nodeId: text('node_id').notNull(),
    ownerLogin: text('owner_login').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    htmlUrl: text('html_url').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    private: boolean('private').notNull().default(true),
    installed: boolean('installed').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('github_repository_connection_github_unique').on(table.connectionId, table.githubRepositoryId), uniqueIndex('github_repository_connection_full_name_unique').on(table.connectionId, table.fullName)],
);

/** Many-to-many technical ownership; defaults make issue creation deterministic. */

export const githubProjectRepositories = pgTable(
  'github_project_repositories',
  {
    id: id(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    syncMode: text('sync_mode').notNull().default('none'),
    defaultInbound: boolean('default_inbound').notNull().default(false),
    defaultOutbound: boolean('default_outbound').notNull().default(false),
    openStateId: uuid('open_state_id').references(() => workflowStates.id),
    closedStateId: uuid('closed_state_id').references(() => workflowStates.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('github_project_repository_unique').on(table.repositoryId, table.projectId),
    index('github_project_repositories_project_index').on(table.projectId),
    uniqueIndex('github_repository_default_inbound_unique')
      .on(table.repositoryId)
      .where(sql`${table.defaultInbound} = true`),
    uniqueIndex('github_project_default_outbound_unique')
      .on(table.projectId)
      .where(sql`${table.defaultOutbound} = true`),
  ],
);

export const githubIssueLinks = pgTable(
  'github_issue_links',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id),
    githubIssueId: bigint('github_issue_id', { mode: 'number' }).notNull(),
    nodeId: text('node_id').notNull(),
    issueNumber: integer('issue_number').notNull(),
    htmlUrl: text('html_url').notNull(),
    syncMode: text('sync_mode').notNull().default('manual'),
    syncStatus: text('sync_status').notNull().default('pending'),
    lastSyncedSnapshot: jsonb('last_synced_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('github_issue_link_task_repository_unique').on(table.taskId, table.repositoryId), uniqueIndex('github_issue_link_repository_issue_unique').on(table.repositoryId, table.githubIssueId), index('github_issue_links_task_index').on(table.taskId)],
);

export const githubPullRequests = pgTable(
  'github_pull_requests',
  {
    id: id(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id),
    githubPullRequestId: bigint('github_pull_request_id', {
      mode: 'number',
    }).notNull(),
    nodeId: text('node_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    htmlUrl: text('html_url').notNull(),
    state: text('state').notNull(),
    draft: boolean('draft').notNull().default(false),
    headRef: text('head_ref').notNull().default(''),
    baseRef: text('base_ref').notNull().default(''),
    headSha: text('head_sha').notNull().default(''),
    authorLogin: text('author_login').notNull().default(''),
    authorGithubUserId: bigint('author_github_user_id', { mode: 'number' }),
    reviewDecision: text('review_decision'),
    mergeableState: text('mergeable_state'),
    checks: jsonb('checks').$type<Record<string, unknown>[]>().notNull().default([]),
    updatedAtGithub: timestamp('updated_at_github', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('github_pull_request_repository_github_unique').on(table.repositoryId, table.githubPullRequestId), uniqueIndex('github_pull_request_repository_number_unique').on(table.repositoryId, table.number), index('github_pull_requests_repository_state_index').on(table.repositoryId, table.state)],
);

export const githubTaskPullRequests = pgTable(
  'github_task_pull_requests',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    pullRequestId: uuid('pull_request_id')
      .notNull()
      .references(() => githubPullRequests.id),
    linkKind: text('link_kind').notNull().default('closing'),
    source: text('source').notNull().default('manual'),
    ignored: boolean('ignored').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('github_task_pull_request_unique').on(table.taskId, table.pullRequestId), index('github_task_pull_requests_task_index').on(table.taskId)],
);

export const githubWebhookDeliveries = pgTable(
  'github_webhook_deliveries',
  {
    id: id(),
    connectionId: uuid('connection_id').references(() => githubConnections.id),
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (table) => [uniqueIndex('github_webhook_delivery_unique').on(table.deliveryId), index('github_webhook_deliveries_process_index').on(table.processedAt)],
);

export const integrationJobs = pgTable(
  'integration_jobs',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    connectionId: uuid('connection_id').references(() => githubConnections.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('integration_jobs_claim_index').on(table.status, table.runAfter), index('integration_jobs_workspace_index').on(table.workspaceId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    href: text('href').notNull().default(''),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('notifications_user_unread_index').on(table.userId, table.readAt, table.createdAt)],
);

/** A delivery checkpoint is distinct from a continuing flow. */
