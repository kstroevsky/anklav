import { StatusText } from './StatusText';
import { compactJson } from './taskRunsUtils';
import type { SessionItem } from './taskRunsTypes';

export function SessionItemRow({ item }: { item: SessionItem }) {
  const content = item.contentWithheld ? 'Content withheld by redaction policy.' : item.summary || compactJson(item.redactedContent);
  return <article className={`transcript-row type-${item.type} ${item.contentWithheld ? 'withheld' : ''}`}><time>{new Date(item.occurredAt).toLocaleTimeString()}</time><span className="item-kind"><strong>{item.role ?? item.type.replaceAll('_', ' ')}</strong><small>{item.type.replaceAll('_', ' ')}</small></span><div className="item-content"><p>{content}</p>{item.correlationId && <small>Correlation {item.correlationId}{item.relationshipType ? ` · ${item.relationshipType.replaceAll('_', ' ')}` : ''}</small>}</div><StatusText value={item.redactionStatus} /></article>;
}
