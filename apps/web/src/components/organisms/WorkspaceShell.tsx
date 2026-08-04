import { useQuery } from '@tanstack/react-query';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { Brand } from '../atoms/Brand';
import { Page } from '../templates/Page';
import { ChangePoller } from './ChangePoller';
import { OfflineNotice } from '../atoms/OfflineNotice';
import { KnowledgePage } from '../../features/knowledge/KnowledgePage';
import { FlowsPage } from '../../features/flows/FlowsPage';
import { ReviewsPage } from '../../features/github/ReviewsPage';
import { InboxPage } from '../../features/github/InboxPage';
import { GitHubSettings } from '../../features/github/GitHubSettings';
import { ProjectsPage } from '../../features/projects/ProjectsPage';
import { SearchPage } from '../../features/search/SearchPage';
import { SettingsPage } from '../../features/settings/SettingsPage';
import { TasksPage } from '../../features/tasks/TasksPage';
import { EvidencePage } from '../../features/evidence/EvidencePage';
import { MemoryPage } from '../../features/memory/MemoryPage';
import { RetrievalPage } from '../../features/retrieval/RetrievalPage';
import { MachinesPage } from '../../features/machines/MachinesPage';
import { SharedCodexPage } from '../../features/sessions/SharedCodexPage';
import type { Session } from '../../app/types';
import type { Workspace } from '../../api';

const nav = [{ to: 'tasks', label: 'Tasks', mark: 'T' }, { to: 'projects', label: 'Projects', mark: 'P' }, { to: 'flows', label: 'Flows', mark: 'F' }, { to: 'machines', label: 'Machines', mark: '⌘' }, { to: 'sessions', label: 'Shared Codex', mark: 'C' }, { to: 'evidence', label: 'Evidence', mark: 'E' }, { to: 'memory', label: 'Memory', mark: 'M' }, { to: 'retrieval', label: 'Retrieval', mark: '⌕' }, { to: 'knowledge', label: 'Knowledge', mark: 'K' }, { to: 'reviews', label: 'Reviews', mark: 'R' }, { to: 'inbox', label: 'Inbox', mark: '●' }, { to: 'github', label: 'GitHub', mark: 'GH' }, { to: 'search', label: 'Search', mark: 'S' }];

export function WorkspaceShell({ session, workspaces, theme, setTheme }: { session: Session; workspaces: Workspace[]; theme: 'system' | 'light' | 'dark'; setTheme: (next: 'system' | 'light' | 'dark') => void }) {
  const { workspaceId = '' } = useParams(); const navigate = useNavigate(); const current = workspaces.find((workspace) => workspace.id === workspaceId) ?? workspaces[0]!;
  const unread = useQuery<{ unread: number }>({ queryKey: ['github-notification-count', current.id], queryFn: () => api(`/workspaces/${current.id}/github/notifications/unread-count`), refetchInterval: 15_000, retry: false });
  if (current.id !== workspaceId) return <Navigate to={`/w/${current.id}/tasks`} replace />;
  return <div className="app-shell"><aside className="sidebar"><Brand compact /><label className="workspace-select"><span>Workspace</span><select value={current.id} onChange={(event) => navigate(`/w/${event.target.value}/tasks`)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><nav>{nav.map((item) => <NavLink key={item.to} to={`/w/${current.id}/${item.to}`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><b>{item.mark}</b>{item.label}{item.to === 'inbox' && unread.data?.unread ? <span className="nav-badge">{unread.data.unread > 99 ? '99+' : unread.data.unread}</span> : null}</NavLink>)}<NavLink to={`/w/${current.id}/settings`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><b>⚙</b>Settings</NavLink></nav><div className="sidebar-footer"><button className="text-button" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>Theme: {theme}</button><span>{session.user.displayName}</span></div></aside><main className="workspace-main"><OfflineNotice /><ChangePoller workspaceId={current.id} /><Routes><Route path="tasks/:taskId?" element={<TasksPage workspace={current} />} /><Route path="projects/:projectId?" element={<ProjectsPage workspace={current} />} /><Route path="flows/:flowId?" element={<FlowsPage workspace={current} />} /><Route path="machines" element={<MachinesPage workspace={current} />} /><Route path="sessions" element={<SharedCodexPage workspace={current} />} /><Route path="evidence" element={<EvidencePage workspace={current} />} /><Route path="memory" element={<MemoryPage workspace={current} />} /><Route path="retrieval" element={<RetrievalPage workspace={current} />} /><Route path="knowledge" element={<KnowledgePage workspace={current} />} /><Route path="reviews/:pullRequestId?" element={<ReviewsPage workspace={current} />} /><Route path="inbox" element={<InboxPage workspace={current} />} /><Route path="github" element={<Page heading="GitHub" subheading="Connect repositories, issue sync, and review workflows."><GitHubSettings workspace={current} /></Page>} /><Route path="search" element={<SearchPage workspace={current} />} /><Route path="settings/*" element={<SettingsPage workspace={current} session={session} />} /><Route path="*" element={<Navigate to="tasks" replace />} /></Routes></main></div>;
}
