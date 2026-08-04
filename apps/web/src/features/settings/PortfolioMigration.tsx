import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, mutation, type Workspace } from '../../api';

export function PortfolioMigration({ workspace }: { workspace: Workspace }) {
  const [result, setResult] = useState<any>(null); const [error, setError] = useState('');
  const run = useMutation({ mutationFn: ({ action, guardedOverride }: { action: string; guardedOverride?: boolean }) => action === 'plan' ? api(`/workspaces/${workspace.id}/imports/anklav/plan?verifyChecksums=true`) : api(`/workspaces/${workspace.id}/imports/anklav/${action}`, mutation('POST', { guardedOverride })), onSuccess: setResult, onError: (err: Error) => setError(err.message) });
  const execute = (action: string) => { setError(''); if (action === 'rollback' && !window.confirm('Rollback the applied portfolio migration? This requires the server guard and affects imported records.')) return; run.mutate({ action, guardedOverride: action === 'rollback' }); };
  return <section className="settings-card wide migration-card"><div className="section-header"><div><h2>Portfolio migration</h2><p className="muted">Plan, apply, resume, verify, or roll back the server-configured Anklav migration bundle.</p></div><span className="chip">Admin only</span></div><div className="button-row"><button className="button" onClick={() => execute('plan')}>Load plan</button><button className="button primary" onClick={() => execute('apply')}>Apply</button><button className="button" onClick={() => execute('resume')}>Resume</button><button className="button" onClick={() => execute('verify')}>Verify</button><button className="button danger" onClick={() => execute('rollback')}>Rollback</button></div>{run.isPending && <p className="muted">Migration operation running…</p>}{error && <p className="error">{error}</p>}{result && <details open className="migration-result"><summary>Latest operation result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>}</section>;
}
