import type { RetrievalIntent } from './inputs';

type ScoreParts = { intent: RetrievalIntent; lexical: number; semantic: number; authority: number; affinity: number; recency: number };

const weights: Record<RetrievalIntent, Omit<ScoreParts, 'intent'>> = {
  current_fact: { lexical: 0.2, semantic: 0.3, authority: 0.25, affinity: 0.15, recency: 0.1 },
  historical_explanation: { lexical: 0.2, semantic: 0.3, authority: 0.15, affinity: 0.15, recency: 0.2 },
  similar_task: { lexical: 0.15, semantic: 0.45, authority: 0.1, affinity: 0.15, recency: 0.15 },
  exact_error: { lexical: 0.5, semantic: 0.15, authority: 0.15, affinity: 0.15, recency: 0.05 },
  architectural_decision: { lexical: 0.2, semantic: 0.3, authority: 0.3, affinity: 0.15, recency: 0.05 },
  verification_evidence: { lexical: 0.25, semantic: 0.2, authority: 0.3, affinity: 0.15, recency: 0.1 },
  broad_summary: { lexical: 0.15, semantic: 0.35, authority: 0.25, affinity: 0.1, recency: 0.15 },
};

export function classifyRetrievalIntent(query: string): RetrievalIntent {
  const normalized = query.toLowerCase();
  if (/\b(error|exception|failed|failure|ts\d{3,5}|[a-f0-9]{7,40}|[\w./-]+\.(ts|tsx|js|py|rs|go|java))\b/.test(normalized)) return 'exact_error';
  if (/\b(why|history|historical|previously|used to|last year|changed)\b/.test(normalized)) return 'historical_explanation';
  if (/\b(decision|rationale|architecture|architectural|adr)\b/.test(normalized)) return 'architectural_decision';
  if (/\b(similar|related|analogous|past task)\b/.test(normalized)) return 'similar_task';
  if (/\b(verify|verification|evidence|test result|proof)\b/.test(normalized)) return 'verification_evidence';
  if (/\b(summary|overview|landscape|across the project)\b/.test(normalized)) return 'broad_summary';
  return 'current_fact';
}

export function hybridScore(parts: ScoreParts): number {
  const selected = weights[parts.intent];
  const score = selected.lexical * clamp(parts.lexical) + selected.semantic * clamp(parts.semantic) + selected.authority * clamp(parts.authority) + selected.affinity * clamp(parts.affinity) + selected.recency * clamp(parts.recency);
  return Math.round(clamp(score) * 1_000_000) / 1_000_000;
}

export function retrievalWeights(intent: RetrievalIntent) { return weights[intent]; }

function clamp(value: number) { return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)); }
