import { z } from 'zod';

export const evidenceArtifactInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  runEventId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(500),
  type: z.enum(['transcript', 'tool_output', 'terminal_log', 'patch', 'build_report', 'test_result', 'screenshot', 'document', 'dependency_snapshot', 'native_session_archive', 'other']),
  mimeType: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(240),
  producer: z.string().trim().min(1).max(240),
  contentBase64: z.string().min(1).max(35_000_000),
  claimedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preview: z.string().max(20_000).default(''),
  redactionStatus: z.enum(['unreviewed', 'redacted', 'contains_sensitive']).default('unreviewed'),
  retentionPolicy: z.string().trim().min(1).max(160).default('project_default'),
}).superRefine((value, context) => {
  if (value.runEventId && !value.runId) context.addIssue({ code: 'custom', message: 'A producing run event requires runId.', path: ['runId'] });
});

export type EvidenceArtifactInput = z.infer<typeof evidenceArtifactInput>;
