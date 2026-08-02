import { pgEnum } from 'drizzle-orm/pg-core';

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

export const runProvider = pgEnum('run_provider', ['claude', 'codex', 'human', 'other']);

export const runStatus = pgEnum('run_status', ['running', 'completed', 'failed', 'blocked', 'cancelled']);

export const nativeSessionResumability = pgEnum('native_session_resumability', ['unknown', 'resumable', 'requires_reconciliation', 'not_resumable']);

export const gitSliceDirtyState = pgEnum('git_slice_dirty_state', ['clean', 'dirty_captured', 'dirty_missing', 'unknown']);
