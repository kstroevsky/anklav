import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { WorkflowState, Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Hint } from '../../components/molecules/Hint';
import { Loading } from '../../components/atoms/Loading';
import { Status } from '../../components/atoms/Status';
import { Page } from '../../components/templates/Page';
import { CreateFlow } from './CreateFlow';
import { FlowDetail } from './FlowDetail';
import { useCursorList } from '../../hooks/useCursorList';
import { healthOptions } from '../../utils/healthOptions';
import { priorityOptions } from '../../utils/priorityOptions';
import { relativeTime } from '../../utils/formatting';

export function FlowsPage({ workspace }: { workspace: Workspace }) {
  const { flowId } = useParams(); const navigate = useNavigate(); const [filters, setFilters] = useState({ q: '', stateId: '', priority: '', health: '' }); const flows = useCursorList<any>(['flows', workspace.id], `/workspaces/${workspace.id}/flows`, filters); const states = useQuery<WorkflowState[]>({ queryKey: ['states', workspace.id, 'flow'], queryFn: () => api(`/workspaces/${workspace.id}/workflows?entity=flow`) });
  const setFilter = (name: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [name]: value }));
  return <Page heading="Flows" subheading="Persistent continuity of purpose across projects." action={<CreateFlow workspace={workspace} states={states.data ?? []} />}><div className="content-grid"><section className="list-panel"><input className="search" placeholder="Search flows" value={filters.q} onChange={(event) => setFilter('q', event.target.value)} /><div className="filter-grid compact"><select aria-label="Filter flow state" value={filters.stateId} onChange={(event) => setFilter('stateId', event.target.value)}><option value="">All states</option>{states.data?.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}</select><select aria-label="Filter flow priority" value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)}><option value="">All priorities</option>{priorityOptions()}</select><select aria-label="Filter flow health" value={filters.health} onChange={(event) => setFilter('health', event.target.value)}><option value="">All health</option>{healthOptions()}</select></div><div className="table-list">{flows.items.map(({ flow, state }) => <button key={flow.id} onClick={() => navigate(`/w/${workspace.id}/flows/${flow.id}`)} className={`row-button ${flowId === flow.id ? 'selected' : ''}`}><Status state={state} /><span className="row-main"><strong>{flow.name}</strong><small>{state.name} · {flow.health.replace('_', ' ')}</small></span><time>{relativeTime(flow.updatedAt)}</time></button>)}</div>{!flows.items.length && !flows.isLoading && <Empty title="No matching flows" text="Adjust filters or define a direction of work." />}{flows.hasNextPage && <button className="button load-more" onClick={() => flows.fetchNextPage()} disabled={flows.isFetchingNextPage}>{flows.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>}</section><section className="detail-panel">{flowId ? <FlowDetail workspace={workspace} flowId={flowId} states={states.data ?? []} /> : <Hint title="Choose a flow" text="Flows make strategic intent visible across project boundaries." />}</section></div></Page>;
}
