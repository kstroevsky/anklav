import { createHash } from 'node:crypto';

export type MilestoneInput = {
  projectId: string; flowId?: string | null; name: string; description?: string;
  status?: 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'archived';
  targetDate?: string | null; taskIds?: string[];
};

export type ArtifactInput = {
  projectId?: string | null; flowId?: string | null; taskId?: string | null;
  type: 'legacy_document' | 'git_reference' | 'research' | 'specification' | 'decision' | 'evaluation' | 'handoff' | 'project_state' | 'roadmap' | 'agent_instructions';
  title: string; summary?: string; nativeContent?: string | null;
  repositoryReference?: {
    repositoryFullName: string; path: string; commitSha?: string | null;
    contentHash?: string | null; githubRepositoryId?: string | null; verificationNote?: string;
  } | null;
};

export const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function finalizeContextPack<T extends Record<string, unknown>>(pack: T): T & { contentHash: string } {
  return { ...pack, contentHash: hash(pack) };
}

export const contextPackProjections = ['max', 'standard', 'low', 'review', 'handoff'] as const;
export const contextPackAdapters = ['provider_neutral', 'claude', 'codex'] as const;

export type ContextPackProjection = typeof contextPackProjections[number];
export type ContextPackAdapter = typeof contextPackAdapters[number];
export type ContextPackOptions = {
  projection?: ContextPackProjection;
  adapter?: ContextPackAdapter;
  model?: string;
};

const SECTION_POLICIES: Record<ContextPackProjection, readonly string[]> = {
  max: ['generatedFrom', 'taskContract', 'operationalGitState', 'taskCheckpoint', 'exactEvidence', 'activeRuns', 'coordinationLeases', 'currentClaims', 'project', 'flows', 'milestones', 'acceptedDecisions', 'verifiedArtifacts', 'repositories', 'linkedGitHub', 'taskRelations', 'dependencies', 'sourceProvenance', 'latestHandoff', 'humanReview', 'blockers', 'explicitNonGoals', 'semanticRetrieval'],
  standard: ['generatedFrom', 'taskContract', 'operationalGitState', 'taskCheckpoint', 'exactEvidence', 'activeRuns', 'coordinationLeases', 'currentClaims', 'project', 'flows', 'milestones', 'acceptedDecisions', 'verifiedArtifacts', 'repositories', 'linkedGitHub', 'taskRelations', 'dependencies', 'latestHandoff', 'humanReview', 'blockers', 'explicitNonGoals', 'semanticRetrieval'],
  low: ['generatedFrom', 'taskContract', 'operationalGitState', 'taskCheckpoint', 'exactEvidence', 'coordinationLeases', 'currentClaims', 'project', 'acceptedDecisions', 'repositories', 'latestHandoff', 'humanReview', 'blockers', 'explicitNonGoals'],
  review: ['generatedFrom', 'taskContract', 'operationalGitState', 'taskCheckpoint', 'exactEvidence', 'currentClaims', 'project', 'acceptedDecisions', 'verifiedArtifacts', 'repositories', 'linkedGitHub', 'taskRelations', 'dependencies', 'humanReview', 'blockers', 'explicitNonGoals'],
  handoff: ['generatedFrom', 'taskContract', 'operationalGitState', 'taskCheckpoint', 'exactEvidence', 'activeRuns', 'coordinationLeases', 'currentClaims', 'project', 'flows', 'acceptedDecisions', 'verifiedArtifacts', 'repositories', 'taskRelations', 'dependencies', 'latestHandoff', 'blockers', 'explicitNonGoals'],
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** Compile a reproducible projection from one immutable, provider-neutral context core. */
export function compileContextPack(core: Record<string, unknown>, options: ContextPackOptions = {}) {
  const projection = options.projection ?? 'standard';
  const adapter = options.adapter ?? 'provider_neutral';
  const allowed = new Set(SECTION_POLICIES[projection]);
  const sectionNames = Object.keys(core).filter((section) => section !== 'version').sort();
  const includedSourceIds = sectionNames.filter((section) => allowed.has(section));
  const omittedSources = sectionNames.filter((section) => !allowed.has(section)).map((sourceId) => ({ sourceId, reason: `Excluded by the ${projection} projection policy.` }));
  const content = canonical(Object.fromEntries(Object.entries(core).filter(([section]) => section === 'version' || allowed.has(section)))) as Record<string, unknown>;
  const contextCoreHash = hash(canonical(core));
  const contentHash = hash(content);
  const target = { adapter, model: options.model?.trim() || null, projection };
  const packId = hash({ contextCoreHash, contentHash, target, generatorVersion: 'context-compiler/1' });
  return {
    ...content,
    contentHash,
    manifest: {
      packId,
      generatorVersion: 'context-compiler/1',
      contextCoreHash,
      target,
      includedSourceIds,
      omittedSources,
      staleSourceWarnings: [],
      estimatedTokens: Math.ceil(JSON.stringify(content).length / 4),
      retrievalTrace: [{ strategy: 'structured', semanticRetrieval: false }],
      redactionReport: { applied: false, reason: 'The context core contains structured records and pre-approved artifact previews only.' },
    },
  };
}

export function nonGoals(description: string): string[] {
  const match = description.match(/^##\s+Non-goals\s*\n([\s\S]*?)(?=^##\s|\z)/mi);
  return match?.[1]?.split('\n').map((entry) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean) ?? [];
}
