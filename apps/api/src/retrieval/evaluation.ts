import { createHash } from 'node:crypto';
import type { RetrievalEvaluationCase, RetrievalEvaluationInput, RetrievalEvaluationSourceRef, RetrievalIntent } from './inputs';

export type EvaluationResult = {
  document: {
    id: string;
    projectId: string;
    sourceType: string;
    sourceId: string;
    sourcePart: number;
    status: string;
    contentHash: string;
    metadata: Record<string, unknown>;
  };
  score: number;
};

export type EvaluationRun = {
  case: RetrievalEvaluationCase;
  results: EvaluationResult[];
  traceId: string;
  intent: RetrievalIntent;
};

type Gate = { passed: boolean; actual: number; operator: '>=' | '<='; threshold: number };

export function evaluateRetrievalRuns(input: RetrievalEvaluationInput, runs: EvaluationRun[]) {
  if (runs.length !== input.cases.length) throw new Error('Every evaluation case must have exactly one retrieval run.');

  const cases = runs.map((run) => evaluateCase(input.projectId, run));
  const expectedCount = cases.reduce((sum, entry) => sum + entry.expectedCount, 0);
  const matchedExpectedCount = cases.reduce((sum, entry) => sum + entry.matchedExpectedCount, 0);
  const resultCount = cases.reduce((sum, entry) => sum + entry.resultCount, 0);
  const currentEligible = cases.filter((entry) => !entry.historicalAllowed);
  const currentResultCount = currentEligible.reduce((sum, entry) => sum + entry.resultCount, 0);
  const metrics = {
    recallAtK: ratio(matchedExpectedCount, expectedCount),
    meanReciprocalRank: average(cases.map((entry) => entry.reciprocalRank)),
    currentPrecision: ratio(currentEligible.reduce((sum, entry) => sum + entry.currentResultCount, 0), currentResultCount),
    provenanceCoverage: ratio(cases.reduce((sum, entry) => sum + entry.provenanceResultCount, 0), resultCount),
    casePassRate: ratio(cases.filter((entry) => entry.passed).length, cases.length),
    forbiddenIntrusionRate: ratio(cases.reduce((sum, entry) => sum + entry.forbiddenResultCount, 0), resultCount, 0),
    crossProjectLeakageRate: ratio(cases.reduce((sum, entry) => sum + entry.leakedResultCount, 0), resultCount, 0),
    categoryCoverage: ratio(input.requiredCategories.filter((category) => cases.some((entry) => entry.category === category)).length, input.requiredCategories.length),
  };
  const gates = {
    recallAtK: minimum(metrics.recallAtK, input.thresholds.minRecallAtK),
    meanReciprocalRank: minimum(metrics.meanReciprocalRank, input.thresholds.minMeanReciprocalRank),
    currentPrecision: minimum(metrics.currentPrecision, input.thresholds.minCurrentPrecision),
    provenanceCoverage: minimum(metrics.provenanceCoverage, input.thresholds.minProvenanceCoverage),
    casePassRate: minimum(metrics.casePassRate, input.thresholds.minCasePassRate),
    forbiddenIntrusionRate: maximum(metrics.forbiddenIntrusionRate, input.thresholds.maxForbiddenIntrusionRate),
    crossProjectLeakageRate: maximum(metrics.crossProjectLeakageRate, input.thresholds.maxCrossProjectLeakageRate),
    categoryCoverage: minimum(metrics.categoryCoverage, 1),
  };
  const categories = Object.fromEntries(input.cases.map((entry) => entry.category).filter((category, index, values) => values.indexOf(category) === index).map((category) => {
    const categoryCases = cases.filter((entry) => entry.category === category);
    return [category, { cases: categoryCases.length, passed: categoryCases.filter((entry) => entry.passed).length, passRate: ratio(categoryCases.filter((entry) => entry.passed).length, categoryCases.length) }];
  }));

  return {
    suiteId: input.suiteId,
    suiteVersion: input.suiteVersion,
    suiteDefinitionHash: sha256(canonicalJson({ suiteId: input.suiteId, suiteVersion: input.suiteVersion, projectId: input.projectId, requiredCategories: input.requiredCategories, cases: input.cases })),
    projectId: input.projectId,
    embeddingProfileKey: input.embeddingProfileKey ?? null,
    requiredCategories: input.requiredCategories,
    passed: Object.values(gates).every((gate) => gate.passed),
    metrics,
    gates,
    categories,
    cases,
  };
}

function evaluateCase(projectId: string, run: EvaluationRun) {
  const expectedMatches = run.case.expectedRefs.map((expected) => run.results.findIndex((result) => matchesRef(result, expected)));
  const matchedResultIndexes = new Set(expectedMatches.filter((index) => index >= 0));
  const forbiddenResultIndexes = new Set(run.results.flatMap((result, index) => run.case.forbiddenRefs.some((forbidden) => matchesRef(result, forbidden)) ? [index] : []));
  const leakedResultIndexes = new Set(run.results.flatMap((result, index) => result.document.projectId !== projectId ? [index] : []));
  const provenanceResultCount = run.results.filter(hasProvenance).length;
  const currentResultCount = run.results.filter((result) => result.document.status === 'current').length;
  const firstRelevantIndex = expectedMatches.filter((index) => index >= 0).sort((left, right) => left - right)[0];
  const historicalAllowed = run.case.includeHistorical || run.intent === 'historical_explanation';
  const passed = expectedMatches.every((index) => index >= 0)
    && forbiddenResultIndexes.size === 0
    && leakedResultIndexes.size === 0
    && provenanceResultCount === run.results.length
    && (historicalAllowed || currentResultCount === run.results.length);

  return {
    id: run.case.id,
    category: run.case.category,
    traceId: run.traceId,
    intent: run.intent,
    includeHistorical: run.case.includeHistorical,
    historicalAllowed,
    passed,
    expectedCount: run.case.expectedRefs.length,
    matchedExpectedCount: expectedMatches.filter((index) => index >= 0).length,
    resultCount: run.results.length,
    relevantResultCount: matchedResultIndexes.size,
    forbiddenResultCount: forbiddenResultIndexes.size,
    leakedResultCount: leakedResultIndexes.size,
    provenanceResultCount,
    currentResultCount,
    recallAtK: ratio(expectedMatches.filter((index) => index >= 0).length, run.case.expectedRefs.length),
    precisionAtK: ratio(matchedResultIndexes.size, run.results.length, 0),
    reciprocalRank: firstRelevantIndex === undefined ? 0 : 1 / (firstRelevantIndex + 1),
    missingExpectedRefs: run.case.expectedRefs.filter((_expected, index) => expectedMatches[index] === -1),
    forbiddenResultIds: [...forbiddenResultIndexes].map((index) => run.results[index]!.document.id),
    leakedResultIds: [...leakedResultIndexes].map((index) => run.results[index]!.document.id),
  };
}

function matchesRef(result: EvaluationResult, expected: RetrievalEvaluationSourceRef): boolean {
  const document = result.document;
  return document.sourceType === expected.sourceType
    && document.sourceId === expected.sourceId
    && (expected.sourcePart === undefined || document.sourcePart === expected.sourcePart)
    && (expected.status === undefined || document.status === expected.status)
    && deepSubset(document.metadata, expected.metadata);
}

function deepSubset(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((value) => actual.some((candidate) => deepSubset(candidate, value)));
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => deepSubset((actual as Record<string, unknown>)[key], value));
  }
  return false;
}

function hasProvenance(result: EvaluationResult): boolean {
  const document = result.document;
  return Boolean(document.id && document.sourceType && document.sourceId && Number.isInteger(document.sourcePart) && /^[a-f0-9]{64}$/.test(document.contentHash));
}

function ratio(numerator: number, denominator: number, emptyValue = 1): number { return denominator === 0 ? emptyValue : round(numerator / denominator); }
function average(values: number[]): number { return ratio(values.reduce((sum, value) => sum + value, 0), values.length); }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function minimum(actual: number, threshold: number): Gate { return { passed: actual >= threshold, actual, operator: '>=', threshold }; }
function maximum(actual: number, threshold: number): Gate { return { passed: actual <= threshold, actual, operator: '<=', threshold }; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
