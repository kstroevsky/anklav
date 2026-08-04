import { z } from 'zod';

export const retrievalSourceTypes = ['project', 'task', 'claim', 'decision', 'checkpoint', 'run_episode', 'knowledge_artifact', 'evidence_preview', 'session_episode'] as const;
export const retrievalIntents = ['current_fact', 'historical_explanation', 'similar_task', 'exact_error', 'architectural_decision', 'verification_evidence', 'broad_summary'] as const;

const embedding = z.array(z.number().finite()).min(1).max(2_000);

export const retrievalSearchInput = z.object({
  query: z.string().trim().min(2).max(4_000),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  sourceTypes: z.array(z.enum(retrievalSourceTypes)).max(retrievalSourceTypes.length).default([]),
  intent: z.enum(retrievalIntents).optional(),
  includeHistorical: z.boolean().default(false),
  expandRelatedTasks: z.boolean().default(true),
  embeddingProfileKey: z.string().trim().min(1).max(160).optional(),
  queryEmbedding: embedding.optional(),
  limit: z.number().int().min(1).max(50).default(12),
}).superRefine((value, context) => {
  if ((value.embeddingProfileKey == null) !== (value.queryEmbedding == null)) context.addIssue({ code: 'custom', message: 'Semantic retrieval requires both embeddingProfileKey and queryEmbedding.' });
});

export const refreshRetrievalInput = z.object({ projectId: z.string().uuid() });

export const listRetrievalDocumentsInput = z.object({
  projectId: z.string().uuid(),
  embeddingProfileKey: z.string().trim().min(1).max(160),
  missingEmbedding: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RetrievalSearchInput = z.infer<typeof retrievalSearchInput>;
export type RefreshRetrievalInput = z.infer<typeof refreshRetrievalInput>;
export type ListRetrievalDocumentsInput = z.infer<typeof listRetrievalDocumentsInput>;
export type RetrievalIntent = z.infer<typeof retrievalSearchInput>['intent'] extends infer T ? Exclude<T, undefined> : never;
