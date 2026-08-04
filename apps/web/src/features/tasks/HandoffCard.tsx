import { useState } from 'react';
import type { TaskOperations } from './taskRunsTypes';
import { shortId } from './taskRunsUtils';

export function HandoffCard({ operations }: { operations: TaskOperations }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(operations.command); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  return <section className={`handoff-card ${operations.ready ? 'ready' : 'attention'}`}>
    <header><div><h3>{operations.ready ? 'Ready to continue' : 'Handoff needs attention'}</h3><p>{operations.ready ? 'The latest checkpoint and exact Git state can be continued on another machine.' : operations.blockers.join(' ')}</p></div><strong>{operations.ready ? 'READY' : `${operations.blockers.length} BLOCKER${operations.blockers.length === 1 ? '' : 'S'}`}</strong></header>
    <div className="handoff-facts"><div><small>Commit</small><code>{shortId(operations.gitSlice?.headCommitSha)}</code></div><div><small>Branch</small><strong>{operations.gitSlice?.branchName ?? '—'}</strong></div><div><small>Machine</small><strong>{operations.run?.machineIdentity ?? '—'}</strong></div><div><small>Checkpoint</small><strong>{operations.checkpoint ? `#${operations.checkpoint.sequence}` : '—'}</strong></div></div>
    <div className="command-copy"><code>{operations.command}</code><button className="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy command'}</button></div>
  </section>;
}
