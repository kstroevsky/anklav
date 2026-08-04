import { useQuery } from '@tanstack/react-query';
import { api, type Workspace } from '../../api';
import { useAfterList } from '../../hooks/useAfterList';
import { SessionItemRow } from '../tasks/SessionItemRow';
import type { Ingestion, SessionItem } from '../tasks/taskRunsTypes';
import type { SharedSession } from './types';

export function NativeSessionInspector({ workspace, session }: { workspace: Workspace; session: SharedSession }) {
  const detail = useQuery<any>({ queryKey: ['native-session-detail', workspace.id, session.id], queryFn: () => api(`/workspaces/${workspace.id}/native-sessions/${session.id}`) });
  const items = useAfterList<SessionItem>(['native-session-items', workspace.id, session.id], `/workspaces/${workspace.id}/native-sessions/${session.id}/items`);
  return <section className="control-detail"><header className="control-detail-header"><div><span className="eyebrow">{session.provider} session</span><h2>{session.nativeSessionId}</h2><p>{session.task.identifier} · run {session.run.id.slice(0, 8)} · {session.run.machineIdentity}</p></div></header><div className="fact-strip"><div><small>Resumability</small><strong>{session.resumability}</strong></div><div><small>Ingestion</small><strong>{session.ingestionStatus}</strong></div><div><small>Parser</small><strong>{session.parserVersion ?? '—'}</strong></div><div><small>Items</small><strong>{items.items.length} / {session.recordCount}</strong></div></div><section className="inspector-section"><h3>Ingestion revisions</h3>{detail.data?.ingestions?.map((entry: Ingestion) => <div className="alias-row" key={entry.id}><strong>{entry.sourceRevision}</strong><span>{entry.status} · parser {entry.parserVersion}</span><small>{entry.itemCount} items · {entry.errors.length} errors</small></div>) ?? <p className="muted">Loading revisions…</p>}</section><section className="inspector-section"><h3>Normalized timeline</h3><div className="transcript">{items.items.map((item) => <SessionItemRow key={item.id} item={item} />)}</div>{items.hasNextPage ? <button className="button" disabled={items.isFetchingNextPage} onClick={() => void items.fetchNextPage()}>Load more items</button> : null}</section></section>;
}
