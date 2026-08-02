import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth';
import { ActivityService } from '../activity.service';
import { DatabaseService } from '../db/database.service';
import { externalObjectMappings, githubProjectRepositories, githubRepositories, knowledgeArtifacts, milestoneTasks, milestones, repositoryArtifactReferences } from '../db/schema';
import { GitHubService } from '../github';
import { ResourceService } from '../resource.service';
import { WorkspaceService } from '../workspace.service';
import { PortfolioArtifactService } from './artifact.service';
import { compileContextPack, type ContextPackOptions, nonGoals } from './types';

@Injectable()
export class PortfolioKnowledgeService extends PortfolioArtifactService {
  constructor(
    database: DatabaseService,
    workspaces: WorkspaceService,
    activity: ActivityService,
    resources: ResourceService,
    github: GitHubService,
  ) {
    super(database, workspaces, activity, resources, github);
  }
  async getTaskContextPack(workspaceId: string, user: AuthUser, taskId: string, options: ContextPackOptions = {}) {
    const task = await this.resources.getTask(workspaceId, user, taskId);
    if (!task.project) throw new NotFoundException('Task project not found.');
    const relatedFlows = [...task.flows].sort((a: any, b: any) => `${a.link.role}:${a.flow.name}`.localeCompare(`${b.link.role}:${b.flow.name}`));
    const flowIds = relatedFlows.map((entry: any) => entry.flow.id);
    const criteria = flowIds.length ? await this.database.db.execute(sql`SELECT c.*, f.name AS flow_name FROM convergence_criteria c JOIN flows f ON f.id = c.flow_id WHERE c.flow_id = ANY(${flowIds}::uuid[]) ORDER BY f.name, c.position`) : { rows: [] };
    const milestoneRows = await this.database.db.select({ milestone: milestones }).from(milestoneTasks).innerJoin(milestones, eq(milestoneTasks.milestoneId, milestones.id))
      .where(and(eq(milestoneTasks.taskId, task.id), eq(milestones.workspaceId, workspaceId), isNull(milestones.deletedAt))).orderBy(asc(milestones.targetDate), asc(milestones.name));
    const artifactRows = await this.database.db.select({ artifact: knowledgeArtifacts, reference: repositoryArtifactReferences }).from(knowledgeArtifacts)
      .leftJoin(repositoryArtifactReferences, eq(repositoryArtifactReferences.artifactId, knowledgeArtifacts.id))
      .where(and(eq(knowledgeArtifacts.workspaceId, workspaceId), isNull(knowledgeArtifacts.deletedAt), or(eq(knowledgeArtifacts.taskId, task.id), eq(knowledgeArtifacts.projectId, task.projectId), flowIds.length ? inArray(knowledgeArtifacts.flowId, flowIds) : undefined), eq(knowledgeArtifacts.canonicality, 'canonical'), eq(knowledgeArtifacts.verification, 'verified')))
      .orderBy(asc(knowledgeArtifacts.type), asc(knowledgeArtifacts.title), asc(knowledgeArtifacts.id));
    const projectRepositories = await this.database.db.select({ repository: githubRepositories, link: githubProjectRepositories }).from(githubProjectRepositories).innerJoin(githubRepositories, eq(githubProjectRepositories.repositoryId, githubRepositories.id)).where(eq(githubProjectRepositories.projectId, task.projectId)).orderBy(asc(githubRepositories.fullName));
    const handoff = artifactRows.filter((entry) => entry.artifact.type === 'handoff').sort((left, right) => right.artifact.createdAt.getTime() - left.artifact.createdAt.getTime() || right.artifact.id.localeCompare(left.artifact.id))[0] ?? null;
    const relationRows = await this.database.db.execute(sql`
      SELECT r.id, r.type, r.explanation, r.source_task_id, r.target_task_id,
        source.identifier AS source_identifier, source.title AS source_title, source.deleted_at AS source_deleted_at,
        target.identifier AS target_identifier, target.title AS target_title, target.deleted_at AS target_deleted_at
      FROM task_relations r
      JOIN tasks source ON source.id = r.source_task_id
      JOIN tasks target ON target.id = r.target_task_id
      WHERE r.workspace_id = ${workspaceId}::uuid AND (r.source_task_id = ${task.id}::uuid OR r.target_task_id = ${task.id}::uuid)
      ORDER BY r.type, source.identifier, target.identifier, r.id
    `);
    const taskRelations = relationRows.rows.map((row: any) => ({ id: row.id, type: row.type, explanation: row.explanation, direction: row.source_task_id === task.id ? 'outgoing' : 'incoming', source: { id: row.source_task_id, identifier: row.source_identifier, title: row.source_title, deleted: Boolean(row.source_deleted_at) }, target: { id: row.target_task_id, identifier: row.target_identifier, title: row.target_title, deleted: Boolean(row.target_deleted_at) } }));
    const provenance = await this.database.db.select({ sourceSystem: externalObjectMappings.sourceSystem, sourceKind: externalObjectMappings.sourceKind, sourceKey: externalObjectMappings.sourceKey, sourceId: externalObjectMappings.sourceId, sourceUrl: externalObjectMappings.sourceUrl, bundleVersion: externalObjectMappings.bundleVersion }).from(externalObjectMappings)
      .where(and(eq(externalObjectMappings.workspaceId, workspaceId), eq(externalObjectMappings.targetEntityType, 'task'), eq(externalObjectMappings.targetEntityId, task.id), isNull(externalObjectMappings.supersededAt))).orderBy(asc(externalObjectMappings.sourceKey));
    const blockers = [
      ...(task.state?.taskSemantic === 'blocked' ? [{ type: 'task_state', message: 'Task is currently blocked.' }] : []),
      ...taskRelations.filter((relation: any) => relation.type === 'blocks' && relation.direction === 'incoming').map((relation: any) => ({ type: 'blocking_task_relation', message: `${relation.source.identifier}: ${relation.source.title}` })),
      ...task.transitionWarnings.map((message: string) => ({ type: 'transition_warning', message })),
      ...relatedFlows.filter((entry: any) => entry.flow.health === 'off_track' || entry.flow.health === 'at_risk').map((entry: any) => ({ type: 'flow_health', message: `${entry.flow.name}: ${entry.flow.health}` })),
    ];
    const deterministic = {
      version: '1', generatedFrom: { taskId: task.id, taskVersion: task.version }, taskContract: { identifier: task.identifier, aliases: task.identifierAliases, title: task.title, description: task.description, status: task.state?.taskSemantic, priority: task.priority, readiness: task.checklists.filter((item: any) => item.kind === 'readiness'), acceptanceCriteria: task.checklists.filter((item: any) => item.kind === 'acceptance'), verificationRequirements: task.verificationRequirements, verificationPerformed: task.verificationPerformed, completionEvidence: task.completionEvidence, limitations: task.remainingLimitations, followUpWork: task.followUpWork },
      project: { id: task.project.id, name: task.project.name, summary: task.project.currentStateSummary, focus: task.project.currentFocus, repositoryReference: task.project.repositoryReference },
      flows: relatedFlows.map((entry: any) => ({ role: entry.link.role, id: entry.flow.id, name: entry.flow.name, purpose: entry.flow.purpose, state: entry.flow.workflowStateId, health: entry.flow.health, importantFindings: entry.flow.importantFindings, nextRecommendedAction: entry.flow.nextRecommendedAction, convergenceCriteria: criteria.rows.filter((criterion: any) => criterion.flow_id === entry.flow.id).map((criterion: any) => ({ text: criterion.text, completed: criterion.completed })) })),
      milestones: milestoneRows.map(({ milestone }) => ({ id: milestone.id, name: milestone.name, status: milestone.status, targetDate: milestone.targetDate, flowId: milestone.flowId })),
      acceptedDecisions: artifactRows.filter((entry) => entry.artifact.type === 'decision').map((entry) => ({ id: entry.artifact.id, title: entry.artifact.title, summary: entry.artifact.summary, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : null })),
      verifiedArtifacts: artifactRows.map((entry) => ({ id: entry.artifact.id, type: entry.artifact.type, title: entry.artifact.title, summary: entry.artifact.summary, origin: entry.artifact.origin, citation: entry.reference ? { repository: entry.reference.repositoryFullName, path: entry.reference.path, commitSha: entry.reference.commitSha, contentHash: entry.reference.contentHash } : { artifactId: entry.artifact.id, revisionId: entry.artifact.currentRevisionId } })),
      repositories: projectRepositories.map((entry) => ({ fullName: entry.repository.fullName, defaultBranch: entry.repository.defaultBranch, htmlUrl: entry.repository.htmlUrl })),
      linkedGitHub: { issues: task.githubIssues, pullRequests: task.githubPullRequests },
      taskRelations,
      dependencies: taskRelations.filter((relation: any) => relation.type === 'blocks'),
      sourceProvenance: provenance,
      latestHandoff: handoff ? { id: handoff.artifact.id, title: handoff.artifact.title, summary: handoff.artifact.summary } : null,
      humanReview: { required: task.humanReviewRequired, status: task.reviewStatus, reviewerMembershipId: task.reviewerMembershipId }, blockers,
      explicitNonGoals: task.nonGoals ? task.nonGoals.split('\n').map((entry: string) => entry.replace(/^[-*]\s*/, '').trim()).filter(Boolean) : nonGoals(task.description), semanticRetrieval: { included: false, reason: 'Phase 1 context packs intentionally use deterministic structured and verified Git-backed context only.' },
    };
    return compileContextPack(deterministic, options);
  }
}

export { compileContextPack, finalizeContextPack } from './types';
