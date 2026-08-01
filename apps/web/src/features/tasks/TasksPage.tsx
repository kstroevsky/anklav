import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { Page as ApiPage, Project, WorkflowState, Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Hint } from '../../components/molecules/Hint';
import { Loading } from '../../components/atoms/Loading';
import { Status } from '../../components/atoms/Status';
import { Page } from '../../components/templates/Page';
import { CreateTask } from './CreateTask';
import { TaskDetail } from './TaskDetail';
import { useCursorList } from '../../hooks/useCursorList';
import { priorityOptions } from '../../utils/priorityOptions';
import { relativeTime } from '../../utils/formatting';

export function TasksPage({ workspace }: { workspace: Workspace }) {
  const { taskId } = useParams(); const navigate = useNavigate(); const [filters, setFilters] = useState({ q: '', projectId: '', flowId: '', stateId: '', priority: '', assigneeMembershipId: '', labelId: '' });
  const tasks = useCursorList<any>(['tasks', workspace.id], `/workspaces/${workspace.id}/tasks`, filters);
  const projects = useQuery<ApiPage<Project>>({ queryKey: ['project-options', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/projects?limit=100`) });
  const states = useQuery<WorkflowState[]>({ queryKey: ['states', workspace.id, 'task'], queryFn: () => api(`/workspaces/${workspace.id}/workflows?entity=task`) });
  const flows = useQuery<ApiPage<any>>({ queryKey: ['flow-options', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/flows?limit=100`) });
  const members = useQuery<any[]>({ queryKey: ['members', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/members`) });
  const labels = useQuery<any[]>({ queryKey: ['labels', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/labels`) });
  const setFilter = (name: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [name]: value }));
  return <Page heading="Tasks" subheading="Bounded work with a clear technical home." action={<CreateTask workspace={workspace} projects={projects.data?.items ?? []} states={states.data ?? []} />}><div className="content-grid"><section className="list-panel"><input className="search" placeholder="Search tasks" value={filters.q} onChange={(event) => setFilter('q', event.target.value)} /><div className="filter-grid"><select aria-label="Filter by project" value={filters.projectId} onChange={(event) => setFilter('projectId', event.target.value)}><option value="">All projects</option>{projects.data?.items.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Filter by flow" value={filters.flowId} onChange={(event) => setFilter('flowId', event.target.value)}><option value="">All flows</option>{flows.data?.items.map(({ flow }) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}</select><select aria-label="Filter by task state" value={filters.stateId} onChange={(event) => setFilter('stateId', event.target.value)}><option value="">All states</option>{states.data?.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}</select><select aria-label="Filter by priority" value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}><option value="">All priorities</option>{priorityOptions()}</select><select aria-label="Filter by assignee" value={filters.assigneeMembershipId} onChange={(event) => setFilter('assigneeMembershipId', event.target.value)}><option value="">Anyone</option>{members.data?.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select><select aria-label="Filter by label" value={filters.labelId} onChange={(event) => setFilter('labelId', event.target.value)}><option value="">All labels</option>{labels.data?.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select></div>{tasks.isLoading ? <Loading /> : <div className="table-list">{tasks.items.map((row) => <button key={row.task.id} onClick={() => navigate(`/w/${workspace.id}/tasks/${row.task.identifier ?? row.task.id}`)} className={`row-button ${taskId === row.task.id || taskId === row.task.identifier ? 'selected' : ''}`}><Status state={row.state} /><span className="row-main"><strong>{row.task.title}</strong><small>{row.task.identifier} · {row.project.name} · {row.task.priority}</small></span><time>{relativeTime(row.task.updatedAt)}</time></button>)}</div>}{!tasks.items.length && !tasks.isLoading && <Empty title="No matching tasks" text="Adjust filters or capture the next bounded piece of work." />}{tasks.hasNextPage && <button className="button load-more" onClick={() => tasks.fetchNextPage()} disabled={tasks.isFetchingNextPage}>{tasks.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</section><section className="detail-panel">{taskId ? <TaskDetail workspace={workspace} taskId={taskId} states={states.data ?? []} /> : <Hint title="Choose a task" text="Open a task to see its purpose, criteria, evidence, and history." />}</section></div></Page>;
}
