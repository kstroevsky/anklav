import { compactJson } from './taskRunsUtils';
import type { RunEvent } from './taskRunsTypes';

export function RunEvents({ events }: { events: RunEvent[] }) {
  if (!events.length) return <p className="muted ops-empty">No run events were recorded.</p>;
  return <div className="event-table">{events.map((event) => <div key={event.id} className={event.type.includes('fail') || event.type.includes('error') ? 'event-error' : ''}><time>{new Date(event.occurredAt).toLocaleTimeString()}</time><strong>{event.type.replaceAll('_', ' ')}</strong><code>{compactJson(event.payload)}</code><small>#{event.sequence}</small></div>)}</div>;
}
