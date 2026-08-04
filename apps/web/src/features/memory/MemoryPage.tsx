import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation, type Page as ApiPage, type Project, type Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Page } from '../../components/templates/Page';
import { relativeTime } from '../../utils/formatting';
import { ClaimComposer } from './ClaimComposer';
import { DecisionComposer } from './DecisionComposer';
import { MemoryInspector } from './MemoryInspector';
import type { Claim, Decision, EvidenceRow } from './types';

export function MemoryPage({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient(); const admin = workspace.role === 'owner' || workspace.role === 'admin';
  const [tab, setTab] = useState<'claims' | 'decisions'>('claims'); const [projectId, setProjectId] = useState(''); const [historical, setHistorical] = useState(false); const [query, setQuery] = useState(''); const [selectedId, setSelectedId] = useState(''); const [compose, setCompose] = useState(false);
  const projects = useQuery<ApiPage<Project>>({ queryKey: ['memory-projects', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/projects?limit=100`) });
  useEffect(() => { if (!projectId && projects.data?.items[0]) setProjectId(projects.data.items[0].id); }, [projectId, projects.data]);
  const claims = useQuery<Claim[]>({ queryKey: ['memory-claims', workspace.id, projectId, historical], queryFn: () => api(`/workspaces/${workspace.id}/memory/claims?projectId=${projectId}&current=${!historical}`), enabled: Boolean(projectId) });
  const decisions = useQuery<Decision[]>({ queryKey: ['memory-decisions', workspace.id, projectId, historical], queryFn: () => api(`/workspaces/${workspace.id}/memory/decisions?projectId=${projectId}&current=${!historical}`), enabled: Boolean(projectId) });
  const evidence = useQuery<EvidenceRow[]>({ queryKey: ['evidence', workspace.id, 'all'], queryFn: () => api(`/workspaces/${workspace.id}/evidence-artifacts`) });
  const items = tab === 'claims' ? claims.data ?? [] : decisions.data ?? [];
  const filtered = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const selected: Claim | Decision | undefined = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const refresh = () => client.invalidateQueries({ queryKey: [`memory-${tab}`, workspace.id] });
  const resolve = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) => api(`/workspaces/${workspace.id}/memory/${tab}/${id}/resolve`, mutation('POST', { action, note: window.prompt('Resolution note') ?? '' })), onSuccess: refresh });
  const supersede = useMutation({ mutationFn: ({ id, replacementId }: { id: string; replacementId: string }) => api(`/workspaces/${workspace.id}/memory/${tab}/${id}/supersede`, mutation('POST', { replacementId, note: window.prompt('Supersession note') ?? '' })), onSuccess: refresh });
  return <Page heading="Memory" subheading="Durable claims and decisions, with evidence, validity, and full supersession history." action={<button className="button primary" disabled={!projectId} onClick={() => setCompose(true)}>Propose {tab === 'claims' ? 'claim' : 'decision'}</button>}>
    <div className="memory-toolbar"><div className="control-tabs"><button className={tab === 'claims' ? 'active' : ''} onClick={() => { setTab('claims'); setSelectedId(''); }}>Claims</button><button className={tab === 'decisions' ? 'active' : ''} onClick={() => { setTab('decisions'); setSelectedId(''); }}>Decisions</button></div><select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.data?.items.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><input placeholder="Search memory…" value={query} onChange={(event) => setQuery(event.target.value)} /><label className="check"><input type="checkbox" checked={historical} onChange={(event) => setHistorical(event.target.checked)} /> Include history</label></div>
    <div className="control-workbench memory-workbench"><aside className="control-list"><div className="control-list-heading"><span>{filtered.length} {tab}</span><span>{historical ? 'All states' : 'Current only'}</span></div><div className="control-rows">{filtered.map((item) => <button key={item.id} className={`memory-row ${item.id === selected?.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><span className={`memory-state ${item.status}`}></span><span>{tab === 'claims' ? <><strong>{(item as Claim).subject} · {(item as Claim).predicate}</strong><small>{(item as Claim).value}</small></> : <><strong>{(item as Decision).question}</strong><small>{(item as Decision).selectedOption}</small></>}</span><span><em>{item.status}</em><time>{relativeTime(tab === 'claims' ? (item as Claim).recordedAt : (item as Decision).createdAt)}</time></span></button>)}</div>{!filtered.length && <Empty title={`No ${tab}`} text="Adjust the filters or propose durable memory from verified work." />}</aside>
      <section className="control-detail">{selected ? <MemoryInspector item={selected} kind={tab} admin={admin} allItems={items} onResolve={(action) => resolve.mutate({ id: selected.id, action })} onSupersede={(replacementId) => supersede.mutate({ id: selected.id, replacementId })} /> : <Empty title="Choose memory" text="Inspect validity, confidence, evidence, and history." />}</section></div>
    {compose && (tab === 'claims' ? <ClaimComposer workspace={workspace} projectId={projectId} evidence={evidence.data ?? []} close={() => setCompose(false)} done={() => { setCompose(false); refresh(); }} /> : <DecisionComposer workspace={workspace} projectId={projectId} evidence={evidence.data ?? []} close={() => setCompose(false)} done={() => { setCompose(false); refresh(); }} />)}
  </Page>;
}
