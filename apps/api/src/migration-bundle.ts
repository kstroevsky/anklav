import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

const manifestSchema = z.object({
  schemaVersion: z.literal('1.2.0'),
  generatedAt: z.string().datetime(),
  sourceSnapshot: z.object({ capturedAt: z.string().datetime(), mode: z.literal('live-linear-graphql') }),
  bundle: z.object({ path: z.literal('migration/anklav/v1'), version: z.literal('v1') }),
  safeguards: z.array(z.string()).min(1),
}).strict();

const sourceMappingSchema = z.object({
  sourceSystem: z.string().min(1), sourceKind: z.string().min(1), sourceId: z.string().min(1), sourceKey: z.string().min(1),
  sourceUrl: z.string().url().optional(), targetType: z.string().min(1), targetRef: z.string().min(1), importKey: z.string().regex(/^[a-f0-9]{64}$/),
  targetId: z.string().nullable(), importStatus: z.string().min(1),
}).strict();

const taskSchema = z.object({
  ref: z.string().startsWith('task:linear:issue:'),
  source: z.object({ system: z.literal('linear'), id: z.string().min(1), url: z.string().url(), identifier: z.string().min(1) }),
  importKey: z.string().regex(/^[a-f0-9]{64}$/), projectRef: z.string().nullable(), targetProjectRef: z.string().nullable(),
  importDisposition: z.enum(['create_or_match', 'requires_target_project_mapping']), title: z.string().min(1), description: z.string(),
  status: z.object({ semantic: z.enum(['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled']) }),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']), labels: z.array(z.unknown()), milestone: z.unknown(), evidence: z.string(), githubLinks: z.array(z.string().url()),
  branchHint: z.string().nullable(), dates: z.object({}).passthrough(), provenance: z.object({}).passthrough(),
}).passthrough();

const projectSchema = z.object({ ref: z.string().startsWith('project:'), name: z.string().min(1), migrationRole: z.enum(['product', 'source_system']), createActiveTargetProject: z.boolean(), importActiveTasks: z.boolean() }).passthrough();
const workflowSchema = z.object({ ref: z.string().startsWith('workflow-state:'), semantic: z.enum(['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled']), importDisposition: z.enum(['target_workflow', 'legacy_mapping_only']), importKey: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();
const labelSchema = z.object({ ref: z.string().startsWith('label:'), importDisposition: z.enum(['target_label', 'legacy_or_workspace_label']), importKey: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();
const milestoneSchema = z.object({ sourceMilestone: z.string().min(1), sourceLinearId: z.string().min(1), proposedTarget: z.enum(['anklav_flow', 'anklav_milestone', 'archive_candidate', 'human_review_required']), reviewRequired: z.boolean(), taskRefs: z.array(z.string()) }).passthrough();

export type BundleRecord = Record<string, unknown>;
export type MigrationBundle = {
  root: string;
  manifest: z.infer<typeof manifestSchema>;
  schema: BundleRecord;
  checksums: Map<string, string>;
  bundleChecksum: string;
  expectedCounts: Record<string, number>;
  records: Record<string, BundleRecord[]>;
  conflicts: BundleRecord[];
  sourceOfTruth: BundleRecord;
  importContract: BundleRecord;
};

const ndjsonFiles = [
  'activity.ndjson', 'chat-session-metadata.ndjson', 'comments.ndjson', 'knowledge-artifact-candidates.ndjson', 'labels.ndjson',
  'linear-documents.ndjson', 'linear-milestones.ndjson', 'milestone-classifications.ndjson', 'projects.ndjson', 'repository-context.ndjson',
  'repository-evidence.ndjson', 'source-mappings.ndjson', 'tasks.ndjson', 'workflow-states.ndjson',
] as const;

const countFiles: Record<string, string> = {
  workspace: 'workspace.json', teams: 'source-mappings.ndjson', initiatives: 'source-mappings.ndjson', projects: 'projects.ndjson', workflowStates: 'workflow-states.ndjson', labels: 'labels.ndjson',
  sourceMilestones: 'linear-milestones.ndjson', milestoneClassifications: 'milestone-classifications.ndjson', tasks: 'tasks.ndjson', comments: 'comments.ndjson', activity: 'activity.ndjson',
  linearDocuments: 'linear-documents.ndjson', repositoryEvidence: 'repository-evidence.ndjson', repositoryContextMappings: 'repository-context.ndjson', knowledgeArtifactCandidates: 'knowledge-artifact-candidates.ndjson',
  privacySafeChatMetadata: 'chat-session-metadata.ndjson', sourceMappings: 'source-mappings.ndjson', unresolvedConflicts: 'unresolved-conflicts.json',
};

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }

function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || value.includes('\\')) throw new BadRequestException(`Unsafe bundle path: ${value}`);
  const normalized = normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) throw new BadRequestException(`Unsafe bundle path: ${value}`);
  return normalized;
}

async function listFiles(root: string, child = ''): Promise<string[]> {
  const directory = resolve(root, child);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = child ? `${child}/${entry.name}` : entry.name;
    const fullPath = resolve(root, relativePath);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) throw new BadRequestException(`Symlinks are not allowed in a migration bundle: ${relativePath}`);
    if (stat.isDirectory()) files.push(...await listFiles(root, relativePath));
    else if (stat.isFile()) files.push(relativePath);
    else throw new BadRequestException(`Unsupported bundle entry: ${relativePath}`);
  }
  return files.sort();
}

async function boundedRead(root: string, relativePath: string): Promise<Buffer> {
  const safePath = safeRelativePath(relativePath);
  const fullPath = resolve(root, safePath);
  if (relative(root, fullPath).startsWith('..')) throw new BadRequestException(`Bundle path escapes its root: ${relativePath}`);
  const stat = await lstat(fullPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new BadRequestException(`Invalid bundle file: ${relativePath}`);
  if (stat.size > MAX_FILE_BYTES) throw new BadRequestException(`Bundle file exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
  return readFile(fullPath);
}

function parseNdjson(name: string, bytes: Buffer): BundleRecord[] {
  if (!bytes.length) return [];
  return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new BadRequestException(`${name}:${index + 1} exceeds the record-size limit.`);
    try { return JSON.parse(line) as BundleRecord; } catch { throw new BadRequestException(`${name}:${index + 1} is not valid JSON.`); }
  });
}

function validateRecords(records: Record<string, BundleRecord[]>): void {
  const validate = (name: string, schema: z.ZodType) => records[name]?.forEach((record, index) => {
    const result = schema.safeParse(record);
    if (!result.success) throw new BadRequestException(`${name}:${index + 1} does not match bundle schema: ${result.error.issues[0]?.message}`);
  });
  validate('projects.ndjson', projectSchema);
  validate('workflow-states.ndjson', workflowSchema);
  validate('labels.ndjson', labelSchema);
  validate('milestone-classifications.ndjson', milestoneSchema);
  validate('tasks.ndjson', taskSchema);
  validate('source-mappings.ndjson', sourceMappingSchema);
}

function sourceMappingsByKind(records: BundleRecord[], kind: string): number {
  return records.filter((record) => record.sourceKind === kind).length;
}

function reconcileExpectedCounts(expected: Record<string, number>, records: Record<string, BundleRecord[]>, workspace: BundleRecord, conflicts: BundleRecord[]): void {
  const actual: Record<string, number> = {
    workspace: Object.keys(workspace).length ? 1 : 0,
    teams: sourceMappingsByKind(records['source-mappings.ndjson'] ?? [], 'team'),
    initiatives: sourceMappingsByKind(records['source-mappings.ndjson'] ?? [], 'initiative'),
    projects: records['projects.ndjson']?.length ?? 0,
    workflowStates: records['workflow-states.ndjson']?.length ?? 0,
    labels: records['labels.ndjson']?.length ?? 0,
    sourceMilestones: records['linear-milestones.ndjson']?.length ?? 0,
    milestoneClassifications: records['milestone-classifications.ndjson']?.length ?? 0,
    tasks: records['tasks.ndjson']?.length ?? 0,
    comments: records['comments.ndjson']?.length ?? 0,
    activity: records['activity.ndjson']?.length ?? 0,
    linearDocuments: records['linear-documents.ndjson']?.length ?? 0,
    repositoryEvidence: records['repository-evidence.ndjson']?.length ?? 0,
    repositoryContextMappings: records['repository-context.ndjson']?.length ?? 0,
    knowledgeArtifactCandidates: records['knowledge-artifact-candidates.ndjson']?.length ?? 0,
    privacySafeChatMetadata: records['chat-session-metadata.ndjson']?.length ?? 0,
    sourceMappings: records['source-mappings.ndjson']?.length ?? 0,
    unresolvedConflicts: conflicts.length,
  };
  for (const [name, count] of Object.entries(expected)) {
    if (actual[name] !== count) throw new BadRequestException(`Expected ${name} count ${count}, received ${actual[name] ?? 0}.`);
  }
}

/** Validates the immutable neutral bundle before any database operation. */
export async function loadMigrationBundle(bundlePath: string, verifyChecksums = true): Promise<MigrationBundle> {
  const inputStat = await lstat(bundlePath).catch(() => undefined);
  if (!inputStat?.isDirectory() || inputStat.isSymbolicLink()) throw new BadRequestException('The bundle must be a real directory, not a symlink.');
  const root = await realpath(bundlePath);
  const files = await listFiles(root);
  const checksumBytes = await boundedRead(root, 'checksums.sha256');
  const checksums = new Map<string, string>();
  for (const line of checksumBytes.toString('utf8').trim().split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    if (!match) throw new BadRequestException('checksums.sha256 has an invalid entry.');
    const name = safeRelativePath(match[2]!);
    if (checksums.has(name)) throw new BadRequestException(`checksums.sha256 duplicates ${name}.`);
    checksums.set(name, match[1]!);
  }
  const nonChecksumFiles = files.filter((file) => file !== 'checksums.sha256');
  if (checksums.size !== nonChecksumFiles.length || nonChecksumFiles.some((file) => !checksums.has(file))) {
    throw new BadRequestException('Every immutable bundle file except checksums.sha256 must have exactly one checksum entry.');
  }
  let totalBytes = checksumBytes.byteLength;
  const raw = new Map<string, Buffer>();
  for (const name of nonChecksumFiles) {
    const bytes = await boundedRead(root, name);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_BUNDLE_BYTES) throw new BadRequestException(`Bundle exceeds ${MAX_BUNDLE_BYTES} bytes.`);
    if (verifyChecksums && sha256(bytes) !== checksums.get(name)) throw new BadRequestException(`Checksum mismatch: ${name}`);
    raw.set(name, bytes);
  }
  for (const required of ['manifest.json', 'schema.json', 'expected-counts.json', 'import-contract.json', 'source-of-truth.json', 'unresolved-conflicts.json', 'workspace.json', ...ndjsonFiles]) {
    if (!raw.has(required)) throw new BadRequestException(`Required bundle file is missing: ${required}`);
  }
  const parseJson = (name: string): BundleRecord => {
    try { return JSON.parse(raw.get(name)!.toString('utf8')) as BundleRecord; } catch { throw new BadRequestException(`${name} is not valid JSON.`); }
  };
  const manifest = manifestSchema.parse(parseJson('manifest.json'));
  const schema = parseJson('schema.json');
  if (schema.schemaVersion !== '1.2.0' || schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new BadRequestException('schema.json is not the supported neutral bundle schema.');
  const expectedCounts = z.record(z.string(), z.number().int().nonnegative()).parse(parseJson('expected-counts.json'));
  const records = Object.fromEntries(ndjsonFiles.map((name) => [name, parseNdjson(name, raw.get(name)!)])) as Record<string, BundleRecord[]>;
  validateRecords(records);
  const conflictsParsed = parseJson('unresolved-conflicts.json');
  const conflicts = z.array(z.object({ code: z.string().min(1), severity: z.enum(['blocking', 'prerequisite', 'review', 'warning']), message: z.string().min(1) }).passthrough()).parse(conflictsParsed);
  const sourceMappings = records['source-mappings.ndjson']!;
  if (new Set(sourceMappings.map((record) => record.sourceKey)).size !== sourceMappings.length || new Set(sourceMappings.map((record) => record.importKey)).size !== sourceMappings.length) throw new BadRequestException('source-mappings.ndjson contains duplicate sourceKey or importKey values.');
  reconcileExpectedCounts(expectedCounts, records, parseJson('workspace.json'), conflicts);
  return { root, manifest, schema, checksums, bundleChecksum: sha256(checksumBytes), expectedCounts, records, conflicts, sourceOfTruth: parseJson('source-of-truth.json'), importContract: parseJson('import-contract.json') };
}

export function assertVerificationOutputOutsideBundle(bundleRoot: string, reportPath: string): string {
  const absoluteRoot = resolve(bundleRoot);
  const absoluteReport = resolve(reportPath);
  if (absoluteReport === absoluteRoot || absoluteReport.startsWith(`${absoluteRoot}${sep}`) || basename(absoluteReport) !== 'anklav-import-verification.json') {
    throw new BadRequestException('Verification output must be named anklav-import-verification.json and be outside the immutable bundle directory.');
  }
  return absoluteReport;
}
