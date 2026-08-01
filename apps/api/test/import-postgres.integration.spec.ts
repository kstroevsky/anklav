import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { AuthUser } from '../src/auth';
import { ActivityService } from '../src/activity.service';
import { DatabaseService } from '../src/db/database.service';
import { externalObjectMappings, importBatches, importVerifications, knowledgeArtifacts, projects, tasks, users } from '../src/db/schema';
import { GitHubService } from '../src/github';
import { PortfolioImportService, type ImportOverrides } from '../src/portfolio-import.service';
import { PortfolioImportController } from '../src/portfolio-import.controller';
import { PortfolioKnowledgeService } from '../src/portfolio-knowledge.service';
import { ResourceService } from '../src/resource.service';
import { WorkspaceService } from '../src/workspace.service';

const describePostgres = process.env.DATABASE_URL ? describe : describe.skip;
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hashKey = (value: string) => sha(`fixture:${value}`);
const validOverrides: ImportOverrides = {
  sourceRepositoryVisibility: 'accepted_public_disclosure',
  projectControlTasks: { 'task:linear:issue:pc-1': { disposition: 'archive_as_source_only' } },
  milestoneClassifications: { 'milestone-review': 'archive_candidate' },
};

/** A deliberately small, credential-free schema-1.2.0 bundle used only for PostgreSQL integration checks. */
async function writeSanitizedFixture(root: string) {
  const records: Record<string, unknown> = {
    'manifest.json': { schemaVersion: '1.2.0', generatedAt: '2026-08-01T00:00:00.000Z', sourceSnapshot: { capturedAt: '2026-08-01T00:00:00.000Z', mode: 'live-linear-graphql' }, bundle: { path: 'migration/anklav/v1', version: 'v1' }, safeguards: ['sanitized fixture'] },
    'schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', schemaVersion: '1.2.0' },
    'workspace.json': { id: 'fixture-workspace', name: 'Personal R&D' },
    'source-of-truth.json': { portfolio: 'Anklav' },
    'import-contract.json': { verificationReport: '../verification/anklav-import-verification.json' },
    'unresolved-conflicts.json': [
      { code: 'source-repository-visibility-undecided', severity: 'blocking', message: 'Record the public-source decision.' },
      { code: 'project-control-target-project-required', severity: 'blocking', message: 'Map or archive source-system work.' },
      { code: 'milestone-human-review-required', severity: 'review', message: 'Classify the review milestone.' },
    ],
    'projects.ndjson': [
      { ref: 'project:product', name: 'Fixture Product', migrationRole: 'product', createActiveTargetProject: true, importActiveTasks: false, repository: { fullName: 'example/fixture-product' } },
      { ref: 'project:project-control', name: 'Project Control Infrastructure', migrationRole: 'source_system', createActiveTargetProject: false, importActiveTasks: true },
    ],
    'workflow-states.ndjson': [
      { ref: 'workflow-state:linear:planned', importKey: hashKey('planned'), importDisposition: 'target_workflow', semantic: 'planned', source: { name: 'Planned', color: '#64748b', position: 1 } },
      { ref: 'workflow-state:linear:in-progress', importKey: hashKey('progress'), importDisposition: 'target_workflow', semantic: 'in_progress', source: { name: 'In Progress', color: '#0ea5e9', position: 2 } },
    ],
    'labels.ndjson': [],
    'linear-milestones.ndjson': [
      { ref: 'milestone:linear:product-1', projectRef: 'project:product', proposedTarget: 'anklav_milestone', source: { id: 'milestone-product', name: 'Fixture delivery', description: 'A concrete delivery checkpoint.', targetDate: '2026-09-01' } },
      { ref: 'milestone:linear:control-1', projectRef: 'project:project-control', proposedTarget: 'anklav_flow', source: { id: 'milestone-control', name: 'Linear bootstrap', description: 'Legacy source grouping.' } },
    ],
    'milestone-classifications.ndjson': [
      { sourceMilestone: 'Fixture delivery', sourceLinearId: 'milestone-product', proposedTarget: 'anklav_milestone', reviewRequired: false, taskRefs: ['task:linear:issue:product-1'] },
      { sourceMilestone: 'Legacy review', sourceLinearId: 'milestone-review', proposedTarget: 'human_review_required', reviewRequired: true, taskRefs: [] },
    ],
    'tasks.ndjson': [
      { ref: 'task:linear:issue:product-1', source: { system: 'linear', id: 'product-1', url: 'https://linear.app/fixture/issue/RND-100', identifier: 'RND-100' }, importKey: hashKey('task-product'), projectRef: 'project:product', targetProjectRef: 'project:product', importDisposition: 'create_or_match', title: 'Import safely', description: '## Verification required\n- Run the migration verifier\n\n## Non-goals\n- Do not ingest sessions\n\n## Follow-up work\n- Review report', status: { semantic: 'planned' }, priority: 'high', labels: [], milestone: { sourceId: 'milestone-product' }, evidence: 'Current source evidence, not completion proof.', githubLinks: ['https://github.com/example/fixture-product/issues/1'], branchHint: null, dates: { dueDate: '2026-09-10', startedAt: '2026-08-01T10:00:00.000Z' }, provenance: {} },
      { ref: 'task:linear:issue:pc-1', source: { system: 'linear', id: 'pc-1', url: 'https://linear.app/fixture/issue/RND-101', identifier: 'RND-101' }, importKey: hashKey('task-control'), projectRef: 'project:project-control', targetProjectRef: null, importDisposition: 'requires_target_project_mapping', title: 'Retire Linear bootstrap', description: '', status: { semantic: 'in_progress' }, priority: 'medium', labels: [], milestone: { sourceId: 'milestone-control' }, evidence: '', githubLinks: [], branchHint: null, dates: { cancelledAt: '2026-08-02T10:00:00.000Z' }, provenance: {} },
    ],
    'linear-documents.ndjson': [{ ref: 'document:linear:doc-1', projectRef: 'project:product', title: 'Fixture legacy document', content: 'Legacy source material only.', canonicalPath: 'docs/fixture.md' }],
    'knowledge-artifact-candidates.ndjson': [{ projectRef: 'project:product', path: 'docs/fixture.md', reason: 'Candidate Git-backed canonical document.' }],
    'repository-context.ndjson': [], 'repository-evidence.ndjson': [], 'activity.ndjson': [], 'comments.ndjson': [], 'chat-session-metadata.ndjson': [],
    'source-mappings.ndjson': [],
    'expected-counts.json': {},
  };
  const mapping = (sourceKind: string, sourceId: string, targetType: string, targetRef: string) => ({ sourceSystem: 'linear', sourceKind, sourceId, sourceKey: `linear:${sourceKind}:${sourceId}`, sourceUrl: sourceKind === 'issue' ? `https://linear.app/fixture/issue/${sourceId === 'product-1' ? 'RND-100' : 'RND-101'}` : `https://linear.app/fixture/${sourceKind}/${sourceId}`, targetType, targetRef, importKey: hashKey(`mapping:${sourceKind}:${sourceId}`), targetId: null, importStatus: 'pending' });
  records['source-mappings.ndjson'] = [
    mapping('workspace', 'fixture-workspace', 'workspace', 'workspace:fixture'), mapping('workflow_state', 'planned', 'workflow_state', 'workflow-state:linear:planned'), mapping('workflow_state', 'in-progress', 'workflow_state', 'workflow-state:linear:in-progress'),
    mapping('project', 'product', 'project', 'project:product'), mapping('milestone', 'milestone-product', 'milestone', 'milestone:linear:product-1'), mapping('milestone', 'milestone-control', 'flow', 'milestone:linear:control-1'),
    mapping('issue', 'product-1', 'task', 'task:linear:issue:product-1'), mapping('issue', 'pc-1', 'task', 'task:linear:issue:pc-1'), mapping('document', 'doc-1', 'knowledge_artifact', 'document:linear:doc-1'),
  ];
  records['expected-counts.json'] = { workspace: 1, teams: 0, initiatives: 0, projects: 2, workflowStates: 2, labels: 0, sourceMilestones: 2, milestoneClassifications: 2, tasks: 2, comments: 0, activity: 0, linearDocuments: 1, repositoryEvidence: 0, repositoryContextMappings: 0, knowledgeArtifactCandidates: 1, privacySafeChatMetadata: 0, sourceMappings: 9, unresolvedConflicts: 3 };
  const write = async (name: string, value: unknown) => writeFile(join(root, name), name.endsWith('.ndjson') ? (value as unknown[]).map((entry) => JSON.stringify(entry)).join('\n') + ((value as unknown[]).length ? '\n' : '') : `${JSON.stringify(value, null, 2)}\n`);
  for (const [name, value] of Object.entries(records)) await write(name, value);
  const names = Object.keys(records).sort();
  const lines: string[] = [];
  for (const name of names) lines.push(`${sha(await (await import('node:fs/promises')).readFile(join(root, name)))}  ${name}`);
  await writeFile(join(root, 'checksums.sha256'), `${lines.join('\n')}\n`);
}

describePostgres('Phase 1.1 PostgreSQL migration safety', () => {
  let database: DatabaseService;
  let imports: PortfolioImportService;
  let workspaceService: WorkspaceService;
  let knowledge: PortfolioKnowledgeService;
  let root = '';
  let actor: AuthUser;
  let workspaceId = '';
  const report = () => join(root, '..', 'verification', 'anklav-import-verification.json');

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'anklav-schema-1.2.0-fixture-'));
    await writeSanitizedFixture(root);
    database = new DatabaseService();
    const activity = new ActivityService();
    workspaceService = new WorkspaceService(database, activity);
    const github = new GitHubService(database, workspaceService);
    const resources = new ResourceService(database, workspaceService, activity, github);
    knowledge = new PortfolioKnowledgeService(database, workspaceService, activity, resources, github);
    imports = new PortfolioImportService(database, activity, knowledge);
  });
  afterAll(async () => { await database?.onModuleDestroy(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    // The fixture deliberately reuses immutable source import keys. Clear the
    // isolated integration database between cases so uniqueness is exercised
    // inside each case, not accidentally across cases.
    await database.pool.query('TRUNCATE TABLE workspaces CASCADE');
    await database.pool.query('TRUNCATE TABLE users CASCADE');
    const [user] = await database.db.insert(users).values({ email: `migration-${Date.now()}@fixture.invalid`, displayName: 'Migration Tester', passwordHash: 'sanitized' }).returning();
    actor = { id: user!.id, email: user!.email, displayName: user!.displayName, instanceRole: user!.instanceRole, theme: 'system' };
    const workspace = await workspaceService.create(actor, { name: 'Personal R&D', description: 'fixture target' });
    workspaceId = workspace!.id;
  });
  const request = (overrides: ImportOverrides = validOverrides) => ({ bundle: root, workspace: workspaceId, overrides, verifyChecksums: true, requireSourceMappings: true });

  it('plans without writes and blocks unresolved decisions', async () => {
    const before = await database.db.select().from(importBatches);
    const plan = await imports.plan(request({}));
    expect(plan.writes).toBe(false);
    expect((plan.blocking as unknown[]).length).toBeGreaterThan(0);
    expect(await database.db.select().from(importBatches)).toHaveLength(before.length);
    await expect(imports.apply(request({}), actor)).rejects.toThrow();
  });

  it('creates correct targets, retains task semantics, records all candidate outcomes, and has deterministic packs', async () => {
    await imports.apply(request(), actor);
    const [task] = await database.db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId));
    expect(task!.verificationRequirements).toContain('Run the migration verifier');
    expect(task!.verificationPerformed).toBe('');
    expect(task!.completionEvidence).toBe('');
    expect(task!.nonGoals).toContain('Do not ingest sessions');
    expect(task!.remainingLimitations).toBe('');
    expect(task!.dueDate).toBe('2026-09-10');
    expect(task!.startedAt?.toISOString()).toContain('2026-08-01');
    const mappings = await database.db.select().from(externalObjectMappings).where(eq(externalObjectMappings.workspaceId, workspaceId));
    expect(mappings.filter((entry) => entry.sourceKind === 'knowledge_artifact_candidate')).toHaveLength(1);
    expect(mappings.find((entry) => entry.sourceKey === 'linear:milestone:milestone-control')?.targetEntityType).toBe('flow_provenance');
    const context = await knowledge.getTaskContextPack(workspaceId, actor, task!.id);
    expect(context.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const [outsider] = await database.db.insert(users).values({ email: `outsider-${Date.now()}@fixture.invalid`, displayName: 'Outsider', passwordHash: 'sanitized' }).returning();
    await expect(knowledge.getTaskContextPack(workspaceId, { id: outsider!.id, email: outsider!.email, displayName: outsider!.displayName, instanceRole: outsider!.instanceRole, theme: 'system' }, task!.id)).rejects.toThrow();
  });

  it('is frozen and idempotent, resumes interrupted batches without duplicates, and rejects changed decisions', async () => {
    const first = await imports.apply(request(), actor) as any;
    expect((await imports.apply(request(), actor) as any).noOp).toBe(true);
    await expect(imports.apply(request({ ...validOverrides, sourceRepositoryVisibility: 'repository_private' }), actor)).rejects.toThrow();
    await database.db.update(importBatches).set({ status: 'interrupted' }).where(eq(importBatches.id, first.batchId));
    await imports.resume(request(), actor);
    expect(await database.db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId))).toHaveLength(1);
  });

  it('only accepts a passing verification, detects deletion and drift, and retains failed attempts separately', async () => {
    await imports.apply(request(), actor);
    const passing = await imports.verify(request(), actor, report()) as any;
    expect(passing.report.passed).toBe(true);
    expect(await database.db.select().from(importVerifications)).toHaveLength(1);
    const [task] = await database.db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId));
    await database.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, task!.id));
    const failed = await imports.verify(request(), actor, report()) as any;
    expect(failed.report.passed).toBe(false);
    expect(await database.db.select().from(importVerifications)).toHaveLength(1);
    await database.db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, task!.id));
    const [mapping] = await database.db.select().from(externalObjectMappings).where(eq(externalObjectMappings.targetEntityId, task!.id));
    await database.db.update(externalObjectMappings).set({ sourcePayloadHash: '0'.repeat(64) }).where(eq(externalObjectMappings.id, mapping!.id));
    expect((await imports.verify(request(), actor, report()) as any).report.passed).toBe(false);
  });

  it('does not delete matched objects, refuses edited created objects, and restores cleanly through a new batch after rollback', async () => {
    const [existing] = await database.db.insert(projects).values({ workspaceId, name: 'Fixture Product', issueKey: 'FIXTURE', status: 'active' }).returning();
    const result = await imports.apply(request(), actor) as any;
    await database.db.update(tasks).set({ title: 'edited after import', version: 2 }).where(eq(tasks.workspaceId, workspaceId));
    await expect(imports.rollback(request(), actor)).rejects.toThrow();
    await imports.rollback(request(), actor, true);
    expect((await database.db.select().from(projects).where(eq(projects.id, existing!.id)))[0]!.deletedAt).toBeNull();
    const reapplied = await imports.apply(request({ ...validOverrides, sourceRepositoryVisibility: 'repository_private' }), actor) as any;
    expect(reapplied.noOp).toBe(false);
    expect(await database.db.select().from(knowledgeArtifacts).where(eq(knowledgeArtifacts.workspaceId, workspaceId))).not.toHaveLength(0);
    expect(result.batchId).not.toBe(reapplied.batchId);
  });

  it('keeps artifact lifecycle operations optimistic and disallows caller-asserted Git canonicality', async () => {
    const first = await knowledge.recordArtifact(workspaceId, actor, { type: 'specification', title: 'Native spec', nativeContent: 'first revision' });
    const second = await knowledge.recordArtifact(workspaceId, actor, { type: 'research', title: 'Native research', nativeContent: 'supporting source' });
    const revision = await knowledge.addArtifactRevision(workspaceId, actor, first!.id, first!.version, 'second revision');
    const related = await knowledge.relateArtifacts(workspaceId, actor, first!.id, revision.artifact!.version, second!.id, 'supports');
    const rejected = await knowledge.setArtifactDisposition(workspaceId, actor, first!.id, related!.version, 'rejected');
    expect(rejected!.canonicality).toBe('rejected');
    const git = await knowledge.recordArtifact(workspaceId, actor, { type: 'git_reference', title: 'Git candidate', repositoryReference: { repositoryFullName: 'example/fixture-product', path: 'docs/fixture.md', commitSha: 'abc1234' } });
    await expect(knowledge.promoteArtifactCanonical(workspaceId, actor, git!.id, git!.version)).rejects.toThrow();
  });

  it('derives REST verification output from the server-owned directory and ignores a caller path', async () => {
    await imports.apply(request(), actor);
    const previous = process.env.ANKLAV_MIGRATION_VERIFICATION_DIR;
    process.env.ANKLAV_MIGRATION_VERIFICATION_DIR = join(root, '..', 'server-owned-verification');
    try {
      const controller = new PortfolioImportController(imports, workspaceService);
      const response = await controller.verify(workspaceId, { user: actor } as any, { verificationReport: join(root, 'attempted-path-control.json'), overrides: validOverrides });
      expect((response as any).report.passed).toBe(true);
      expect((controller as any).verificationReportPath()).toBe(join(root, '..', 'server-owned-verification', 'anklav-import-verification.json'));
    } finally {
      if (previous === undefined) delete process.env.ANKLAV_MIGRATION_VERIFICATION_DIR;
      else process.env.ANKLAV_MIGRATION_VERIFICATION_DIR = previous;
    }
  });
});
