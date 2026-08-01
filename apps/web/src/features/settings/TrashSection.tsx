import type { Workspace } from '../../api';
import { relativeTime } from '../../utils/formatting';

export function TrashSection({ workspace, trash, restore }: { workspace: Workspace; trash: any; restore: any }) {
  const entries = trash ? Object.entries(trash).flatMap(([kind, items]) => (items as any[]).map((item) => ({ kind: kind.replace(/s$/, ''), item }))) : [];
  return <section className="settings-card"><h2>Trash</h2>{entries.length ? <div className="trash-list">{entries.map(({ kind, item }) => <div className="setting-row" key={`${kind}-${item.id}`}><span><strong>{item.name ?? item.title ?? item.body?.slice(0, 48) ?? kind}</strong><small>{kind} · deleted {relativeTime(item.deletedAt)}</small></span><button className="button" disabled={restore.isPending} onClick={() => restore.mutate({ kind, item })}>Restore</button></div>)}</div> : <p className="muted">Nothing is currently deleted.</p>}</section>;
}
