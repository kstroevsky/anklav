import { z } from 'zod';

export const RETRIEVAL_EMBEDDING_DIMENSIONS = 768;
export const retrievalSourceTypes = ['project', 'task', 'claim', 'decision', 'checkpoint', 'run_episode', 'knowledge_artifact', 'evidence_preview', 'session_episode'] as const;
export const retrievalIntents = ['current_fact', 'historical_explanation', 'similar_task', 'exact_error', 'architectural_decision', 'verification_evidence', 'broad_summary'] as const;

const embedding = z.array(z.number().finite()).length(RETRIEVAL_EMBEDDING_DIMENSIONS);

export const retrievalSearchInput = z.object({
  query: z.string().trim().min(2).max(4_000),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  sourceTypes: z.array(z.enum(retrievalSourceTypes)).max(retrievalSourceTypes.length).default([]),
  intent: z.enum(retrievalIntents).optional(),
  includeHistorical: z.boolean().default(false),
  expandRelatedTasks: z.boolean().default(true),
  embeddingModel: z.string().trim().min(1).max(160).optional(),
  queryEmbedding: embedding.optional(),
  limit: z.number().int().min(1).max(50).default(12),
}).superRefine((value, context) => {
  if ((value.embeddingModel == null) !== (value.queryEmbedding == null)) context.addIssue({ code: 'custom', message: 'Semantic retrieval requires both embeddingModel and queryEmbedding.' });
});

export const embeddingInput = z.object({
  model: z.string().trim().min(1).max(160),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  embedding,
});

export const refreshRetrievalInput = z.object({ projectId: z.string().uuid() });

export const listRetrievalDocumentsInput = z.object({
  projectId: z.string().uuid(),
  embeddingModel: z.string().trim().min(1).max(160),
  missingEmbedding: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RetrievalSearchInput = z.infer<typeof retrievalSearchInput>;
export type EmbeddingInput = z.infer<typeof embeddingInput>;
export type RefreshRetrievalInput = z.infer<typeof refreshRetrievalInput>;
export type ListRetrievalDocumentsInput = z.infer<typeof listRetrievalDocumentsInput>;
export type RetrievalIntent = z.infer<typeof retrievalSearchInput>['intent'] extends infer T ? Exclude<T, undefined> : never;
