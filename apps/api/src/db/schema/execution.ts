import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './common';
import { gitSliceDirtyState, nativeSessionResumability, runProvider, runStatus } from './enums';
import { users, workspaces } from './identity';
import { githubRepositories } from './integrations';
import { knowledgeArtifacts } from './knowledge';
import { tasks } from './work';

export const agentRuns = pgTable('agent_runs', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  parentRunId: uuid('parent_run_id'),
  provider: runProvider('provider').notNull(),
  client: text('client').notNull(),
  agentType: text('agent_type').notNull().default('general'),
  model: text('model'),
  reasoningConfig: jsonb('reasoning_config').$type<Record<string, unknown>>().notNull().default({}),
  machineIdentity: text('machine_identity').notNull(),
  modifiesCode: boolean('modifies_code').notNull().default(false),
  status: runStatus('status').notNull().default('running'),
  outcomeSummary: text('outcome_summary').notNull().default(''),
  permissions: jsonb('permissions').$type<Record<string, unknown>>().notNull().default({}),
  tokenUsage: jsonb('token_usage').$type<Record<string, unknown>>().notNull().default({}),
  costMicros: bigint('cost_micros', { mode: 'number' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [index('agent_runs_task_started_index').on(table.taskId, table.startedAt), index('agent_runs_workspace_status_index').on(table.workspaceId, table.status), index('agent_runs_parent_index').on(table.parentRunId)]);

export const gitSlices = pgTable('git_slices', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  runId: uuid('run_id').references(() => agentRuns.id),
  phase: text('phase').notNull(),
  githubRepositoryId: uuid('github_repository_id').references(() => githubRepositories.id),
  repositoryFullName: text('repository_full_name').notNull(),
  baseCommitSha: text('base_commit_sha').notNull(),
  headCommitSha: text('head_commit_sha').notNull(),
  mergeBaseSha: text('merge_base_sha'),
  branchName: text('branch_name'),
  includedPaths: jsonb('included_paths').$type<string[]>().notNull().default([]),
  excludedPaths: jsonb('excluded_paths').$type<string[]>().notNull().default([]),
  diffHash: text('diff_hash'),
  worktreeIdentity: text('worktree_identity'),
  dirtyState: gitSliceDirtyState('dirty_state').notNull().default('unknown'),
  patchArtifactId: uuid('patch_artifact_id').references(() => knowledgeArtifacts.id),
  submoduleStates: jsonb('submodule_states').$type<Record<string, string>>().notNull().default({}),
  dependencyLockHashes: jsonb('dependency_lock_hashes').$type<Record<string, string>>().notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [index('git_slices_task_index').on(table.taskId, table.capturedAt), index('git_slices_run_phase_index').on(table.runId, table.phase)]);

export const nativeSessions = pgTable('native_sessions', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  provider: runProvider('provider').notNull(),
  nativeSessionId: text('native_session_id').notNull(),
  parentNativeSessionId: text('parent_native_session_id'),
  clientVersion: text('client_version'),
  protocolVersion: text('protocol_version'),
  archiveArtifactId: uuid('archive_artifact_id').references(() => knowledgeArtifacts.id),
  resumability: nativeSessionResumability('resumability').notNull().default('unknown'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (table) => [index('native_sessions_run_index').on(table.runId), index('native_sessions_lookup_index').on(table.provider, table.nativeSessionId), uniqueIndex('native_sessions_run_native_unique').on(table.runId, table.provider, table.nativeSessionId)]);

export const runEvents = pgTable('run_events', {
  id: id(),
  sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  type: text('type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  artifactId: uuid('artifact_id').references(() => knowledgeArtifacts.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedAt: createdAt(),
}, (table) => [uniqueIndex('run_events_workspace_idempotency_unique').on(table.workspaceId, table.idempotencyKey), uniqueIndex('run_events_sequence_unique').on(table.sequence), index('run_events_run_sequence_index').on(table.runId, table.sequence)]);

export const runCheckpoints = pgTable('run_checkpoints', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  sequence: integer('sequence').notNull(),
  gitSliceId: uuid('git_slice_id').references(() => gitSlices.id),
  objective: text('objective').notNull(),
  summary: text('summary').notNull(),
  completedWork: jsonb('completed_work').$type<string[]>().notNull().default([]),
  remainingWork: jsonb('remaining_work').$type<string[]>().notNull().default([]),
  activeDecisionIds: jsonb('active_decision_ids').$type<string[]>().notNull().default([]),
  relevantPaths: jsonb('relevant_paths').$type<string[]>().notNull().default([]),
  failures: jsonb('failures').$type<Record<string, unknown>[]>().notNull().default([]),
  lastVerified: jsonb('last_verified').$type<Record<string, unknown>>().notNull().default({}),
  nextAction: text('next_action').notNull(),
  artifactIds: jsonb('artifact_ids').$type<string[]>().notNull().default([]),
  evidenceArtifactIds: jsonb('evidence_artifact_ids').$type<string[]>().notNull().default([]),
  assumptions: jsonb('assumptions').$type<Record<string, unknown>[]>().notNull().default([]),
  coveredEventSequenceStart: bigint('covered_event_sequence_start', { mode: 'number' }),
  coveredEventSequenceEnd: bigint('covered_event_sequence_end', { mode: 'number' }),
  contextPackHash: text('context_pack_hash'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [uniqueIndex('run_checkpoints_run_sequence_unique').on(table.runId, table.sequence), index('run_checkpoints_task_created_index').on(table.taskId, table.createdAt)]);

export const taskLeases = pgTable('task_leases', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  runId: uuid('run_id').notNull().references(() => agentRuns.id),
  activity: text('activity').notNull(),
  writeAccess: boolean('write_access').notNull().default(false),
  exclusive: boolean('exclusive').notNull().default(false),
  pathScope: jsonb('path_scope').$type<string[]>().notNull().default([]),
  machineIdentity: text('machine_identity').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: createdAt(),
}, (table) => [index('task_leases_task_expiry_index').on(table.taskId, table.expiresAt), index('task_leases_run_index').on(table.runId), index('task_leases_workspace_expiry_index').on(table.workspaceId, table.expiresAt)]);
