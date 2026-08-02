import { describe, expect, it } from 'vitest';
import { proposeClaimInput, proposeDecisionInput } from '../src/memory/inputs';

describe('temporal memory contracts', () => {
  it('requires claim provenance and an increasing valid-time interval', () => {
    const base = { subject: 'auth', predicate: 'uses', value: 'JWT', classification: 'hypothesis' as const, confidenceBasisPoints: 7000 };
    expect(proposeClaimInput.safeParse(base).success).toBe(false);
    expect(proposeClaimInput.safeParse({ ...base, sourceEvidenceArtifactId: '0198babc-1234-7000-8000-000000000001', validFromAt: '2026-08-03T00:00:00+00:00', validUntilAt: '2026-08-02T00:00:00+00:00' }).success).toBe(false);
    expect(proposeClaimInput.safeParse({ ...base, sourceEvidenceArtifactId: '0198babc-1234-7000-8000-000000000001' }).success).toBe(true);
  });

  it('requires every decision proposal to cite exact evidence', () => {
    const base = { projectId: '0198babc-1234-7000-8000-000000000001', question: 'Which database?', selectedOption: 'PostgreSQL', rationale: 'Transactional control-plane state.' };
    expect(proposeDecisionInput.safeParse({ ...base, evidenceArtifactIds: [] }).success).toBe(false);
    expect(proposeDecisionInput.safeParse({ ...base, evidenceArtifactIds: ['0198babc-1234-7000-8000-000000000002'] }).success).toBe(true);
  });
});
