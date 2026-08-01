import { describe, expect, it } from 'vitest';
import { finalizeContextPack } from '../src/portfolio-knowledge.service';

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
});
