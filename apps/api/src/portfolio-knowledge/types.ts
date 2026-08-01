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

export function nonGoals(description: string): string[] {
  const match = description.match(/^##\s+Non-goals\s*\n([\s\S]*?)(?=^##\s|\z)/mi);
  return match?.[1]?.split('\n').map((entry) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean) ?? [];
}

