import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, mutation } from '../../api';
import type { Workspace } from '../../api';
import { relativeTime } from '../../utils/formatting';
import { Checkpoints } from './Checkpoints';
import { GitSlices } from './GitSlices';
import { RunEvents } from './RunEvents';
import { SessionItemRow } from './SessionItemRow';
import { StatusText } from './StatusText';
import { compactJson, expiresIn, runLineage, shortId, tokenTotal } from './taskRunsUtils';
import type { Ingestion, Lease, Run, RunDetail, SessionItem } from './taskRunsTypes';

export function TaskRuns({ workspace, taskId }: { workspace: Workspace; taskId: string }) {
  const client = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [runFilter, setRunFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [showWithheld, setShowWithheld] = useState(false);
  const [tab, setTab] = useState<'events' | 'git' | 'checkpoints'>('events');

  const runs = useQuery<Run[]>({
    queryKey: ['task-runs', workspace.id, taskId],
    queryFn: () => api(`/workspaces/${workspace.id}/tasks/${taskId}/runs`),
    refetchInterval: 15_000,
  });
  const leases = useQuery<Lease[]>({
    queryKey: ['task-leases', workspace.id, taskId],
    queryFn: () => api(`/workspaces/${workspace.id}/tasks/${taskId}/leases`),
    refetchInterval: 15_000,
  });
  const selectedRunId = selectedRun ?? runs.data?.[0]?.id ?? null;
  const detail = useQuery<RunDetail>({
    queryKey: ['run-detail', workspace.id, selectedRunId],
    queryFn: () => api(`/workspaces/${workspace.id}/runs/${selectedRunId}`),
    enabled: Boolean(selectedRunId),
    refetchInterval: 15_000,
  });
  const selectedSessionId = selectedSession && detail.data?.nativeSessions.some((session) => session.id === selectedSession)
    ? selectedSession
    : detail.data?.nativeSessions[0]?.id ?? null;
  const sessionItems = useQuery<{ items: SessionItem[]; nextAfter: number | null }>({
    queryKey: ['native-session-items', workspace.id, selectedSessionId],
    queryFn: () => api(`/workspaces/${workspace.id}/native-sessions/${selectedSessionId}/items`),
    enabled: Boolean(selectedSessionId),
  });
  const ingestions = useQuery<Ingestion[]>({
    queryKey: ['native-session-ingestions', workspace.id, selectedSessionId],
    queryFn: () => api(`/workspaces/${workspace.id}/native-sessions/${selectedSessionId}/ingestions`),
    enabled: Boolean(selectedSessionId),
  });

  const leaseAction = useMutation({
    mutationFn: ({ leaseId, action }: { leaseId: string; action: 'renew' | 'release' }) =>
      api(`/workspaces/${workspace.id}/leases/${leaseId}/${action}`, mutation('POST', action === 'renew' ? { ttlSeconds: 900 } : undefined)),
    onSuccess: () => client.invalidateQueries({ queryKey: ['task-leases', workspace.id, taskId] }),
  });

  const filteredRuns = useMemo(() => {
    const query = runFilter.trim().toLowerCase();
    const values = runs.data ?? [];
    return query ? values.filter((run) => [run.id, run.provider, run.client, run.model, run.machineIdentity, run.status].some((value) => value?.toLowerCase().includes(query))) : values;
  }, [runs.data, runFilter]);
  const lineage = useMemo(() => runLineage(filteredRuns), [filteredRuns]);
  const filteredItems = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase();
    return (sessionItems.data?.items ?? []).filter((item) => (showWithheld || !item.contentWithheld) && (!query || [item.type, item.role, item.summary, compactJson(item.redactedContent)].some((value) => value?.toLowerCase().includes(query))));
  }, [sessionItems.data, sessionFilter, showWithheld]);

  if (runs.isLoading || leases.isLoading) return <section className="task-operations"><p className="muted">Loading task operations…</p></section>;
  if (!runs.data?.length) return (
    <section className="task-operations empty-operations">
      <div><h3>Operations</h3><p className="muted">No execution runs have been recorded for this task yet.</p></div>
    </section>
  );

  const activeRun = runs.data.find((run) => run.status === 'running') ?? null;
  const activeLease = leases.data?.find((lease) => lease.runId === activeRun?.id) ?? leases.data?.[0] ?? null;
  const newestSession = runs.data.flatMap((run) => run.nativeSessions).filter((session) => session.lastIngestedAt).sort((a, b) => Date.parse(b.lastIngestedAt!) - Date.parse(a.lastIngestedAt!))[0];
  const latestSlice = detail.data?.gitSlices.at(-1);
  const latestCheckpoint = detail.data?.checkpoints.at(-1);
  const ready = Boolean(activeRun && activeLease && activeRun.nativeSessions.some((session) => session.resumability === 'resumable') && latestSlice?.dirtyState !== 'dirty_missing');

  return (
    <section className="task-operations">
      <div className="ops-heading">
        <div><h3>Operations</h3><p>Runs, machines, leases, Git state, checkpoints, and imported provider history.</p></div>
        <span className="ops-live"><i />Updates every 15 seconds</span>
      </div>

      <div className="ops-overview">
        <div className={`readiness ${ready ? 'ready' : 'attention'}`}>
          <strong>{ready ? 'Ready to continue' : activeRun ? 'Reconciliation needed' : 'No active run'}</strong>
          <small>{ready ? 'Session, lease, and Git state are aligned.' : 'Review the active run, lease, and latest Git slice.'}</small>
        </div>
        <div><small>Active machine</small><strong>{activeLease?.machineIdentity ?? activeRun?.machineIdentity ?? '—'}</strong><span>{activeRun ? `${activeRun.provider} · ${activeRun.client}` : 'No active execution'}</span></div>
        <div><small>Lease</small><strong>{activeLease ? `${activeLease.writeAccess ? 'Write' : 'Read'}${activeLease.exclusive ? ' · exclusive' : ''}` : 'None'}</strong><span>{activeLease ? `Expires ${expiresIn(activeLease.expiresAt)}` : 'No machine owns this task'}</span></div>
        <div><small>Last sync</small><strong>{newestSession?.lastIngestedAt ? relativeTime(newestSession.lastIngestedAt) : 'Never'}</strong><span>{newestSession ? newestSession.ingestionStatus.replaceAll('_', ' ') : 'No imported session'}</span></div>
        <div><small>Latest checkpoint</small><strong>{latestCheckpoint ? `#${latestCheckpoint.sequence}` : 'None'}</strong><span>{latestCheckpoint ? relativeTime(latestCheckpoint.createdAt) : 'No checkpoint on selected run'}</span></div>
        <div><small>Git state</small><strong>{latestSlice?.branchName ?? 'Not captured'}</strong><span>{latestSlice ? `${latestSlice.dirtyState.replaceAll('_', ' ')} · ${shortId(latestSlice.headCommitSha)}` : 'Select a run with Git state'}</span></div>
      </div>

      {leases.data?.length ? (
        <div className="lease-rail">
          {leases.data.map((lease) => (
            <div key={lease.id} className="lease-row">
              <StatusText value={lease.writeAccess ? 'write lease' : 'read lease'} />
              <strong>{lease.machineIdentity}</strong>
              <span>{lease.activity}</span>
              <code>{lease.pathScope.length ? lease.pathScope.join(', ') : 'all task paths'}</code>
              <small>expires {expiresIn(lease.expiresAt)}</small>
              <button className="text-button" disabled={leaseAction.isPending} onClick={() => leaseAction.mutate({ leaseId: lease.id, action: 'renew' })}>Renew 15m</button>
              <button className="text-button danger" disabled={leaseAction.isPending} onClick={() => leaseAction.mutate({ leaseId: lease.id, action: 'release' })}>Release</button>
            </div>
          ))}
          {leaseAction.error && <p className="error lease-error">{leaseAction.error instanceof ApiError ? leaseAction.error.message : 'The lease action failed.'}</p>}
        </div>
      ) : null}

      <div className="run-workbench">
        <aside className="run-list">
          <div className="workbench-title"><h3>Execution runs</h3><span>{runs.data.length}</span></div>
          <input className="ops-search" value={runFilter} onChange={(event) => setRunFilter(event.target.value)} placeholder="Filter runs…" aria-label="Filter execution runs" />
          <div className="run-table-head"><span>Run / lineage</span><span>Status</span><span>Usage</span></div>
          <div className="run-rows">
            {lineage.map(({ run, depth }) => (
              <button key={run.id} className={`run-row ${run.id === selectedRunId ? 'selected' : ''}`} onClick={() => { setSelectedRun(run.id); setSelectedSession(null); }}>
                <span className="run-identity" style={{ paddingLeft: `${depth * 17}px` }}><i className={depth ? 'branch' : ''} /><span><strong>{shortId(run.id)}</strong><small>{run.machineIdentity}</small></span></span>
                <StatusText value={run.status} />
                <span className="run-usage"><strong>{tokenTotal(run.tokenUsage)?.toLocaleString() ?? '—'}</strong><small>{run.costMicros == null ? 'not reported' : `$${(run.costMicros / 1_000_000).toFixed(4)}`}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <div className="run-detail">
          {!detail.data ? <p className="muted ops-loading">Loading run details…</p> : (
            <>
              <header className="run-detail-header">
                <div><h3>Run {shortId(detail.data.id)}</h3><StatusText value={detail.data.status} /></div>
                <small>{new Date(detail.data.startedAt).toLocaleString()}{detail.data.endedAt ? ` → ${new Date(detail.data.endedAt).toLocaleString()}` : ''}</small>
              </header>
              <div className="run-facts">
                <div><small>Provider / client</small><strong>{detail.data.provider} · {detail.data.client}</strong></div>
                <div><small>Agent / model</small><strong>{detail.data.agentType} · {detail.data.model ?? 'not reported'}</strong></div>
                <div><small>Reasoning</small><strong>{compactJson(detail.data.reasoningConfig)}</strong></div>
                <div><small>Machine</small><strong>{detail.data.machineIdentity}</strong></div>
                <div><small>Token usage</small><strong>{compactJson(detail.data.tokenUsage)}</strong></div>
                <div><small>Cost</small><strong>{detail.data.costMicros == null ? 'Not reported' : `$${(detail.data.costMicros / 1_000_000).toFixed(6)}`}</strong></div>
              </div>
              {detail.data.outcomeSummary && <p className="run-outcome">{detail.data.outcomeSummary}</p>}
              <div className="ops-tabs" role="tablist">
                <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events <span>{detail.data.events.length}</span></button>
                <button className={tab === 'git' ? 'active' : ''} onClick={() => setTab('git')}>Git slices <span>{detail.data.gitSlices.length}</span></button>
                <button className={tab === 'checkpoints' ? 'active' : ''} onClick={() => setTab('checkpoints')}>Checkpoints <span>{detail.data.checkpoints.length}</span></button>
              </div>
              {tab === 'events' && <RunEvents events={detail.data.events} />}
              {tab === 'git' && <GitSlices slices={detail.data.gitSlices} />}
              {tab === 'checkpoints' && <Checkpoints checkpoints={detail.data.checkpoints} />}
            </>
          )}
        </div>
      </div>

      {detail.data && <div className="session-workbench">
        <div className="session-main">
          <div className="session-toolbar">
            <div><h3>Session transcript</h3><span>{selectedSessionId ? `${filteredItems.length} visible items` : 'No native session attached'}</span></div>
            {detail.data.nativeSessions.length > 0 && <select value={selectedSessionId ?? ''} onChange={(event) => setSelectedSession(event.target.value)} aria-label="Native session">
              {detail.data.nativeSessions.map((session) => <option key={session.id} value={session.id}>{session.provider} · {session.nativeSessionId}</option>)}
            </select>}
            <input value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} placeholder="Search transcript…" aria-label="Search session transcript" />
            <label className="withheld-toggle"><input type="checkbox" checked={showWithheld} onChange={(event) => setShowWithheld(event.target.checked)} /> Show withheld</label>
          </div>
          <div className="transcript">
            {!selectedSessionId ? <p className="muted">This run has no provider-native session.</p> : sessionItems.isLoading ? <p className="muted">Loading normalized session items…</p> : filteredItems.length ? filteredItems.map((item) => <SessionItemRow key={item.id} item={item} />) : <p className="muted">No session items match the current filters.</p>}
          </div>
        </div>
        <aside className="ingestion-panel">
          <div className="workbench-title"><h3>Ingestion history</h3><span>{ingestions.data?.length ?? 0}</span></div>
          {ingestions.data?.length ? ingestions.data.map((ingestion) => (
            <details key={ingestion.id} className="ingestion-row">
              <summary><span><strong>{ingestion.sourceRevision}</strong><small>{relativeTime(ingestion.ingestedAt)} · parser {ingestion.parserVersion}</small></span><StatusText value={ingestion.status} /></summary>
              <dl><div><dt>Items</dt><dd>{ingestion.itemCount}</dd></div><div><dt>Turns</dt><dd>{ingestion.turnCount}</dd></div><div><dt>Cursor</dt><dd>{ingestion.fromCursor ?? 'start'} → {ingestion.toCursor ?? 'end'}</dd></div><div><dt>Errors</dt><dd>{ingestion.errors.length}</dd></div></dl>
              <code>{compactJson(ingestion.manifest)}</code>
            </details>
          )) : <p className="muted">No ingestion revisions recorded.</p>}
        </aside>
      </div>}
    </section>
  );
}
