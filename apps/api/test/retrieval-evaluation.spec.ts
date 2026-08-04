import { describe, expect, it } from 'vitest';
import { evaluateRetrievalRuns, type EvaluationResult } from '../src/retrieval/evaluation';
import { retrievalEvaluationInput } from '../src/retrieval/inputs';

const projectId = '0198babc-1234-7000-8000-000000000001';
const otherProjectId = '0198babc-1234-7000-8000-000000000002';
const hash = 'a'.repeat(64);

function result(overrides: Partial<EvaluationResult['document']> = {}): EvaluationResult {
  return {
    document: {
      id: '0198babc-1234-7000-8000-000000000010',
      projectId,
      sourceType: 'decision',
      sourceId: 'decision-current',
      sourcePart: 0,
      status: 'current',
      contentHash: hash,
      metadata: { effectiveFromCommit: 'abc1234', evidenceArtifactIds: ['evidence-1'] },
      ...overrides,
    },
    score: 0.9,
  };
}

function suite() {
  return retrievalEvaluationInput.parse({
    suiteId: 'retrieval-regression',
    suiteVersion: '1.0.0',
    projectId,
    requiredCategories: ['decision_recall', 'cross_project_leakage'],
    cases: [
      {
        id: 'accepted-decision',
        category: 'decision_recall',
        query: 'Why was PostgreSQL selected?',
        expectedRefs: [{ sourceType: 'decision', sourceId: 'decision-current', status: 'current', metadata: { effectiveFromCommit: 'abc1234' } }],
        forbiddenRefs: [{ sourceType: 'decision', sourceId: 'decision-obsolete' }],
      },
      {
        id: 'cross-project-boundary',
        category: 'cross_project_leakage',
        query: 'Find the exact deployment failure',
        expectedRefs: [{ sourceType: 'evidence_preview', sourceId: 'evidence-current' }],
      },
    ],
  });
}

describe('retrieval evaluation', () => {
  it('passes a versioned suite when relevant, current, provenance-bearing results stay inside the project', () => {
    const input = suite();
    const report = evaluateRetrievalRuns(input, [
      { case: input.cases[0]!, results: [result()], traceId: 'trace-1', intent: 'architectural_decision' },
      { case: input.cases[1]!, results: [result({ sourceType: 'evidence_preview', sourceId: 'evidence-current' })], traceId: 'trace-2', intent: 'exact_error' },
    ]);
    expect(report.passed).toBe(true);
    expect(report.suiteDefinitionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.metrics).toMatchObject({ recallAtK: 1, meanReciprocalRank: 1, currentPrecision: 1, provenanceCoverage: 1, forbiddenIntrusionRate: 0, crossProjectLeakageRate: 0 });
    expect(report.categories.cross_project_leakage).toEqual({ cases: 1, passed: 1, passRate: 1 });
  });

  it('fails closed on obsolete intrusion, missing provenance, and cross-project leakage', () => {
    const input = suite();
    const report = evaluateRetrievalRuns(input, [
      { case: input.cases[0]!, results: [result({ sourceId: 'decision-obsolete', status: 'historical', contentHash: 'invalid' })], traceId: 'trace-1', intent: 'architectural_decision' },
      { case: input.cases[1]!, results: [result({ projectId: otherProjectId, sourceType: 'evidence_preview', sourceId: 'evidence-current' })], traceId: 'trace-2', intent: 'exact_error' },
    ]);
    expect(report.passed).toBe(false);
    expect(report.gates.recallAtK.passed).toBe(false);
    expect(report.gates.currentPrecision.passed).toBe(false);
    expect(report.gates.provenanceCoverage.passed).toBe(false);
    expect(report.gates.forbiddenIntrusionRate.passed).toBe(false);
    expect(report.gates.crossProjectLeakageRate.passed).toBe(false);
    expect(report.cases[0]!.missingExpectedRefs).toHaveLength(1);
    expect(report.cases[1]!.leakedResultIds).toHaveLength(1);
  });

  it('rejects duplicate case identifiers so reports remain reproducible', () => {
    const input = suite();
    expect(retrievalEvaluationInput.safeParse({ ...input, cases: [...input.cases, input.cases[0]] }).success).toBe(false);
  });

  it('fails a suite that omits a declared evaluation category', () => {
    const input = suite();
    input.requiredCategories.push('git_slice');
    const report = evaluateRetrievalRuns(input, [
      { case: input.cases[0]!, results: [result()], traceId: 'trace-1', intent: 'architectural_decision' },
      { case: input.cases[1]!, results: [result({ sourceType: 'evidence_preview', sourceId: 'evidence-current' })], traceId: 'trace-2', intent: 'exact_error' },
    ]);
    expect(report.passed).toBe(false);
    expect(report.gates.categoryCoverage).toMatchObject({ passed: false, actual: 0.666667, threshold: 1 });
  });

  it('allows historical results when the production classifier selects historical intent', () => {
    const input = suite();
    input.cases = [input.cases[0]!];
    input.requiredCategories = ['decision_recall'];
    input.cases[0]!.expectedRefs[0]!.status = 'historical';
    const report = evaluateRetrievalRuns(input, [{
      case: input.cases[0]!,
      results: [result({ status: 'historical' })],
      traceId: 'trace-1',
      intent: 'historical_explanation',
    }]);
    expect(report.cases[0]!.historicalAllowed).toBe(true);
    expect(report.cases[0]!.passed).toBe(true);
    expect(report.metrics.currentPrecision).toBe(1);
  });

  it('reports zero intrusion and leakage for an empty result set without treating precision as perfect', () => {
    const input = suite();
    input.cases = [input.cases[0]!];
    input.requiredCategories = ['decision_recall'];
    const report = evaluateRetrievalRuns(input, [{ case: input.cases[0]!, results: [], traceId: 'trace-1', intent: 'architectural_decision' }]);
    expect(report.passed).toBe(false);
    expect(report.metrics).toMatchObject({ recallAtK: 0, forbiddenIntrusionRate: 0, crossProjectLeakageRate: 0 });
    expect(report.cases[0]!.precisionAtK).toBe(0);
  });
});
