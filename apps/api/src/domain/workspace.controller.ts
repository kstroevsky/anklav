import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../common/http';
import type { AuthUser, AuthedRequest } from '../auth';
import { SessionGuard } from '../auth';
import {
  checklistInput, commentInput, criterionInput, flowInput, labelInput, projectInput, relationInput, reviewInput, ResourceService, taskInput,
} from '../resource.service';
import { requireVersion, workspaceInput, workflowInput, WorkspaceService } from '../workspace.service';

function user(request: AuthedRequest): AuthUser { return request.user; }

@UseGuards(SessionGuard)
@Controller('api/v1/workspaces')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService, private readonly resources: ResourceService) {}

  @Get()
  list(@Req() request: AuthedRequest) { return this.service.listForUser(user(request)); }

  @Post()
  create(@Req() request: AuthedRequest, @Body() body: unknown) { return this.service.create(user(request), parseBody(workspaceInput, body)); }

  @Patch(':workspaceId')
  update(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) {
    return this.service.update(workspaceId, user(request), requireVersion(ifMatch), parseBody(workspaceInput.partial(), body));
  }

  @Delete(':workspaceId')
  delete(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined) {
    return this.service.softDelete(workspaceId, user(request), requireVersion(ifMatch));
  }

  @Post(':workspaceId/restore')
  restore(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined) {
    return this.service.restore(workspaceId, user(request), requireVersion(ifMatch));
  }

  @Get(':workspaceId/members')
  members(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.service.listMembers(workspaceId, user(request)); }

  @Get(':workspaceId/available-users')
  availableUsers(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.service.listAvailableUsers(workspaceId, user(request)); }

  @Post(':workspaceId/members')
  addMember(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    const input = parseBody(z.object({ userId: z.string().uuid(), role: z.enum(['owner', 'admin', 'member']) }), body);
    return this.service.addMember(workspaceId, user(request), input.userId, input.role);
  }

  @Patch(':workspaceId/members/:membershipId')
  updateMember(@Param('workspaceId') workspaceId: string, @Param('membershipId') membershipId: string, @Req() request: AuthedRequest, @Body() body: unknown) {
    return this.service.updateMember(workspaceId, user(request), membershipId, parseBody(z.object({ role: z.enum(['owner', 'admin', 'member']).optional(), active: z.boolean().optional() }), body));
  }

  @Get(':workspaceId/workflows')
  workflows(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('entity') entity?: 'task' | 'flow') { return this.service.listWorkflowStates(workspaceId, user(request), entity); }

  @Post(':workspaceId/workflows/:entityType')
  createWorkflow(@Param('workspaceId') workspaceId: string, @Param('entityType') entityType: 'task' | 'flow', @Req() request: AuthedRequest, @Body() body: unknown) {
    if (!['task', 'flow'].includes(entityType)) throw new ForbiddenException('Unknown workflow entity.');
    return this.service.createWorkflowState(workspaceId, user(request), entityType, parseBody(workflowInput, body));
  }

  @Patch(':workspaceId/workflows/:stateId')
  updateWorkflow(@Param('workspaceId') workspaceId: string, @Param('stateId') stateId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) {
    return this.service.updateWorkflowState(workspaceId, user(request), stateId, requireVersion(ifMatch), parseBody(workflowInput.pick({ name: true, color: true, position: true, isInitial: true }).partial(), body));
  }

  @Post(':workspaceId/workflows/:stateId/archive')
  archiveWorkflow(@Param('workspaceId') workspaceId: string, @Param('stateId') stateId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) {
    const input = parseBody(z.object({ replacementStateId: z.string().uuid() }), body);
    return this.service.archiveWorkflowState(workspaceId, user(request), stateId, requireVersion(ifMatch), input.replacementStateId);
  }

  @Get(':workspaceId/projects')
  projects(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) { return this.resources.listProjects(workspaceId, user(request), query); }

  @Post(':workspaceId/projects')
  createProject(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createProject(workspaceId, user(request), parseBody(projectInput, body)); }

  @Get(':workspaceId/projects/:projectId')
  project(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string, @Req() request: AuthedRequest) { return this.resources.getProject(workspaceId, user(request), projectId); }

  @Patch(':workspaceId/projects/:projectId')
  updateProject(@Param('workspaceId') workspaceId: string, @Param('projectId') projectId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) { return this.resources.updateProject(workspaceId, user(request), projectId, requireVersion(ifMatch), parseBody(projectInput.partial(), body)); }

  @Get(':workspaceId/flows')
  flows(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) { return this.resources.listFlows(workspaceId, user(request), query); }

  @Post(':workspaceId/flows')
  createFlow(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createFlow(workspaceId, user(request), parseBody(flowInput, body)); }

  @Get(':workspaceId/flows/:flowId')
  flow(@Param('workspaceId') workspaceId: string, @Param('flowId') flowId: string, @Req() request: AuthedRequest) { return this.resources.getFlow(workspaceId, user(request), flowId); }

  @Patch(':workspaceId/flows/:flowId')
  updateFlow(@Param('workspaceId') workspaceId: string, @Param('flowId') flowId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) { return this.resources.updateFlow(workspaceId, user(request), flowId, requireVersion(ifMatch), parseBody(flowInput.partial(), body)); }

  @Get(':workspaceId/tasks')
  tasks(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query() query: Record<string, string | undefined>) { return this.resources.listTasks(workspaceId, user(request), query); }

  @Post(':workspaceId/tasks')
  createTask(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: unknown) { return this.resources.createTask(workspaceId, user(request), parseBody(taskInput, body), idempotencyKey); }

  @Get(':workspaceId/tasks/:taskId')
  task(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest) { return this.resources.getTask(workspaceId, user(request), taskId); }

  @Get(':workspaceId/tasks/:taskId/events')
  taskEvents(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest) { return this.resources.listTaskEvents(workspaceId, user(request), taskId); }

  @Patch(':workspaceId/tasks/:taskId')
  updateTask(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: unknown) { return this.resources.updateTask(workspaceId, user(request), taskId, requireVersion(ifMatch), parseBody(taskInput.partial(), body), idempotencyKey); }

  @Get(':workspaceId/tasks/:taskId/transition-preview')
  taskTransition(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Query('stateId') stateId: string, @Req() request: AuthedRequest) { return this.resources.transitionPreview(workspaceId, user(request), 'task', taskId, stateId); }

  @Patch(':workspaceId/tasks/:taskId/review')
  updateReview(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: unknown) { return this.resources.updateReview(workspaceId, user(request), taskId, requireVersion(ifMatch), parseBody(reviewInput, body), idempotencyKey); }

  @Get(':workspaceId/flows/:flowId/transition-preview')
  flowTransition(@Param('workspaceId') workspaceId: string, @Param('flowId') flowId: string, @Query('stateId') stateId: string, @Req() request: AuthedRequest) { return this.resources.transitionPreview(workspaceId, user(request), 'flow', flowId, stateId); }

  @Post(':workspaceId/tasks/:taskId/checklists')
  createChecklist(@Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createChecklist(workspaceId, user(request), taskId, parseBody(checklistInput, body)); }

  @Patch(':workspaceId/checklists/:itemId')
  updateChecklist(@Param('workspaceId') workspaceId: string, @Param('itemId') itemId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.updateChecklist(workspaceId, user(request), itemId, parseBody(z.object({ text: z.string().min(1).max(5_000).optional(), completed: z.boolean().optional(), position: z.number().int().min(0).optional() }), body)); }

  @Post(':workspaceId/flows/:flowId/criteria')
  createCriterion(@Param('workspaceId') workspaceId: string, @Param('flowId') flowId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createCriterion(workspaceId, user(request), flowId, parseBody(criterionInput, body)); }

  @Patch(':workspaceId/criteria/:criterionId')
  updateCriterion(@Param('workspaceId') workspaceId: string, @Param('criterionId') criterionId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.updateCriterion(workspaceId, user(request), criterionId, parseBody(z.object({ text: z.string().min(1).max(5_000).optional(), completed: z.boolean().optional(), position: z.number().int().min(0).optional() }), body)); }

  @Get(':workspaceId/labels')
  labels(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.resources.listLabels(workspaceId, user(request)); }

  @Post(':workspaceId/labels')
  createLabel(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createLabel(workspaceId, user(request), parseBody(labelInput, body)); }

  @Patch(':workspaceId/labels/:labelId')
  updateLabel(@Param('workspaceId') workspaceId: string, @Param('labelId') labelId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) { return this.resources.updateLabel(workspaceId, user(request), labelId, requireVersion(ifMatch), parseBody(labelInput.partial(), body)); }

  @Post(':workspaceId/:subject/:subjectId/labels/:labelId')
  assignLabel(@Param('workspaceId') workspaceId: string, @Param('subject') subject: 'project' | 'flow' | 'task', @Param('subjectId') subjectId: string, @Param('labelId') labelId: string, @Req() request: AuthedRequest) {
    return this.resources.assignLabel(workspaceId, user(request), validSubject(subject), subjectId, labelId);
  }

  @Delete(':workspaceId/:subject/:subjectId/labels/:labelId')
  unassignLabel(@Param('workspaceId') workspaceId: string, @Param('subject') subject: 'project' | 'flow' | 'task', @Param('subjectId') subjectId: string, @Param('labelId') labelId: string, @Req() request: AuthedRequest) {
    return this.resources.unassignLabel(workspaceId, user(request), validSubject(subject), subjectId, labelId);
  }

  @Post(':workspaceId/:subject/:subjectId/comments')
  createComment(@Param('workspaceId') workspaceId: string, @Param('subject') subject: 'task' | 'flow', @Param('subjectId') subjectId: string, @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createComment(workspaceId, user(request), validCommentSubject(subject), subjectId, parseBody(commentInput, body)); }

  @Patch(':workspaceId/comments/:commentId')
  updateComment(@Param('workspaceId') workspaceId: string, @Param('commentId') commentId: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Body() body: unknown) { return this.resources.updateComment(workspaceId, user(request), commentId, requireVersion(ifMatch), parseBody(commentInput, body).body); }

  @Post(':workspaceId/:kind/relations')
  createRelation(@Param('workspaceId') workspaceId: string, @Param('kind') kind: 'task' | 'flow', @Req() request: AuthedRequest, @Body() body: unknown) { return this.resources.createRelation(workspaceId, user(request), validRelationKind(kind), parseBody(relationInput, body)); }

  @Delete(':workspaceId/:kind/relations/:relationId')
  deleteRelation(@Param('workspaceId') workspaceId: string, @Param('kind') kind: 'task' | 'flow', @Param('relationId') relationId: string, @Req() request: AuthedRequest) { return this.resources.deleteRelation(workspaceId, user(request), validRelationKind(kind), relationId); }

  @Delete(':workspaceId/:kind/:id')
  deleteItem(@Param('workspaceId') workspaceId: string, @Param('kind') kind: 'project' | 'flow' | 'task' | 'label' | 'comment', @Param('id') id: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined) { return this.resources.softDelete(workspaceId, user(request), validDeleteKind(kind), id, requireVersion(ifMatch), idempotencyKey); }

  @Post(':workspaceId/:kind/:id/restore')
  restoreItem(@Param('workspaceId') workspaceId: string, @Param('kind') kind: 'project' | 'flow' | 'task' | 'label' | 'comment', @Param('id') id: string, @Req() request: AuthedRequest, @Headers('if-match') ifMatch: string | undefined, @Headers('idempotency-key') idempotencyKey: string | undefined) { return this.resources.restore(workspaceId, user(request), validDeleteKind(kind), id, requireVersion(ifMatch), idempotencyKey); }

  @Get(':workspaceId/activity')
  activity(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('after') after?: string) { return this.resources.activity(workspaceId, user(request), after ? Number(after) : undefined); }

  @Get(':workspaceId/changes')
  changes(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('after') after?: string) { return this.resources.activity(workspaceId, user(request), after ? Number(after) : undefined); }

  @Get(':workspaceId/search')
  search(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest, @Query('q') q = '') { return this.resources.search(workspaceId, user(request), q); }

  @Get(':workspaceId/trash')
  trash(@Param('workspaceId') workspaceId: string, @Req() request: AuthedRequest) { return this.resources.listTrash(workspaceId, user(request)); }
}

function validSubject(subject: string): 'project' | 'flow' | 'task' {
  if (subject === 'project' || subject === 'flow' || subject === 'task') return subject;
  throw new ForbiddenException('Unknown label subject.');
}
function validCommentSubject(subject: string): 'task' | 'flow' {
  if (subject === 'task' || subject === 'flow') return subject;
  throw new ForbiddenException('Comments are supported for tasks and flows.');
}
function validRelationKind(kind: string): 'task' | 'flow' {
  if (kind === 'task' || kind === 'flow') return kind;
  throw new ForbiddenException('Unknown relation kind.');
}
function validDeleteKind(kind: string): 'project' | 'flow' | 'task' | 'label' | 'comment' {
  if (kind === 'project' || kind === 'flow' || kind === 'task' || kind === 'label' || kind === 'comment') return kind;
  throw new ForbiddenException('Unknown resource kind.');
}
