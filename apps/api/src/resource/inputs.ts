import { z } from 'zod';
import { priorities, projectStatuses } from '../common/domain';

const markdown = z.string().max(100_000);
const optionalId = z.string().uuid().nullable().optional();

export type ProjectListFilters = {
  q?: string;
  status?: string;
  priority?: string;
  health?: string;
  cursor?: string;
  limit?: string;
};

export type FlowListFilters = {
  q?: string;
  stateId?: string;
  priority?: string;
  health?: string;
  cursor?: string;
  limit?: string;
};

export type TaskListFilters = {
  q?: string;
  projectId?: string;
  flowId?: string;
  stateId?: string;
  priority?: string;
  assigneeMembershipId?: string;
  labelId?: string;
  cursor?: string;
  limit?: string;
};

export const projectInput = z.object({
  name: z.string().trim().min(1).max(160),
  issueKey: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/)
    .optional(),
  description: markdown.optional(),
  status: z.enum(projectStatuses).optional(),
  priority: z.enum(priorities).optional(),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track'] as const).optional(),
  currentFocus: markdown.optional(),
  currentStateSummary: markdown.optional(),
  repositoryReference: z.string().max(2_000).optional(),
});

export const repositoryInput = z.object({
  provider: z.string().trim().min(1).max(80).optional(),
  providerRepositoryId: z.string().trim().max(300).nullable().optional(),
  owner: z.string().trim().max(300).optional(),
  name: z.string().trim().min(1).max(300),
  fullName: z.string().trim().min(1).max(600),
  remoteUrl: z.string().trim().max(2_000).optional(),
  defaultBranch: z.string().trim().min(1).max(300).optional(),
  visibility: z.enum(['private', 'internal', 'public']).optional(),
  archived: z.boolean().optional(),
});

export const repositoryAliasInput = z.object({
  machineIdentity: z.string().trim().min(1).max(500),
  localPath: z.string().trim().min(1).max(4_000),
});
export const projectRepositoryInput = z.object({
  repositoryId: z.string().uuid(),
  role: z.enum(['primary', 'supporting']).optional(),
});

export const flowInput = z.object({
  name: z.string().trim().min(1).max(160),
  purpose: markdown.optional(),
  workflowStateId: z.string().uuid().optional(),
  priority: z.enum(priorities).optional(),
  health: z.enum(['unknown', 'on_track', 'at_risk', 'off_track'] as const).optional(),
  currentFocus: markdown.optional(),
  currentStateSummary: markdown.optional(),
  importantFindings: markdown.optional(),
  nextRecommendedAction: markdown.optional(),
  scope: z.enum(['all_projects', 'selected_projects']).optional(),
  allowedProjectIds: z.array(z.string().uuid()).max(100).optional(),
  responsibleMembershipId: optionalId,
  primaryCurrentTaskId: optionalId,
});

export const taskInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: markdown.optional(),
  objective: markdown.optional(),
  constraints: z.array(z.string().trim().min(1).max(5_000)).max(100).optional(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  expectedArtifacts: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  targetRepositoryId: optionalId,
  targetBranch: z.string().trim().max(300).optional(),
  includedPaths: z.array(z.string().trim().min(1).max(2_000)).max(500).optional(),
  excludedPaths: z.array(z.string().trim().min(1).max(2_000)).max(500).optional(),
  contextPolicy: z.record(z.string(), z.unknown()).optional(),
  memoryMode: z.enum(['isolated', 'task', 'project', 'workspace']).optional(),
  requiredApprovals: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  coordinatingMembershipId: optionalId,
  workflowStateId: z.string().uuid().optional(),
  priority: z.enum(priorities).optional(),
  assigneeMembershipId: optionalId,
  dueDate: z.string().date().nullable().optional(),
  parentTaskId: optionalId,
  primaryFlowId: optionalId,
  relatedFlowIds: z.array(z.string().uuid()).max(100).optional(),
  humanReviewRequired: z.boolean().optional(),
  reviewerMembershipId: optionalId,
  verificationRequirements: markdown.optional(),
  verificationPerformed: markdown.optional(),
  completionEvidence: markdown.optional(),
  nonGoals: markdown.optional(),
  remainingLimitations: markdown.optional(),
  followUpWork: markdown.optional(),
});

export const labelInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().max(2_000).optional(),
});
export const checklistInput = z.object({
  kind: z.enum(['readiness', 'acceptance']),
  text: z.string().trim().min(1).max(5_000),
  position: z.number().int().min(0).optional(),
});
export const criterionInput = z.object({
  text: z.string().trim().min(1).max(5_000),
  position: z.number().int().min(0).optional(),
});
export const commentInput = z.object({ body: markdown.min(1) });
export const relationInput = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string(),
  explanation: z.string().max(5_000).optional().default(''),
});
export const reviewInput = z.object({
  reviewStatus: z.enum(['pending', 'approved', 'changes_requested']),
  reviewNote: markdown.optional().default(''),
});
