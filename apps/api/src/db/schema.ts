import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../common/ids';

const id = () => uuid('id').primaryKey().$defaultFn(uuidv7);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const instanceRole = pgEnum('instance_role', ['user', 'instance_admin']);
export const membershipRole = pgEnum('membership_role', ['owner', 'admin', 'member']);
export const priority = pgEnum('priority', ['none', 'low', 'medium', 'high', 'urgent']);
export const health = pgEnum('health', ['unknown', 'on_track', 'at_risk', 'off_track']);
export const projectStatus = pgEnum('project_status', ['proposed', 'planned', 'active', 'paused', 'completed', 'archived']);
export const workflowEntity = pgEnum('workflow_entity', ['task', 'flow']);
export const taskSemantic = pgEnum('task_semantic', ['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled']);
export const flowSemantic = pgEnum('flow_semantic', ['proposed', 'active', 'paused', 'converged', 'closed']);
export const flowScope = pgEnum('flow_scope', ['all_projects', 'selected_projects']);
export const taskFlowRole = pgEnum('task_flow_role', ['primary', 'related']);
export const taskRelationType = pgEnum('task_relation_type', ['blocks', 'related', 'duplicate_of']);
export const flowRelationType = pgEnum('flow_relation_type', ['blocks', 'related', 'replaces', 'merged_into']);
export const checklistKind = pgEnum('checklist_kind', ['readiness', 'acceptance']);
export const reviewStatus = pgEnum('review_status', ['not_required', 'pending', 'approved', 'changes_requested']);
export const commentSubject = pgEnum('comment_subject', ['task', 'flow']);
export const activitySubject = pgEnum('activity_subject', ['workspace', 'membership', 'workflow_state', 'project', 'flow', 'task', 'label', 'comment', 'task_relation', 'flow_relation', 'checklist_item', 'milestone', 'knowledge_artifact', 'import_batch']);
export const oauthTokenKind = pgEnum('oauth_token_kind', ['access', 'refresh']);
export const milestoneStatus = pgEnum('milestone_status', ['planned', 'in_progress', 'completed', 'cancelled', 'archived']);
export const artifactType = pgEnum('artifact_type', ['legacy_document', 'git_reference', 'research', 'specification', 'decision', 'evaluation', 'handoff', 'project_state', 'roadmap', 'agent_instructions']);
export const artifactOrigin = pgEnum('artifact_origin', ['legacy_source', 'native', 'git_backed']);
export const artifactCanonicality = pgEnum('artifact_canonicality', ['candidate', 'canonical', 'superseded', 'rejected']);
export const artifactVerification = pgEnum('artifact_verification', ['unverified', 'verified']);
export const importBatchStatus = pgEnum('import_batch_status', ['planned', 'applying', 'interrupted', 'completed', 'failed', 'rolling_back', 'rolled_back']);
export const importMappingStatus = pgEnum('import_mapping_status', ['created', 'matched', 'skipped', 'deferred', 'review_required', 'failed', 'drift', 'rolled_back']);
export const importConflictStatus = pgEnum('import_conflict_status', ['open', 'resolved', 'deferred']);
export const importConflictSeverity = pgEnum('import_conflict_severity', ['blocking', 'prerequisite', 'review', 'warning']);

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

/** Public OAuth clients registered through the MCP dynamic-registration endpoint. */
export const oauthClients = pgTable('oauth_clients', {
  id: id(),
  name: text('name').notNull(),
  redirectUris: jsonb('redirect_uris').$type<string[]>().notNull(),
  clientIdIssuedAt: timestamp('client_id_issued_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [index('oauth_clients_expires_index').on(table.expiresAt)]);

export const oauthAuthorizationRequests = pgTable('oauth_authorization_requests', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes').notNull(),
  state: text('state'),
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [index('oauth_authorization_requests_expiry_index').on(table.expiresAt)]);

export const oauthGrants = pgTable('oauth_grants', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  scopes: text('scopes').notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (table) => [index('oauth_grants_user_index').on(table.userId), index('oauth_grants_client_index').on(table.clientId)]);

export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  id: id(),
  codeHash: text('code_hash').notNull(),
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes').notNull(),
  resource: text('resource').notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('oauth_authorization_codes_hash_unique').on(table.codeHash), index('oauth_authorization_codes_expiry_index').on(table.expiresAt)]);

export const oauthTokens = pgTable('oauth_tokens', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  kind: oauthTokenKind('kind').notNull(),
  familyId: uuid('family_id').notNull(),
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  clientId: uuid('client_id').notNull().references(() => oauthClients.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  scopes: text('scopes').notNull(),
  resource: text('resource').notNull(),
  replacedAt: timestamp('replaced_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('oauth_tokens_hash_unique').on(table.tokenHash), index('oauth_tokens_grant_index').on(table.grantId), index('oauth_tokens_family_index').on(table.familyId), index('oauth_tokens_expiry_index').on(table.expiresAt)]);

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

export const oauthGrantWorkspaces = pgTable('oauth_grant_workspaces', {
  grantId: uuid('grant_id').notNull().references(() => oauthGrants.id),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('oauth_grant_workspace_unique').on(table.grantId, table.workspaceId), index('oauth_grant_workspaces_workspace_index').on(table.workspaceId)]);

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

export const projects = pgTable('projects', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
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
}, (table) => [index('projects_workspace_index').on(table.workspaceId, table.status), uniqueIndex('projects_workspace_issue_key_unique').on(table.workspaceId, table.issueKey)]);

export const flows = pgTable('flows', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  purpose: text('purpose').notNull().default(''),
  workflowStateId: uuid('workflow_state_id').notNull().references(() => workflowStates.id),
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
}, (table) => [index('flows_workspace_state_index').on(table.workspaceId, table.workflowStateId)]);

export const flowAllowedProjects = pgTable('flow_allowed_projects', {
  flowId: uuid('flow_id').notNull().references(() => flows.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('flow_allowed_projects_unique').on(table.flowId, table.projectId)]);

export const tasks = pgTable('tasks', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  parentTaskId: uuid('parent_task_id'),
  title: text('title').notNull(),
  taskNumber: integer('task_number').notNull(),
  identifier: text('identifier').notNull(),
  description: text('description').notNull().default(''),
  workflowStateId: uuid('workflow_state_id').notNull().references(() => workflowStates.id),
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
}, (table) => [index('tasks_workspace_state_index').on(table.workspaceId, table.workflowStateId), index('tasks_project_index').on(table.projectId), index('tasks_parent_index').on(table.parentTaskId), uniqueIndex('tasks_workspace_identifier_unique').on(table.workspaceId, table.identifier), uniqueIndex('tasks_project_number_unique').on(table.projectId, table.taskNumber)]);

/** Allocates task numbers without relying on a process-local counter. */
export const projectTaskCounters = pgTable('project_task_counters', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id),
  nextNumber: integer('next_number').notNull().default(1),
  updatedAt: updatedAt(),
});

/** Old identifiers remain resolvable after a task is moved to a different project. */
export const taskIdentifierAliases = pgTable('task_identifier_aliases', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  identifier: text('identifier').notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('task_identifier_alias_workspace_unique').on(table.workspaceId, table.identifier), index('task_identifier_alias_task_index').on(table.taskId)]);

export const taskFlows = pgTable('task_flows', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  flowId: uuid('flow_id').notNull().references(() => flows.id),
  role: taskFlowRole('role').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('task_flow_unique').on(table.taskId, table.flowId), uniqueIndex('task_primary_flow_unique').on(table.taskId).where(sql`${table.role} = 'primary'`), index('task_flows_flow_index').on(table.flowId)]);

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
export const githubConnections = pgTable('github_connections', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
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
}, (table) => [uniqueIndex('github_connections_workspace_unique').on(table.workspaceId)]);

export const githubOauthStates = pgTable('github_oauth_states', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').references(() => users.id),
  purpose: text('purpose').notNull(),
  stateHash: text('state_hash').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('github_oauth_state_hash_unique').on(table.stateHash), index('github_oauth_state_expiry_index').on(table.expiresAt)]);

export const githubUserConnections = pgTable('github_user_connections', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  githubUserId: bigint('github_user_id', { mode: 'number' }).notNull(),
  login: text('login').notNull(),
  avatarUrl: text('avatar_url').notNull().default(''),
  encryptedToken: text('encrypted_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('github_user_connection_workspace_user_unique').on(table.workspaceId, table.userId), uniqueIndex('github_user_connection_workspace_github_unique').on(table.workspaceId, table.githubUserId)]);

export const githubRepositories = pgTable('github_repositories', {
  id: id(),
  connectionId: uuid('connection_id').notNull().references(() => githubConnections.id),
  githubRepositoryId: bigint('github_repository_id', { mode: 'number' }).notNull(),
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
}, (table) => [uniqueIndex('github_repository_connection_github_unique').on(table.connectionId, table.githubRepositoryId), uniqueIndex('github_repository_connection_full_name_unique').on(table.connectionId, table.fullName)]);

/** Many-to-many technical ownership; defaults make issue creation deterministic. */
export const githubProjectRepositories = pgTable('github_project_repositories', {
  id: id(),
  repositoryId: uuid('repository_id').notNull().references(() => githubRepositories.id),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  syncMode: text('sync_mode').notNull().default('none'),
  defaultInbound: boolean('default_inbound').notNull().default(false),
  defaultOutbound: boolean('default_outbound').notNull().default(false),
  openStateId: uuid('open_state_id').references(() => workflowStates.id),
  closedStateId: uuid('closed_state_id').references(() => workflowStates.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex('github_project_repository_unique').on(table.repositoryId, table.projectId), index('github_project_repositories_project_index').on(table.projectId), uniqueIndex('github_repository_default_inbound_unique').on(table.repositoryId).where(sql`${table.defaultInbound} = true`), uniqueIndex('github_project_default_outbound_unique').on(table.projectId).where(sql`${table.defaultOutbound} = true`)]);

export const githubIssueLinks = pgTable('github_issue_links', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  repositoryId: uuid('repository_id').notNull().references(() => githubRepositories.id),
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
}, (table) => [uniqueIndex('github_issue_link_task_repository_unique').on(table.taskId, table.repositoryId), uniqueIndex('github_issue_link_repository_issue_unique').on(table.repositoryId, table.githubIssueId), index('github_issue_links_task_index').on(table.taskId)]);

export const githubPullRequests = pgTable('github_pull_requests', {
  id: id(),
  repositoryId: uuid('repository_id').notNull().references(() => githubRepositories.id),
  githubPullRequestId: bigint('github_pull_request_id', { mode: 'number' }).notNull(),
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
}, (table) => [uniqueIndex('github_pull_request_repository_github_unique').on(table.repositoryId, table.githubPullRequestId), uniqueIndex('github_pull_request_repository_number_unique').on(table.repositoryId, table.number), index('github_pull_requests_repository_state_index').on(table.repositoryId, table.state)]);

export const githubTaskPullRequests = pgTable('github_task_pull_requests', {
  id: id(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  pullRequestId: uuid('pull_request_id').notNull().references(() => githubPullRequests.id),
  linkKind: text('link_kind').notNull().default('closing'),
  source: text('source').notNull().default('manual'),
  ignored: boolean('ignored').notNull().default(false),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('github_task_pull_request_unique').on(table.taskId, table.pullRequestId), index('github_task_pull_requests_task_index').on(table.taskId)]);

export const githubWebhookDeliveries = pgTable('github_webhook_deliveries', {
  id: id(),
  connectionId: uuid('connection_id').references(() => githubConnections.id),
  deliveryId: text('delivery_id').notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
}, (table) => [uniqueIndex('github_webhook_delivery_unique').on(table.deliveryId), index('github_webhook_deliveries_process_index').on(table.processedAt)]);

export const integrationJobs = pgTable('integration_jobs', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
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
}, (table) => [index('integration_jobs_claim_index').on(table.status, table.runAfter), index('integration_jobs_workspace_index').on(table.workspaceId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  href: text('href').notNull().default(''),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [index('notifications_user_unread_index').on(table.userId, table.readAt, table.createdAt)]);

/** A delivery checkpoint is distinct from a continuing flow. */
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
  /** An explicit amendment is the only way to open a new decision set. */
  amendsBatchId: uuid('amends_batch_id').references((): AnyPgColumn => importBatches.id),
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
