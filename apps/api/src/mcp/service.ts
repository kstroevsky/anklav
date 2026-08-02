import { Injectable } from '@nestjs/common';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { checklistInput, commentInput, criterionInput, flowInput, labelInput, projectInput, relationInput, ResourceService, taskInput } from '../resource.service';
import { WorkspaceService } from '../workspace.service';
import { McpPrincipal, OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE, OAuthService } from '../oauth';
import { PortfolioKnowledgeService } from '../portfolio-knowledge.service';
import { anyOutput, id, page, READ, UNLINK, version, workspaceId, WRITE } from './inputs';
import { failure, resource, success, variable, warningsMatch } from './helpers';
import { ExecutionService } from '../execution/service';
import { appendRunEventInput, checkpointInput, claimLeaseInput, finishRunInput, gitSliceInput, nativeSessionInput, renewLeaseInput, startRunInput } from '../execution/inputs';
import { EvidenceService } from '../evidence/service';
import { evidenceArtifactInput } from '../evidence/inputs';

export class McpService {
  constructor(private readonly oauth: OAuthService, private readonly workspaces: WorkspaceService, private readonly resources: ResourceService, private readonly knowledge: PortfolioKnowledgeService, private readonly execution: ExecutionService, private readonly evidence: EvidenceService) {}

  createServer(principal: McpPrincipal): McpServer {
    const server = new McpServer(
      { name: 'anklav', version: '0.1.0' },
      { instructions: 'Use list_workspaces or get_workspace_context before acting. Fetch the latest project, flow, or task before updating and always pass expectedVersion. Preview transitions, then repeat the exact warnings in acknowledgedWarnings before a warned state change. You may manage work, but never represent yourself as a human reviewer or attempt human-review decisions.' },
    );
    const read = (name: string, description: string, schema: z.ZodTypeAny, handler: (input: any) => Promise<unknown>) => this.tool(server, name, description, schema, READ, handler);
    const write = (name: string, description: string, schema: z.ZodTypeAny, handler: (input: any) => Promise<unknown>, destructive = false) => this.tool(server, name, description, schema, destructive ? UNLINK : WRITE, handler);
    const check = (value: string, scope: string) => this.requireWorkspace(principal, value, scope);
    const user = principal.user;
    const filterPage = (input: Record<string, unknown>) => ({ ...input, limit: input.limit === undefined ? undefined : String(input.limit) });

    read('list_workspaces', 'List workspaces selected in this connected-client grant.', z.object({}), async () => {
      this.requireScope(principal, OAUTH_READ_SCOPE);
      return (await this.workspaces.listForUser(user)).filter((entry) => principal.workspaceIds.has(entry.id));
    });
    read('get_workspace_context', 'Get workspace metadata, active members, workflow states, and labels needed to resolve IDs.', workspaceId, async ({ workspaceId: value }) => this.workspaceContext(principal, value));
    read('search_work', 'Search projects, flows, and tasks in a workspace.', workspaceId.extend({ query: z.string().trim().min(1).max(500) }), async ({ workspaceId: value, query }) => {
      check(value, OAUTH_READ_SCOPE); return this.resources.search(value, user, query);
    });
    read('list_projects', 'List projects with opaque cursor pagination and optional filters.', workspaceId.merge(page).extend({ q: z.string().max(500).optional(), status: z.string().optional(), priority: z.string().optional(), health: z.string().optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.listProjects(input.workspaceId, user, filterPage(input));
    });
    read('get_project', 'Get a full project record.', workspaceId.extend({ projectId: id }), async (input) => { check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.getProject(input.workspaceId, user, input.projectId); });
    read('list_flows', 'List flows with opaque cursor pagination and optional filters.', workspaceId.merge(page).extend({ q: z.string().max(500).optional(), stateId: id.optional(), priority: z.string().optional(), health: z.string().optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.listFlows(input.workspaceId, user, filterPage(input));
    });
    read('get_flow', 'Get a full flow record.', workspaceId.extend({ flowId: id }), async (input) => { check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.getFlow(input.workspaceId, user, input.flowId); });
    read('list_tasks', 'List tasks with opaque cursor pagination and optional filters.', workspaceId.merge(page).extend({ q: z.string().max(500).optional(), projectId: id.optional(), flowId: id.optional(), stateId: id.optional(), priority: z.string().optional(), assigneeMembershipId: id.optional(), labelId: id.optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.listTasks(input.workspaceId, user, filterPage(input));
    });
    read('get_task', 'Get a full task record, including checklists, relations, comments, and transition warnings.', workspaceId.extend({ taskId: id }), async (input) => { check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.getTask(input.workspaceId, user, input.taskId); });
    read('get_activity', 'Get workspace activity after an optional sequence number.', workspaceId.extend({ after: z.number().int().nonnegative().optional() }), async (input) => { check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.activity(input.workspaceId, user, input.after); });
    read('preview_transition', 'Preview required warnings before changing a task or flow state.', workspaceId.extend({ entityType: z.enum(['task', 'flow']), entityId: id, stateId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.resources.transitionPreview(input.workspaceId, user, input.entityType, input.entityId, input.stateId);
    });
    read('list_milestones', 'List concrete delivery checkpoints. Milestones are distinct from continuing flows.', workspaceId.extend({ projectId: id.optional(), flowId: id.optional(), status: z.enum(['planned', 'in_progress', 'completed', 'cancelled', 'archived']).optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); const { workspaceId: value, ...filters } = input; return this.knowledge.listMilestones(value, user, filters);
    });
    read('get_milestone', 'Get a native milestone and its linked tasks.', workspaceId.extend({ milestoneId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.knowledge.getMilestone(input.workspaceId, user, input.milestoneId);
    });
    read('get_task_context_pack', 'Compile a deterministic task context pack and reproducibility manifest from structured Anklav state and verified/canonical artifacts. Raw sessions and semantic retrieval are intentionally excluded.', workspaceId.extend({ taskId: id, projection: z.enum(['max', 'standard', 'low', 'review', 'handoff']).optional(), adapter: z.enum(['provider_neutral', 'claude', 'codex']).optional(), model: z.string().trim().min(1).max(160).optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.knowledge.getTaskContextPack(input.workspaceId, user, input.taskId, { projection: input.projection, adapter: input.adapter, model: input.model });
    });
    read('list_task_runs', 'List execution attempts for one task.', workspaceId.extend({ taskId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.execution.listTaskRuns(input.workspaceId, user, input.taskId);
    });
    read('get_run', 'Get a run with its Git slices, native sessions, immutable events, and checkpoints.', workspaceId.extend({ runId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.execution.getRun(input.workspaceId, user, input.runId);
    });
    read('list_run_events', 'Read a run event stream in sequence order using an optional continuation cursor.', workspaceId.extend({ runId: id, after: z.number().int().nonnegative().optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.execution.listRunEvents(input.workspaceId, user, input.runId, input.after);
    });
    read('list_task_leases', 'List unexpired task leases and their declared write/path scopes.', workspaceId.extend({ taskId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.execution.listTaskLeases(input.workspaceId, user, input.taskId);
    });
    read('list_evidence_artifacts', 'List immutable evidence manifests, optionally scoped to one task or run.', workspaceId.extend({ taskId: id.optional(), runId: id.optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.evidence.list(input.workspaceId, user, { taskId: input.taskId, runId: input.runId });
    });
    read('get_evidence_artifact', 'Get an immutable evidence manifest and its producing run-event links.', workspaceId.extend({ artifactId: id }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.evidence.get(input.workspaceId, user, input.artifactId);
    });
    read('read_evidence_artifact', 'Read an exact evidence byte range as base64. Continue with nextOffset for large artifacts.', workspaceId.extend({ artifactId: id, offset: z.number().int().nonnegative().optional(), length: z.number().int().min(1).max(1_048_576).optional() }), async (input) => {
      check(input.workspaceId, OAUTH_READ_SCOPE); return this.evidence.readRange(input.workspaceId, user, input.artifactId, input.offset, input.length);
    });

    write('create_project', 'Create a project.', workspaceId.merge(projectInput), async (input) => { check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, ...values } = input; return this.resources.createProject(value, user, values); });
    write('update_project', 'Update a project using its latest expectedVersion.', workspaceId.extend({ projectId: id, expectedVersion: version }).merge(projectInput.partial()), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, projectId, expectedVersion, ...values } = input; return this.resources.updateProject(value, user, projectId, expectedVersion, values);
    });
    write('create_flow', 'Create a flow.', workspaceId.merge(flowInput), async (input) => { check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, ...values } = input; return this.resources.createFlow(value, user, values); });
    write('update_flow', 'Update a flow. A warned state change requires exact acknowledgedWarnings from preview_transition.', workspaceId.extend({ flowId: id, expectedVersion: version, acknowledgedWarnings: z.array(z.string()).max(20).optional() }).merge(flowInput.partial()), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE);
      const { workspaceId: value, flowId, expectedVersion, acknowledgedWarnings, ...values } = input;
      const warning = await this.acknowledgeTransition(principal, value, 'flow', flowId, values.workflowStateId, acknowledgedWarnings);
      if (warning) return warning;
      return this.resources.updateFlow(value, user, flowId, expectedVersion, values);
    });
    write('create_task', 'Create a task.', workspaceId.merge(taskInput), async (input) => { check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, ...values } = input; return this.resources.createTask(value, user, values); });
    write('start_run', 'Start an execution attempt. Modifying runs require an immutable starting Git slice.', workspaceId.extend({ taskId: id }).merge(startRunInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, taskId, ...values } = input; return this.execution.startRun(value, user, taskId, values);
    });
    write('append_run_event', 'Append one immutable, idempotent event to a running execution attempt.', workspaceId.extend({ runId: id }).merge(appendRunEventInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.appendEvent(value, user, runId, values);
    });
    write('capture_git_slice', 'Capture precise intermediate Git state for a running execution attempt.', workspaceId.extend({ runId: id }).merge(gitSliceInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.captureGitSlice(value, user, runId, values);
    });
    write('attach_native_session', 'Attach a provider-native resumability reference to a running execution attempt.', workspaceId.extend({ runId: id }).merge(nativeSessionInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.attachNativeSession(value, user, runId, values);
    });
    write('create_run_checkpoint', 'Create an immutable provider-neutral continuation checkpoint for a run.', workspaceId.extend({ runId: id }).merge(checkpointInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.createCheckpoint(value, user, runId, values);
    });
    write('finish_run', 'Finish a run. Modifying runs must capture their ending Git slice.', workspaceId.extend({ runId: id }).merge(finishRunInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.finishRun(value, user, runId, values);
    });
    write('record_evidence_artifact', 'Store exact immutable evidence under a server-verified SHA-256 hash and create its manifest.', workspaceId.merge(evidenceArtifactInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, ...values } = input; return this.evidence.record(value, user, values);
    });
    write('claim_task_lease', 'Claim an expiring task lease with explicit activity, write access, and path scope.', workspaceId.extend({ runId: id }).merge(claimLeaseInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, runId, ...values } = input; return this.execution.claimLease(value, user, runId, values);
    });
    write('renew_task_lease', 'Renew your active task lease for a bounded duration.', workspaceId.extend({ leaseId: id }).merge(renewLeaseInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.execution.renewLease(input.workspaceId, user, input.leaseId, input.ttlSeconds);
    });
    write('release_task_lease', 'Release your active task lease.', workspaceId.extend({ leaseId: id }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.execution.releaseLease(input.workspaceId, user, input.leaseId);
    });
    write('update_task', 'Update a task. A warned state change requires exact acknowledgedWarnings from preview_transition.', workspaceId.extend({ taskId: id, expectedVersion: version, acknowledgedWarnings: z.array(z.string()).max(20).optional() }).merge(taskInput.partial()), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE);
      const { workspaceId: value, taskId, expectedVersion, acknowledgedWarnings, ...values } = input;
      const warning = await this.acknowledgeTransition(principal, value, 'task', taskId, values.workflowStateId, acknowledgedWarnings);
      if (warning) return warning;
      return this.resources.updateTask(value, user, taskId, expectedVersion, values);
    });

    write('add_comment', 'Add a comment to a task or flow.', workspaceId.extend({ subject: z.enum(['task', 'flow']), subjectId: id }).merge(commentInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.createComment(input.workspaceId, user, input.subject, input.subjectId, { body: input.body });
    });
    write('update_comment', 'Update your own comment using its latest expectedVersion.', workspaceId.extend({ commentId: id, expectedVersion: version }).merge(commentInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.updateComment(input.workspaceId, user, input.commentId, input.expectedVersion, input.body);
    });
    write('create_label', 'Create a workspace label.', workspaceId.merge(labelInput), async (input) => { check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, ...values } = input; return this.resources.createLabel(value, user, values); });
    write('update_label', 'Update a label using its latest expectedVersion.', workspaceId.extend({ labelId: id, expectedVersion: version }).merge(labelInput.partial()), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, labelId, expectedVersion, ...values } = input; return this.resources.updateLabel(value, user, labelId, expectedVersion, values);
    });
    write('assign_label', 'Assign a label to a project, flow, or task.', workspaceId.extend({ subject: z.enum(['project', 'flow', 'task']), subjectId: id, labelId: id }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.assignLabel(input.workspaceId, user, input.subject, input.subjectId, input.labelId);
    });
    write('unassign_label', 'Remove a label assignment from a project, flow, or task.', workspaceId.extend({ subject: z.enum(['project', 'flow', 'task']), subjectId: id, labelId: id }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.unassignLabel(input.workspaceId, user, input.subject, input.subjectId, input.labelId);
    }, true);
    write('add_checklist_item', 'Add a readiness or acceptance checklist item to a task.', workspaceId.extend({ taskId: id }).merge(checklistInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.createChecklist(input.workspaceId, user, input.taskId, { kind: input.kind, text: input.text, position: input.position });
    });
    write('update_checklist_item', 'Update a checklist item.', workspaceId.extend({ itemId: id, text: z.string().trim().min(1).max(5_000).optional(), completed: z.boolean().optional(), position: z.number().int().min(0).optional() }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, itemId, ...values } = input; return this.resources.updateChecklist(value, user, itemId, values);
    });
    write('add_convergence_criterion', 'Add a convergence criterion to a flow.', workspaceId.extend({ flowId: id }).merge(criterionInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.createCriterion(input.workspaceId, user, input.flowId, { text: input.text, position: input.position });
    });
    write('update_convergence_criterion', 'Update a flow convergence criterion.', workspaceId.extend({ criterionId: id, text: z.string().trim().min(1).max(5_000).optional(), completed: z.boolean().optional(), position: z.number().int().min(0).optional() }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, criterionId, ...values } = input; return this.resources.updateCriterion(value, user, criterionId, values);
    });
    write('create_relation', 'Create a task or flow relation.', workspaceId.extend({ kind: z.enum(['task', 'flow']) }).merge(relationInput), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); const { workspaceId: value, kind, ...values } = input; return this.resources.createRelation(value, user, kind, values);
    });
    write('unlink_relation', 'Remove a task or flow relation.', workspaceId.extend({ kind: z.enum(['task', 'flow']), relationId: id }), async (input) => {
      check(input.workspaceId, OAUTH_WRITE_SCOPE); return this.resources.deleteRelation(input.workspaceId, user, input.kind, input.relationId);
    }, true);

    this.registerResources(server, principal);
    return server;
  }

  private tool(server: McpServer, name: string, description: string, inputSchema: z.ZodTypeAny, annotations: ToolAnnotations, handler: (input: any) => Promise<unknown>) {
    server.registerTool(name, { description, inputSchema, outputSchema: anyOutput, annotations }, async (input) => {
      try {
        const result = await handler(input);
        return success(result);
      } catch (error) {
        return failure(error);
      }
    });
  }

  private registerResources(server: McpServer, principal: McpPrincipal): void {
    const context = new ResourceTemplate('anklav://workspace/{workspaceId}/context', { list: async () => ({ resources: [...principal.workspaceIds].map((workspaceId) => ({ uri: `anklav://workspace/${workspaceId}/context`, name: `Workspace context ${workspaceId}`, mimeType: 'application/json' })) }) });
    server.registerResource('workspace-context', context, { description: 'Read-only workspace metadata, members, workflow states, and labels.', mimeType: 'application/json' }, async (uri, variables) => resource(uri, await this.workspaceContext(principal, variable('workspaceId', variables))));
    this.entityResource(server, principal, 'project', (workspace, entity) => this.resources.getProject(workspace, principal.user, entity));
    this.entityResource(server, principal, 'flow', (workspace, entity) => this.resources.getFlow(workspace, principal.user, entity));
    this.entityResource(server, principal, 'task', (workspace, entity) => this.resources.getTask(workspace, principal.user, entity));
  }

  private entityResource(server: McpServer, principal: McpPrincipal, entity: 'project' | 'flow' | 'task', get: (workspaceId: string, entityId: string) => Promise<unknown>): void {
    const template = new ResourceTemplate(`anklav://workspace/{workspaceId}/${entity}s/{entityId}`, { list: undefined });
    server.registerResource(`${entity}-record`, template, { description: `Read-only full ${entity} record.`, mimeType: 'application/json' }, async (uri, variables) => {
      const selectedWorkspace = variable('workspaceId', variables);
      this.requireWorkspace(principal, selectedWorkspace, OAUTH_READ_SCOPE);
      return resource(uri, await get(selectedWorkspace, variable('entityId', variables)));
    });
  }

  private async workspaceContext(principal: McpPrincipal, value: string) {
    this.requireWorkspace(principal, value, OAUTH_READ_SCOPE);
    const workspace = (await this.workspaces.listForUser(principal.user)).find((entry) => entry.id === value);
    if (!workspace) throw new Error('NOT_FOUND: Workspace not found.');
    const [members, workflowStates, labels] = await Promise.all([
      this.workspaces.listMembers(value, principal.user),
      this.workspaces.listWorkflowStates(value, principal.user),
      this.resources.listLabels(value, principal.user),
    ]);
    return { workspace, members: members.filter((member) => member.active), workflowStates, labels };
  }

  private requireScope(principal: McpPrincipal, scope: string): void {
    if (!principal.scopes.has(scope)) throw new Error(`FORBIDDEN: This operation requires ${scope}.`);
  }

  private requireWorkspace(principal: McpPrincipal, value: string, scope: string): void {
    this.requireScope(principal, scope);
    if (!principal.workspaceIds.has(value)) throw new Error('FORBIDDEN: This connected client is not granted access to that workspace.');
  }

  private async acknowledgeTransition(principal: McpPrincipal, value: string, type: 'task' | 'flow', entityId: string, stateId: string | undefined, acknowledgedWarnings: string[] | undefined) {
    if (!stateId) return null;
    const preview = await this.resources.transitionPreview(value, principal.user, type, entityId, stateId);
    if (!preview.warnings.length || warningsMatch(preview.warnings, acknowledgedWarnings ?? [])) return null;
    return { code: 'TRANSITION_REQUIRES_ACKNOWLEDGEMENT', warnings: preview.warnings, message: 'Preview these warnings and repeat this update with acknowledgedWarnings exactly matching warnings.' };
  }
}
