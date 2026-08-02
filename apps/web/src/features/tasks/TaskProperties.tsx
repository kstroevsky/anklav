import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { Page as ApiPage, Project, Repository, Workspace } from '../../api';
import { Field } from '../../components/atoms/Field';
import { priorityOptions } from '../../utils/priorityOptions';

const lines = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);

export function TaskProperties({ workspace, task, save }: { workspace: Workspace; task: any; save: (body: any) => void }) {
  const projects = useQuery<ApiPage<Project>>({
    queryKey: ['project-options', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/projects?limit=100`),
  });
  const flows = useQuery<ApiPage<any>>({
    queryKey: ['flow-options', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/flows?limit=100`),
  });
  const members = useQuery<any[]>({
    queryKey: ['members', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/members`),
  });
  const project = useQuery<any>({
    queryKey: ['project', workspace.id, task.projectId],
    queryFn: () => api(`/workspaces/${workspace.id}/projects/${task.projectId}`),
  });
  const repositories: Array<{ repository: Repository }> = project.data?.repositories ?? [];
  const primaryFlowId = task.flows?.find((entry: any) => entry.link.role === 'primary')?.flow.id ?? '';
  const relatedFlowIds = task.flows?.filter((entry: any) => entry.link.role === 'related').map((entry: any) => entry.flow.id) ?? [];
  return (
    <details className="properties">
      <summary>Manage task contract</summary>
      <form
        className="property-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          let contextPolicy: Record<string, unknown> = {};
          try {
            contextPolicy = JSON.parse(String(form.get('contextPolicy') || '{}'));
          } catch {
            window.alert('Context policy must be valid JSON.');
            return;
          }
          save({
            title: form.get('title'),
            projectId: form.get('projectId'),
            priority: form.get('priority'),
            riskLevel: form.get('riskLevel'),
            constraints: lines(form.get('constraints')),
            expectedArtifacts: lines(form.get('expectedArtifacts')),
            targetRepositoryId: form.get('targetRepositoryId') || null,
            targetBranch: form.get('targetBranch') || '',
            includedPaths: lines(form.get('includedPaths')),
            excludedPaths: lines(form.get('excludedPaths')),
            contextPolicy,
            memoryMode: form.get('memoryMode'),
            requiredApprovals: lines(form.get('requiredApprovals')),
            coordinatingMembershipId: form.get('coordinatingMembershipId') || null,
            assigneeMembershipId: form.get('assigneeMembershipId') || null,
            dueDate: form.get('dueDate') || null,
            humanReviewRequired: form.get('humanReviewRequired') === 'on',
            reviewerMembershipId: form.get('reviewerMembershipId') || null,
            primaryFlowId: form.get('primaryFlowId') || null,
            relatedFlowIds: Array.from((event.currentTarget.elements.namedItem('relatedFlowIds') as HTMLSelectElement).selectedOptions).map((option) => option.value),
          });
        }}
      >
        <Field label="Title" name="title" defaultValue={task.title} required />
        <label>
          Project
          <select name="projectId" defaultValue={task.projectId}>
            {projects.data?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue={task.priority}>
            {priorityOptions()}
          </select>
        </label>
        <label>
          Risk
          <select name="riskLevel" defaultValue={task.riskLevel}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>
        <label>
          Constraints (one per line)
          <textarea name="constraints" defaultValue={(task.constraints ?? []).join('\n')} />
        </label>
        <label>
          Expected artifacts (one per line)
          <textarea name="expectedArtifacts" defaultValue={(task.expectedArtifacts ?? []).join('\n')} />
        </label>
        <label>
          Target repository
          <select name="targetRepositoryId" defaultValue={task.targetRepositoryId ?? ''}>
            <option value="">No repository target</option>
            {repositories.map(({ repository }) => (
              <option key={repository.id} value={repository.id}>
                {repository.fullName}
              </option>
            ))}
          </select>
        </label>
        <Field label="Target branch" name="targetBranch" defaultValue={task.targetBranch ?? ''} />
        <label>
          Included paths (one per line)
          <textarea name="includedPaths" defaultValue={(task.includedPaths ?? []).join('\n')} />
        </label>
        <label>
          Excluded paths (one per line)
          <textarea name="excludedPaths" defaultValue={(task.excludedPaths ?? []).join('\n')} />
        </label>
        <label>
          Context policy (JSON)
          <textarea name="contextPolicy" defaultValue={JSON.stringify(task.contextPolicy ?? {}, null, 2)} />
        </label>
        <label>
          Memory mode
          <select name="memoryMode" defaultValue={task.memoryMode}>
            <option value="isolated">isolated</option>
            <option value="task">task</option>
            <option value="project">project</option>
            <option value="workspace">workspace</option>
          </select>
        </label>
        <label>
          Required approvals (one per line)
          <textarea name="requiredApprovals" defaultValue={(task.requiredApprovals ?? []).join('\n')} />
        </label>
        <label>
          Coordinator
          <select name="coordinatingMembershipId" defaultValue={task.coordinatingMembershipId ?? ''}>
            <option value="">No coordinator</option>
            {members.data
              ?.filter((member) => member.active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          Assignee
          <select name="assigneeMembershipId" defaultValue={task.assigneeMembershipId ?? ''}>
            <option value="">Unassigned</option>
            {members.data
              ?.filter((member) => member.active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </label>
        <Field label="Due date" name="dueDate" type="date" defaultValue={task.dueDate ?? ''} />
        <label className="check">
          <input name="humanReviewRequired" type="checkbox" defaultChecked={task.humanReviewRequired} />
          Human review required
        </label>
        <label>
          Reviewer
          <select name="reviewerMembershipId" defaultValue={task.reviewerMembershipId ?? ''}>
            <option value="">No reviewer</option>
            {members.data
              ?.filter((member) => member.active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          Primary flow
          <select name="primaryFlowId" defaultValue={primaryFlowId}>
            <option value="">No primary flow</option>
            {flows.data?.items.map(({ flow }) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Related flows
          <select name="relatedFlowIds" multiple defaultValue={relatedFlowIds}>
            {flows.data?.items.map(({ flow }) => (
              <option key={flow.id} value={flow.id}>
                {flow.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit">
          Save task contract
        </button>
      </form>
    </details>
  );
}
