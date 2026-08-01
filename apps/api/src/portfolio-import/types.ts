import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth';
import type { BundleRecord, MigrationBundle } from '../migration-bundle';

export type ProjectControlTaskDisposition = 'map_to_anklav' | 'archive_as_source_only' | 'cancel_as_superseded';
export type ImportOverrides = {
  sourceRepositoryVisibility?: 'accepted_public_disclosure' | 'repository_private';
  projectControlTasks?: Record<string, { disposition: ProjectControlTaskDisposition; targetProjectRef?: string }>;
  milestoneClassifications?: Record<string, 'anklav_flow' | 'anklav_milestone' | 'archive_candidate'>;
  sourceFlowDispositions?: Record<string, 'retain_as_active_flow' | 'archive_as_source_only'>;
  legacyLabels?: Record<string, 'target_label' | 'provenance_only'>;
};

export type ImportRequest = {
  bundle: string;
  workspace: string;
  overrides?: ImportOverrides;
  verifyChecksums?: boolean;
  requireSourceMappings?: boolean;
};

export type ResolvedTarget = {
  status: 'created' | 'matched' | 'skipped' | 'deferred' | 'review_required';
  targetType: string;
  targetId?: string;
  created?: boolean;
  version?: number | null;
  contentHash?: string;
};
export type ImportOutcome = Omit<ResolvedTarget, 'status'> & { status: string };
export type ImportContext = {
  bundle: MigrationBundle;
  workspaceId: string;
  batchId: string;
  externalSourceId: string;
  actor: AuthUser;
  overrides: ImportOverrides;
  targets: Map<string, ResolvedTarget>;
  anklavProjectId: string;
};

export const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
export const source = (record: BundleRecord) => record.source as BundleRecord | undefined;
export const sourceKeyFor = (kind: string, record: BundleRecord) => {
  const detail = source(record);
  return detail?.system && detail.id ? `${detail.system}:${kind}:${detail.id}` : undefined;
};

export function section(description: string, heading: string): string {
  return description.match(new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=^##\\s|$)`, 'mi'))?.[1]?.trim() ?? '';
}

export function checklist(description: string, heading: string): string[] {
  return section(description, heading).split('\\n').map((line) => line.match(/^[-*]\\s+(?:\\[[ xX]\\]\\s+)?(.+)$/)?.[1]?.trim()).filter((line): line is string => Boolean(line));
}

export function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function asDateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : null;
}

export function isProjectControlTask(record: BundleRecord): boolean {
  return record.importDisposition === 'requires_target_project_mapping';
}

