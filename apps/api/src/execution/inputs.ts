import { z } from 'zod';

const sha = z.string().trim().min(7).max(128);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const stringMap = z.record(z.string(), z.string()).default({});

export const gitSliceInput = z.object({
  githubRepositoryId: z.string().uuid().nullable().optional(),
  repositoryFullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  baseCommitSha: sha,
  headCommitSha: sha,
  mergeBaseSha: sha.nullable().optional(),
  branchName: z.string().trim().min(1).max(500).nullable().optional(),
  includedPaths: z.array(z.string().min(1).max(4_000)).max(1_000).default([]),
  excludedPaths: z.array(z.string().min(1).max(4_000)).max(1_000).default([]),
  diffHash: hash.nullable().optional(),
  worktreeIdentity: z.string().trim().min(1).max(1_000).nullable().optional(),
  dirtyState: z.enum(['clean', 'dirty_captured', 'dirty_missing', 'unknown']).default('unknown'),
  patchArtifactId: z.string().uuid().nullable().optional(),
  submoduleStates: stringMap,
  dependencyLockHashes: stringMap,
}).superRefine((value, context) => {
  if (value.dirtyState === 'dirty_captured' && !value.patchArtifactId) context.addIssue({ code: 'custom', message: 'A captured dirty Git slice requires a patch artifact.', path: ['patchArtifactId'] });
  if (value.dirtyState === 'clean' && value.patchArtifactId) context.addIssue({ code: 'custom', message: 'A clean Git slice cannot reference a dirty patch.', path: ['patchArtifactId'] });
});

export const nativeSessionInput = z.object({
  nativeSessionId: z.string().trim().min(1).max(1_000),
  parentNativeSessionId: z.string().trim().min(1).max(1_000).nullable().optional(),
  clientVersion: z.string().trim().min(1).max(160).nullable().optional(),
  protocolVersion: z.string().trim().min(1).max(160).nullable().optional(),
  archiveArtifactId: z.string().uuid().nullable().optional(),
  resumability: z.enum(['unknown', 'resumable', 'requires_reconciliation', 'not_resumable']).default('unknown'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const startRunInput = z.object({
  parentRunId: z.string().uuid().nullable().optional(),
  provider: z.enum(['claude', 'codex', 'human', 'other']),
  client: z.string().trim().min(1).max(160),
  agentType: z.string().trim().min(1).max(160).default('general'),
  model: z.string().trim().min(1).max(160).nullable().optional(),
  reasoningConfig: z.record(z.string(), z.unknown()).default({}),
  machineIdentity: z.string().trim().min(1).max(500),
  modifiesCode: z.boolean().default(false),
  permissions: z.record(z.string(), z.unknown()).default({}),
  startingGitSlice: gitSliceInput.optional(),
  nativeSession: nativeSessionInput.optional(),
}).superRefine((value, context) => {
  if (value.modifiesCode && !value.startingGitSlice) context.addIssue({ code: 'custom', message: 'A modifying run requires an immutable starting Git slice.', path: ['startingGitSlice'] });
});

export const appendRunEventInput = z.object({
  type: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(8).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
  artifactId: z.string().uuid().nullable().optional(),
  evidenceArtifactId: z.string().uuid().nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
});

export const checkpointInput = z.object({
  gitSliceId: z.string().uuid().nullable().optional(),
  objective: z.string().trim().min(1).max(50_000),
  summary: z.string().trim().min(1).max(50_000),
  completedWork: z.array(z.string().min(1).max(10_000)).max(500).default([]),
  remainingWork: z.array(z.string().min(1).max(10_000)).max(500).default([]),
  activeDecisionIds: z.array(z.string().uuid()).max(500).default([]),
  relevantPaths: z.array(z.string().min(1).max(4_000)).max(1_000).default([]),
  failures: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  lastVerified: z.record(z.string(), z.unknown()).default({}),
  nextAction: z.string().trim().min(1).max(50_000),
  artifactIds: z.array(z.string().uuid()).max(500).default([]),
  evidenceArtifactIds: z.array(z.string().uuid()).max(500).default([]),
  assumptions: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  coveredEventSequenceStart: z.number().int().positive().nullable().optional(),
  coveredEventSequenceEnd: z.number().int().positive().nullable().optional(),
  contextPackHash: hash.nullable().optional(),
}).superRefine((value, context) => {
  if ((value.coveredEventSequenceStart == null) !== (value.coveredEventSequenceEnd == null)) context.addIssue({ code: 'custom', message: 'Checkpoint event coverage requires both a start and an end sequence.' });
  if (value.coveredEventSequenceStart && value.coveredEventSequenceEnd && value.coveredEventSequenceStart > value.coveredEventSequenceEnd) context.addIssue({ code: 'custom', message: 'Checkpoint event coverage start must not exceed its end.' });
});

export const finishRunInput = z.object({
  status: z.enum(['completed', 'failed', 'blocked', 'cancelled']),
  outcomeSummary: z.string().max(50_000).default(''),
  tokenUsage: z.record(z.string(), z.unknown()).default({}),
  costMicros: z.number().int().nonnegative().nullable().optional(),
  endingGitSlice: gitSliceInput.optional(),
});

export const claimLeaseInput = z.object({
  activity: z.string().trim().min(1).max(500),
  writeAccess: z.boolean().default(false),
  exclusive: z.boolean().default(false),
  pathScope: z.array(z.string().trim().min(1).max(4_000)).max(1_000).default([]),
  ttlSeconds: z.number().int().min(60).max(3_600).default(900),
}).superRefine((value, context) => {
  if (value.exclusive && !value.writeAccess) context.addIssue({ code: 'custom', message: 'Only a write lease may be exclusive.', path: ['exclusive'] });
});

export const renewLeaseInput = z.object({ ttlSeconds: z.number().int().min(60).max(3_600).default(900) });

export type GitSliceInput = z.infer<typeof gitSliceInput>;
export type NativeSessionInput = z.infer<typeof nativeSessionInput>;
export type StartRunInput = z.infer<typeof startRunInput>;
export type AppendRunEventInput = z.infer<typeof appendRunEventInput>;
export type CheckpointInput = z.infer<typeof checkpointInput>;
export type FinishRunInput = z.infer<typeof finishRunInput>;
export type ClaimLeaseInput = z.infer<typeof claimLeaseInput>;
