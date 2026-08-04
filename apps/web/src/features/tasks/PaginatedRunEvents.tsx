import { useAfterList } from '../../hooks/useAfterList';
import type { Workspace } from '../../api';
import type { RunEvent } from './taskRunsTypes';
import { RunEvents } from './RunEvents';

export function PaginatedRunEvents({ workspace, runId }: { workspace: Workspace; runId: string }) {
  const events = useAfterList<RunEvent>(['run-events', workspace.id, runId], `/workspaces/${workspace.id}/runs/${runId}/events`);
  return <><div className="loaded-count">{events.items.length} events loaded{events.hasNextPage ? ' · more available' : ' · complete'}</div><RunEvents events={events.items} />{events.hasNextPage ? <button className="button" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>{events.isFetchingNextPage ? 'Loading…' : 'Load more events'}</button> : null}</>;
}
