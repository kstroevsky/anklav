import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { Project, Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Hint } from '../../components/molecules/Hint';
import { Page } from '../../components/templates/Page';
import { CreateProject } from './CreateProject';
import { ProjectDetail } from './ProjectDetail';
import { useCursorList } from '../../hooks/useCursorList';
import { healthOptions } from '../../utils/healthOptions';
import { priorityOptions } from '../../utils/priorityOptions';
import { relativeTime } from '../../utils/formatting';

export function ProjectsPage({ workspace }: { workspace: Workspace }) {
  const { projectId } = useParams(); const navigate = useNavigate(); const [filters, setFilters] = useState({ q: '', status: '', priority: '', health: '' }); const projects = useCursorList<Project>(['projects', workspace.id], `/workspaces/${workspace.id}/projects`, filters);
  const setFilter = (name: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [name]: value }));
  return <Page heading="Projects" subheading="Stable technical ownership boundaries." action={<CreateProject workspace={workspace} />}><div className="content-grid"><section className="list-panel"><input className="search" placeholder="Search projects" value={filters.q} onChange={(event) => setFilter('q', event.target.value)} /><div className="filter-grid compact"><select aria-label="Filter project status" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">All statuses</option>{['proposed', 'planned', 'active', 'paused', 'completed', 'archived'].map((status) => <option key={status} value={status}>{status}</option>)}</select><select aria-label="Filter project priority" value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}><option value="">All priorities</option>{priorityOptions()}</select><select aria-label="Filter project health" value={filters.health} onChange={(event) => setFilter('health', event.target.value)}><option value="">All health</option>{healthOptions()}</select></div><div className="table-list">{projects.items.map((project) => <button key={project.id} onClick={() => navigate(`/w/${workspace.id}/projects/${project.id}`)} className={`row-button ${projectId === project.id ? 'selected' : ''}`}><span className="project-mark">P</span><span className="row-main"><strong>{project.name}</strong><small>{project.status} · {project.health.replace('_', ' ')}</small></span><time>{relativeTime(project.updatedAt)}</time></button>)}</div>{!projects.items.length && !projects.isLoading && <Empty title="No matching projects" text="Adjust filters or create a technical home for work." />}{projects.hasNextPage && <button className="button load-more" onClick={() => projects.fetchNextPage()} disabled={projects.isFetchingNextPage}>{projects.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</section><section className="detail-panel">{projectId ? <ProjectDetail workspace={workspace} projectId={projectId} /> : <Hint title="Choose a project" text="Projects stay stable even as priorities and flows change." />}</section></div></Page>;
}
