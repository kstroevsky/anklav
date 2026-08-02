import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Flow, Repository, Task, Workspace } from '../../api';
import { Activity } from '../../components/molecules/Activity';
import { EditableMarkdown } from '../../components/molecules/EditableMarkdown';
import { Empty } from '../../components/molecules/Empty';
import { Loading } from '../../components/atoms/Loading';
import { LabelEditor } from '../../components/organisms/LabelEditor';
import { healthOptions } from '../../utils/healthOptions';
import { priorityOptions } from '../../utils/priorityOptions';

export function ProjectDetail({ workspace, projectId }: { workspace: Workspace; projectId: string }) {
  const client = useQueryClient();
  const [repositoryId, setRepositoryId] = useState('');
  const detail = useQuery<any>({
    queryKey: ['project', workspace.id, projectId],
    queryFn: () => api(`/workspaces/${workspace.id}/projects/${projectId}`),
  });
  const repositories = useQuery<Repository[]>({
    queryKey: ['repositories', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/repositories`),
  });
  const update = useMutation({
    mutationFn: (body: any) => api(`/workspaces/${workspace.id}/projects/${projectId}`, mutation('PATCH', body, detail.data.version)),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: ['project', workspace.id, projectId],
      });
      client.invalidateQueries({ queryKey: ['projects', workspace.id] });
    },
  });
  const refreshRepositories = () => {
    client.invalidateQueries({
      queryKey: ['project', workspace.id, projectId],
    });
    client.invalidateQueries({ queryKey: ['repositories', workspace.id] });
  };
  const linkRepository = useMutation({
    mutationFn: () =>
      api(
        `/workspaces/${workspace.id}/projects/${projectId}/repositories`,
        mutation('POST', {
          repositoryId,
          role: detail.data?.repositories?.length ? 'supporting' : 'primary',
        }),
      ),
    onSuccess: () => {
      setRepositoryId('');
      refreshRepositories();
    },
  });
  const unlinkRepository = useMutation({
    mutationFn: (id: string) => api(`/workspaces/${workspace.id}/projects/${projectId}/repositories/${id}`, mutation('DELETE')),
    onSuccess: refreshRepositories,
  });
  if (detail.isLoading) return <Loading />;
  if (!detail.data) return <Empty title="Project not found" text="It may have been deleted." />;
  const project = detail.data;
  return (
    <article className="detail">
      <header className="detail-header">
        <div>
          <span className="eyebrow">Technical ownership</span>
          <h2>{project.name}</h2>
        </div>
        <select value={project.status} onChange={(event) => update.mutate({ status: event.target.value })}>
          {['proposed', 'planned', 'active', 'paused', 'completed', 'archived'].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </header>
      <EditableMarkdown title="Purpose" value={project.description} onSave={(description) => update.mutate({ description })} />
      <section className="meta-grid">
        <label>
          Priority
          <select value={project.priority} onChange={(event) => update.mutate({ priority: event.target.value })}>
            {priorityOptions()}
          </select>
        </label>
        <label>
          Health
          <select value={project.health} onChange={(event) => update.mutate({ health: event.target.value })}>
            {healthOptions()}
          </select>
        </label>
      </section>
      <EditableMarkdown title="Current focus" value={project.currentFocus} onSave={(currentFocus) => update.mutate({ currentFocus })} />
      <EditableMarkdown title="Current-state summary" value={project.currentStateSummary} empty="Summarize the current technical state." onSave={(currentStateSummary) => update.mutate({ currentStateSummary })} />
      <section>
        <h3>Repositories</h3>
        {project.repositories?.map(({ link, repository }: any) => (
          <div className="setting-row" key={repository.id}>
            <span>
              <strong>{repository.fullName}</strong>
              <small>
                {link.role} · {repository.defaultBranch}
              </small>
            </span>
            <button className="text-button danger" onClick={() => unlinkRepository.mutate(repository.id)}>
              Unlink
            </button>
          </div>
        ))}
        <div className="inline-fields">
          <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
            <option value="">Link repository…</option>
            {repositories.data
              ?.filter((repository) => !project.repositories?.some((entry: any) => entry.repository.id === repository.id))
              .map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.fullName}
                </option>
              ))}
          </select>
          <button className="button" disabled={!repositoryId} onClick={() => linkRepository.mutate()}>
            Link
          </button>
        </div>
      </section>
      <LabelEditor workspace={workspace} subject="project" subjectId={project.id} assigned={project.labels ?? []} />
      <section>
        <h3>Work in this project</h3>
        {project.tasks?.length ? (
          project.tasks.slice(0, 12).map((task: Task) => (
            <p key={task.id} className="linked-row">
              {task.title}
            </p>
          ))
        ) : (
          <p className="muted">No active tasks.</p>
        )}
      </section>
      <section>
        <h3>Flows involving this project</h3>
        {project.flows?.length ? (
          project.flows.map((flow: Flow) => (
            <span className="chip" key={flow.id}>
              {flow.name}
            </span>
          ))
        ) : (
          <p className="muted">No connected flows.</p>
        )}
      </section>
      <Activity events={project.activity ?? []} />
    </article>
  );
}
