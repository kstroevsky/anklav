import { z } from 'zod';

export const retrievalSourceTypes = ['project', 'task', 'claim', 'decision', 'checkpoint', 'run_episode', 'knowledge_artifact', 'evidence_preview', 'session_episode'] as const;
export const retrievalIntents = ['current_fact', 'historical_explanation', 'similar_task', 'exact_error', 'architectural_decision', 'verification_evidence', 'broad_summary'] as const;
export const retrievalEmbeddingJobStatuses = ['queued', 'running', 'completed', 'dead', 'superseded'] as const;

export const retrievalSearchInput = z.object({
  query: z.string().trim().min(2).max(4_000),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  sourceTypes: z.array(z.enum(retrievalSourceTypes)).max(retrievalSourceTypes.length).default([]),
  intent: z.enum(retrievalIntents).optional(),
  includeHistorical: z.boolean().default(false),
  expandRelatedTasks: z.boolean().default(true),
  embeddingProfileKey: z.string().trim().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(50).default(12),
}).strict();

export const refreshRetrievalInput = z.object({ projectId: z.string().uuid() });

export const listRetrievalDocumentsInput = z.object({
  projectId: z.string().uuid(),
  embeddingProfileKey: z.string().trim().min(1).max(160),
  missingEmbedding: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listEmbeddingJobsInput = z.object({
  projectId: z.string().uuid(),
  status: z.enum(retrievalEmbeddingJobStatuses).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export type RetrievalSearchInput = z.infer<typeof retrievalSearchInput>;
export type RefreshRetrievalInput = z.infer<typeof refreshRetrievalInput>;
export type ListRetrievalDocumentsInput = z.infer<typeof listRetrievalDocumentsInput>;
export type ListEmbeddingJobsInput = z.infer<typeof listEmbeddingJobsInput>;
export type RetrievalIntent = z.infer<typeof retrievalSearchInput>['intent'] extends infer T ? Exclude<T, undefined> : never;
