import { z } from 'zod';

export const proposeClaimInput = z.object({
  projectId: z.string().uuid().nullable().optional(), taskId: z.string().uuid().nullable().optional(), runId: z.string().uuid().nullable().optional(),
  subject: z.string().trim().min(1).max(500), predicate: z.string().trim().min(1).max(240), value: z.unknown(),
  classification: z.enum(['verified_current_fact', 'accepted_decision', 'evidence_backed_inference', 'hypothesis', 'obsolete_or_contradicted', 'human_decision_required']), confidenceBasisPoints: z.number().int().min(0).max(10_000),
  validFromAt: z.string().datetime({ offset: true }).nullable().optional(), validUntilAt: z.string().datetime({ offset: true }).nullable().optional(), validFromCommit: z.string().min(7).max(128).nullable().optional(), validUntilCommit: z.string().min(7).max(128).nullable().optional(),
  sourceEvidenceArtifactId: z.string().uuid().nullable().optional(), sourceKnowledgeArtifactId: z.string().uuid().nullable().optional(), sourceSpan: z.record(z.string(), z.unknown()).default({}), extraction: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, context) => {
  if (Boolean(value.sourceEvidenceArtifactId) === Boolean(value.sourceKnowledgeArtifactId)) context.addIssue({ code: 'custom', message: 'A claim requires exactly one evidence or knowledge-artifact source.' });
  if (value.validFromAt && value.validUntilAt && new Date(value.validFromAt) >= new Date(value.validUntilAt)) context.addIssue({ code: 'custom', message: 'Claim valid time must be an increasing interval.' });
});

export const proposeDecisionInput = z.object({
  projectId: z.string().uuid(), taskId: z.string().uuid().nullable().optional(), proposedByRunId: z.string().uuid().nullable().optional(), question: z.string().trim().min(1).max(2_000), selectedOption: z.string().trim().min(1).max(10_000), rejectedAlternatives: z.array(z.string().min(1).max(10_000)).max(100).default([]), rationale: z.string().trim().min(1).max(50_000), consequences: z.array(z.string().min(1).max(10_000)).max(100).default([]), effectiveRepository: z.string().regex(/^[^/\s]+\/[^/\s]+$/).nullable().optional(), effectiveFromCommit: z.string().min(7).max(128).nullable().optional(), evidenceArtifactIds: z.array(z.string().uuid()).min(1).max(100),
});

export const resolutionInput = z.object({ action: z.enum(['accept', 'reject']), note: z.string().trim().min(1).max(20_000) });
export const supersedeInput = z.object({ replacementId: z.string().uuid(), note: z.string().trim().min(1).max(20_000), validUntilAt: z.string().datetime({ offset: true }).nullable().optional(), validUntilCommit: z.string().min(7).max(128).nullable().optional() });

export type ProposeClaimInput = z.infer<typeof proposeClaimInput>;
export type ProposeDecisionInput = z.infer<typeof proposeDecisionInput>;
