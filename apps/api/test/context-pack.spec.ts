import { describe, expect, it } from 'vitest';
import { compileContextPack, finalizeContextPack } from '../src/portfolio-knowledge.service';

describe('deterministic context packs', () => {
  it('snapshots the exact structured content before adding its content hash', () => {
    expect(finalizeContextPack({ version: '1', taskContract: { identifier: 'ANKLAV-7', acceptanceCriteria: [{ text: 'passes', completed: false }] }, verifiedArtifacts: [{ citation: { repository: 'kstroevsky/anklav', path: 'AGENTS.md', commitSha: 'abc1234', contentHash: 'a'.repeat(64) } }], semanticRetrieval: { included: false } })).toMatchInlineSnapshot(`
      {
        "contentHash": "2f7361b8e3effee066208f7b2a3c731709644626fcb4b62a5ed0edcc463ac0b8",
        "semanticRetrieval": {
          "included": false,
        },
        "taskContract": {
          "acceptanceCriteria": [
            {
              "completed": false,
              "text": "passes",
            },
          ],
          "identifier": "ANKLAV-7",
        },
        "verifiedArtifacts": [
          {
            "citation": {
              "commitSha": "abc1234",
              "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "path": "AGENTS.md",
              "repository": "kstroevsky/anklav",
            },
          },
        ],
        "version": "1",
      }
    `);
  });

  it('compiles stable provider-specific projections with an auditable manifest', () => {
    const core = {
      version: '1',
      generatedFrom: { taskId: 'task-7', taskVersion: 3 },
      taskContract: { identifier: 'ANKLAV-7', acceptanceCriteria: [{ text: 'passes', completed: false }] },
      project: { name: 'Anklav' },
      operationalGitState: { headCommitSha: 'abcdef2', dirtyState: 'clean' },
      taskCheckpoint: { nextAction: 'Run tests' },
      exactEvidence: [{ id: 'ART-1', contentHash: 'a'.repeat(64) }],
      nativeSessions: { sessions: [{ id: 'session-1', ingestionStatus: 'complete' }], transcriptContentIncluded: false },
      flows: [{ name: 'Control plane' }],
      acceptedDecisions: [{ id: 'DEC-1', summary: 'Tasks are canonical.' }],
      verifiedArtifacts: [{ id: 'ART-1' }],
      sourceProvenance: [{ sourceSystem: 'linear' }],
      blockers: [],
      explicitNonGoals: ['Do not include raw transcript content implicitly'],
    };
    const first = compileContextPack(core, { projection: 'low', adapter: 'codex', model: 'gpt-5' });
    const second = compileContextPack(core, { projection: 'low', adapter: 'codex', model: 'gpt-5' });

    expect(second).toEqual(first);
    expect(first.manifest.target).toEqual({ projection: 'low', adapter: 'codex', model: 'gpt-5' });
    expect(first.manifest.includedSourceIds).toContain('taskContract');
    expect(first.manifest.includedSourceIds).toContain('operationalGitState');
    expect(first).toHaveProperty('taskCheckpoint.nextAction', 'Run tests');
    expect(first).toHaveProperty('exactEvidence.0.id', 'ART-1');
    expect(first.manifest.omittedSources).toContainEqual({ sourceId: 'sourceProvenance', reason: 'Excluded by the low projection policy.' });
    expect(first.manifest.omittedSources).toContainEqual({ sourceId: 'nativeSessions', reason: 'Excluded by the low projection policy.' });
    expect(first).not.toHaveProperty('verifiedArtifacts');
    const standard = compileContextPack(core, { projection: 'standard' });
    expect(standard).toHaveProperty('nativeSessions.transcriptContentIncluded', false);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.manifest.packId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses canonical object ordering when hashing a context core', () => {
    const left = compileContextPack({ version: '1', taskContract: { title: 'Task', priority: 'high' }, blockers: [] });
    const right = compileContextPack({ blockers: [], taskContract: { priority: 'high', title: 'Task' }, version: '1' });
    expect(right.manifest.contextCoreHash).toBe(left.manifest.contextCoreHash);
    expect(right.contentHash).toBe(left.contentHash);
  });
});
