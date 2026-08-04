import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, type Workspace } from '../../api';
import { Page } from '../../components/templates/Page';
import { relativeTime } from '../../utils/formatting';
import { NativeSessionInspector } from './NativeSessionInspector';
import type { SessionPage } from './types';

export function SharedCodexPage({ workspace }: { workspace: Workspace }) {
  const [selected, setSelected] = useState(''); const sessions = useInfiniteQuery({ queryKey: ['shared-native-sessions', workspace.id], initialPageParam: 0, queryFn: ({ pageParam }) => api<SessionPage>(`/workspaces/${workspace.id}/native-sessions?offset=${pageParam}&limit=100`), getNextPageParam: (page) => page.nextOffset ?? undefined });
  const items = sessions.data?.pages.flatMap((page) => page.items) ?? []; const total = sessions.data?.pages[0]?.total ?? 0; const current = items.find((item) => item.id === selected) ?? items[0];
  return <Page heading="Shared Codex data" subheading="Normalized provider sessions shared across machines, tasks, runs, and ingestion revisions."><div className="control-workbench shared-sessions"><aside className="control-list"><div className="control-list-heading"><span>{items.length} / {total} sessions loaded</span><span>Newest sync first</span></div><div className="control-rows">{items.map((session) => <button key={session.id} className={`control-row ${session.id === current?.id ? 'selected' : ''}`} onClick={() => setSelected(session.id)}><span className="artifact-glyph">⌁</span><span><strong>{session.task.identifier} · {session.nativeSessionId}</strong><small>{session.provider} · {session.recordCount} items · {session.ingestionStatus}</small></span><time>{session.lastIngestedAt ? relativeTime(session.lastIngestedAt) : 'not synced'}</time></button>)}</div>{sessions.hasNextPage ? <button className="button" disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>Load more sessions</button> : null}</aside>{current ? <NativeSessionInspector workspace={workspace} session={current} /> : <section className="control-detail"><p className="muted">No shared sessions have been imported.</p></section>}</div></Page>;
}
