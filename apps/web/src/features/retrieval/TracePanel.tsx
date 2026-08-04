import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Workspace } from '../../api';
import type { SearchResponse } from './types';

export function TracePanel({ workspace, traceId, summary }: { workspace: Workspace; traceId: string; summary: SearchResponse['trace'] }) {
  const [open, setOpen] = useState(false);
  const trace = useQuery<any>({ queryKey: ['retrieval-trace', workspace.id, traceId], queryFn: () => api(`/workspaces/${workspace.id}/retrieval/traces/${traceId}`), enabled: open });
  return <section className="inspector-section trace-panel"><button className="section-header trace-toggle" onClick={() => setOpen(!open)}><span><h3>Retrieval trace</h3><small>{summary.semanticUsed ? 'Hybrid semantic + lexical' : 'Lexical fallback'} · {traceId}</small></span><span>{open ? 'Hide' : 'Inspect'}</span></button>{open && <pre>{JSON.stringify(trace.data ?? summary, null, 2)}</pre>}</section>;
}
