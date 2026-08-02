import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import type { Workspace } from '../../api';
import { relativeTime } from '../../utils/formatting';

type NativeSession = {
  id: string;
  provider: string;
  nativeSessionId: string;
  sourceKind: string;
  resumability: string;
  ingestionStatus: string;
  sourceRevision: string | null;
  parserVersion: string | null;
  recordCount: number;
  parseErrors: Record<string, unknown>[];
};

type Run = {
  id: string;
  provider: string;
  client: string;
  status: string;
  outcomeSummary: string;
  startedAt: string;
  endedAt: string | null;
  nativeSessions: NativeSession[];
};

export function TaskRuns({ workspace, taskId }: { workspace: Workspace; taskId: string }) {
  const runs = useQuery<Run[]>({
    queryKey: ['task-runs', workspace.id, taskId],
    queryFn: () => api(`/workspaces/${workspace.id}/tasks/${taskId}/runs`),
    refetchInterval: 15_000,
  });
  if (!runs.data?.length) return null;
  return (
    <section>
      <h3>Execution history</h3>
      <div className="comments">
        {runs.data.map((run) => (
          <details className="comment" key={run.id}>
            <summary><strong>{run.provider} · {run.client}</strong> <span className="muted">{run.status} · {relativeTime(run.startedAt)}</span></summary>
            {run.outcomeSummary && <p>{run.outcomeSummary}</p>}
            {run.nativeSessions.length ? run.nativeSessions.map((session) => (
              <div key={session.id}>
                <p><strong>{session.nativeSessionId}</strong> · {session.sourceKind} · {session.ingestionStatus}</p>
                <small>{session.recordCount} normalized items · {session.resumability}{session.sourceRevision ? ` · revision ${session.sourceRevision}` : ''}{session.parserVersion ? ` · parser ${session.parserVersion}` : ''}</small>
                {session.parseErrors.length > 0 && <p className="muted">{session.parseErrors.length} parser error{session.parseErrors.length === 1 ? '' : 's'} retained with provenance.</p>}
              </div>
            )) : <p className="muted">No provider-native session attached.</p>}
          </details>
        ))}
      </div>
    </section>
  );
}
