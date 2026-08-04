import { relativeTime } from '../../utils/formatting';
import type { Checkpoint } from './taskRunsTypes';

export function Checkpoints({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (!checkpoints.length) return <p className="muted ops-empty">No checkpoints were recorded.</p>;
  return <div className="checkpoints">{[...checkpoints].reverse().map((checkpoint) => <details key={checkpoint.id} open={checkpoint === checkpoints.at(-1)}><summary><span><strong>Checkpoint #{checkpoint.sequence}</strong><small>{relativeTime(checkpoint.createdAt)} · {checkpoint.summary}</small></span><span>{checkpoint.failures.length ? `${checkpoint.failures.length} failures` : 'No failures'}</span></summary><p>{checkpoint.objective}</p><dl><div><dt>Next action</dt><dd>{checkpoint.nextAction}</dd></div><div><dt>Completed</dt><dd>{checkpoint.completedWork.join(' · ') || '—'}</dd></div><div><dt>Remaining</dt><dd>{checkpoint.remainingWork.join(' · ') || '—'}</dd></div><div><dt>Relevant paths</dt><dd>{checkpoint.relevantPaths.join(', ') || '—'}</dd></div><div><dt>Evidence</dt><dd>{checkpoint.evidenceArtifactIds.join(', ') || '—'}</dd></div></dl></details>)}</div>;
}
