import { z } from 'zod';

export const retrievalSourceTypes = ['project', 'task', 'claim', 'decision', 'checkpoint', 'run_episode', 'knowledge_artifact', 'evidence_preview', 'session_episode'] as const;
export const retrievalIntents = ['current_fact', 'historical_explanation', 'similar_task', 'exact_error', 'architectural_decision', 'verification_evidence', 'broad_summary'] as const;
export const retrievalEmbeddingJobStatuses = ['queued', 'running', 'completed', 'dead', 'superseded'] as const;
export const retrievalEvaluationCategories = ['decision_recall', 'current_vs_obsolete', 'exact_error', 'cross_task', 'git_slice', 'provenance', 'conflict_resolution', 'cross_project_leakage'] as const;

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

const evaluationSourceRef = z.object({
  sourceType: z.enum(retrievalSourceTypes),
  sourceId: z.string().trim().min(1).max(500),
  sourcePart: z.number().int().min(0).optional(),
  status: z.string().trim().min(1).max(80).optional(),
  metadata: z.record(z.string(), z.json()).default({}),
}).strict();

const evaluationThresholds = z.object({
  minRecallAtK: z.number().min(0).max(1).default(0.8),
  minMeanReciprocalRank: z.number().min(0).max(1).default(0.7),
  minCurrentPrecision: z.number().min(0).max(1).default(0.95),
  minProvenanceCoverage: z.number().min(0).max(1).default(1),
  minCasePassRate: z.number().min(0).max(1).default(0.8),
  maxForbiddenIntrusionRate: z.number().min(0).max(1).default(0),
  maxCrossProjectLeakageRate: z.number().min(0).max(1).default(0),
}).strict();

export const retrievalEvaluationInput = z.object({
  suiteId: z.string().trim().min(1).max(160),
  suiteVersion: z.string().trim().min(1).max(80),
  projectId: z.string().uuid(),
  embeddingProfileKey: z.string().trim().min(1).max(160).optional(),
  requiredCategories: z.array(z.enum(retrievalEvaluationCategories)).min(1).max(retrievalEvaluationCategories.length).default(() => [...retrievalEvaluationCategories]),
  thresholds: evaluationThresholds.default({
    minRecallAtK: 0.8,
    minMeanReciprocalRank: 0.7,
    minCurrentPrecision: 0.95,
    minProvenanceCoverage: 1,
    minCasePassRate: 0.8,
    maxForbiddenIntrusionRate: 0,
    maxCrossProjectLeakageRate: 0,
  }),
  cases: z.array(z.object({
    id: z.string().trim().min(1).max(160),
    category: z.enum(retrievalEvaluationCategories),
    query: z.string().trim().min(2).max(4_000),
    taskId: z.string().uuid().optional(),
    sourceTypes: z.array(z.enum(retrievalSourceTypes)).max(retrievalSourceTypes.length).default([]),
    intent: z.enum(retrievalIntents).optional(),
    includeHistorical: z.boolean().default(false),
    expandRelatedTasks: z.boolean().default(true),
    limit: z.number().int().min(1).max(50).default(12),
    expectedRefs: z.array(evaluationSourceRef).min(1).max(100),
    forbiddenRefs: z.array(evaluationSourceRef).max(100).default([]),
  }).strict()).min(1).max(100).superRefine((cases, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of cases.entries()) {
      if (seen.has(entry.id)) context.addIssue({ code: 'custom', message: `Duplicate evaluation case id: ${entry.id}`, path: [index, 'id'] });
      seen.add(entry.id);
    }
  }),
}).strict().superRefine((input, context) => {
  const duplicates = input.requiredCategories.filter((category, index, values) => values.indexOf(category) !== index);
  if (duplicates.length) context.addIssue({ code: 'custom', message: `Duplicate required categories: ${[...new Set(duplicates)].join(', ')}`, path: ['requiredCategories'] });
});

export type RetrievalSearchInput = z.infer<typeof retrievalSearchInput>;
export type RefreshRetrievalInput = z.infer<typeof refreshRetrievalInput>;
export type ListRetrievalDocumentsInput = z.infer<typeof listRetrievalDocumentsInput>;
export type ListEmbeddingJobsInput = z.infer<typeof listEmbeddingJobsInput>;
export type RetrievalEvaluationInput = z.infer<typeof retrievalEvaluationInput>;
export type RetrievalEvaluationCase = RetrievalEvaluationInput['cases'][number];
export type RetrievalEvaluationSourceRef = RetrievalEvaluationCase['expectedRefs'][number];
export type RetrievalIntent = z.infer<typeof retrievalSearchInput>['intent'] extends infer T ? Exclude<T, undefined> : never;
