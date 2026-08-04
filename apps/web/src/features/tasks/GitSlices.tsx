import { relativeTime } from '../../utils/formatting';
import { StatusText } from './StatusText';
import { shortId } from './taskRunsUtils';
import type { GitSlice } from './taskRunsTypes';

export function GitSlices({ slices }: { slices: GitSlice[] }) {
  if (!slices.length) return <p className="muted ops-empty">No Git state was captured for this run.</p>;
  return <div className="git-slices">{slices.map((slice) => <details key={slice.id} open={slice === slices.at(-1)}><summary><span><strong>{slice.phase} · {slice.branchName ?? 'detached HEAD'}</strong><small>{slice.repositoryFullName} · {shortId(slice.headCommitSha)} · {relativeTime(slice.capturedAt)}</small></span><StatusText value={slice.dirtyState} /></summary><div className="git-detail"><span>Base <code>{slice.baseCommitSha}</code></span><span>Head <code>{slice.headCommitSha}</code></span><span>Diff hash <code>{slice.diffHash ?? '—'}</code></span><span>Patch evidence <code>{slice.patchEvidenceArtifactId ?? slice.patchArtifactId ?? '—'}</code></span></div><div className="path-list"><strong>Changed / included paths</strong>{slice.includedPaths.length ? slice.includedPaths.map((path) => <code key={path}>{path}</code>) : <span className="muted">No paths reported in this slice.</span>}</div></details>)}</div>;
}
