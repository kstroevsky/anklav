import { sql } from 'drizzle-orm';
import {
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
export const activitySubject = pgEnum('activity_subject', ['workspace', 'membership', 'workflow_state', 'project', 'flow', 'task', 'label', 'comment', 'task_relation', 'flow_relation', 'checklist_item']);
export const oauthTokenKind = pgEnum('oauth_token_kind', ['access', 'refresh']);

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
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('projects_workspace_index').on(table.workspaceId, table.status)]);

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
  completionEvidence: text('completion_evidence').notNull().default(''),
  remainingLimitations: text('remaining_limitations').notNull().default(''),
  followUpWork: text('follow_up_work').notNull().default(''),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedByUserId: uuid('deleted_by_user_id').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index('tasks_workspace_state_index').on(table.workspaceId, table.workflowStateId), index('tasks_project_index').on(table.projectId), index('tasks_parent_index').on(table.parentTaskId)]);

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
