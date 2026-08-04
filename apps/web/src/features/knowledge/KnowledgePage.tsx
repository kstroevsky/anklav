import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Page as ApiPage, type Project, type Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Page } from '../../components/templates/Page';
import { relativeTime } from '../../utils/formatting';
import { ArtifactComposer } from './ArtifactComposer';
import { ArtifactInspector } from './ArtifactInspector';
import { ContextPackBuilder } from './ContextPackBuilder';
import { MilestoneComposer } from './MilestoneComposer';
import { MilestoneInspector } from './MilestoneInspector';
import type { Artifact, Milestone } from './types';
import { useCursorList } from '../../hooks/useCursorList';
import { useSearchParams } from 'react-router-dom';

export function KnowledgePage({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient(); const admin = workspace.role !== 'member'; const [params] = useSearchParams(); const linkedArtifact = params.get('artifact') ?? ''; const [tab, setTab] = useState<'milestones' | 'artifacts' | 'context'>(linkedArtifact ? 'artifacts' : 'milestones'); const [selectedId, setSelectedId] = useState(linkedArtifact); const [query, setQuery] = useState(''); const [compose, setCompose] = useState(false);
  const milestones = useQuery<Milestone[]>({ queryKey: ['milestones', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/milestones`) });
  const artifacts = useQuery<Artifact[]>({ queryKey: ['knowledge-artifacts', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/knowledge-artifacts`) });
  const projects = useQuery<ApiPage<Project>>({ queryKey: ['projects-for-knowledge', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/projects?limit=100`) });
  const flows = useCursorList<any>(['flows-for-knowledge', workspace.id], `/workspaces/${workspace.id}/flows`, {}); const tasks = useCursorList<any>(['tasks-for-knowledge', workspace.id], `/workspaces/${workspace.id}/tasks`, {});
  const items = tab === 'milestones' ? milestones.data ?? [] : artifacts.data ?? []; const filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase())); const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  return <Page heading="Knowledge" subheading="Milestones, revisioned artifacts, canonical Git sources, and understandable task context packs." action={tab !== 'context' ? <button className="button primary" onClick={() => setCompose(true)}>New {tab === 'milestones' ? 'milestone' : 'artifact'}</button> : undefined}>
    <div className="knowledge-tabs control-tabs"><button className={tab === 'milestones' ? 'active' : ''} onClick={() => { setTab('milestones'); setSelectedId(''); }}>Milestones</button><button className={tab === 'artifacts' ? 'active' : ''} onClick={() => { setTab('artifacts'); setSelectedId(''); }}>Artifacts</button><button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>Context packs</button></div>
    {tab === 'context' ? <ContextPackBuilder workspace={workspace} /> : <div className="control-workbench knowledge-workbench">
      <aside className="control-list"><div className="control-toolbar"><input placeholder={`Search ${tab}…`} value={query} onChange={(event) => setQuery(event.target.value)} /></div><div className="control-list-heading"><span>{filtered.length} {tab}</span><span>Updated</span></div>{filtered.map((item) => <button key={item.id} className={`knowledge-row ${item.id === selected?.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><span className="artifact-glyph">{tab === 'milestones' ? '◆' : 'K'}</span><span><strong>{tab === 'milestones' ? (item as Milestone).name : (item as Artifact).title}</strong><small>{tab === 'milestones' ? (item as Milestone).status : `${(item as Artifact).type.replaceAll('_', ' ')} · ${(item as Artifact).canonicality}`}</small></span><time>{relativeTime(item.updatedAt)}</time></button>)}{!filtered.length && <Empty title={`No ${tab}`} text="Create the first durable knowledge record." />}</aside>
      <section className="control-detail">{selected ? tab === 'milestones' ? <MilestoneInspector workspace={workspace} item={selected as Milestone} refresh={() => client.invalidateQueries({ queryKey: ['milestones', workspace.id] })} /> : <ArtifactInspector workspace={workspace} item={selected as Artifact} all={artifacts.data ?? []} admin={admin} refresh={() => client.invalidateQueries({ queryKey: ['knowledge-artifacts', workspace.id] })} /> : null}</section>
    </div>}
    {compose && (tab === 'milestones' ? <MilestoneComposer workspace={workspace} projects={projects.data?.items ?? []} flows={flows.items.map((entry) => entry.flow)} tasks={tasks.items.map((entry) => entry.task)} close={() => setCompose(false)} done={() => { setCompose(false); client.invalidateQueries({ queryKey: ['milestones', workspace.id] }); }} /> : <ArtifactComposer workspace={workspace} projects={projects.data?.items ?? []} flows={flows.items.map((entry) => entry.flow)} tasks={tasks.items.map((entry) => entry.task)} close={() => setCompose(false)} done={() => { setCompose(false); client.invalidateQueries({ queryKey: ['knowledge-artifacts', workspace.id] }); }} />)}
  </Page>;
}
