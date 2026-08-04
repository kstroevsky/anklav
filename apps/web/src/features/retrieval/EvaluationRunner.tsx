import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, mutation, type Workspace } from '../../api';

export function EvaluationRunner({ workspace, projectId, profileKey }: { workspace: Workspace; projectId: string; profileKey?: string }) {
  const [definition, setDefinition] = useState(JSON.stringify({ suiteId: 'project-retrieval', suiteVersion: '1', requiredCategories: ['provenance'], thresholds: { minRecallAtK: .8, minMeanReciprocalRank: .7, minCurrentPrecision: .95, minProvenanceCoverage: 1, minCasePassRate: .8, maxForbiddenIntrusionRate: 0, maxCrossProjectLeakageRate: 0 }, cases: [] }, null, 2)); const [result, setResult] = useState<any>(null); const [error, setError] = useState('');
  const run = useMutation({ mutationFn: () => { const parsed = JSON.parse(definition); return api(`/workspaces/${workspace.id}/retrieval/evaluations`, mutation('POST', { ...parsed, projectId, embeddingProfileKey: profileKey })); }, onSuccess: setResult, onError: (err: Error) => setError(err.message) });
  return <div className="evaluation-runner"><div><h3>Evaluation suite definition</h3><p className="muted">Define expected and forbidden source references for reproducible retrieval quality gates.</p><textarea value={definition} onChange={(event) => setDefinition(event.target.value)} /><button className="button primary" disabled={!projectId || run.isPending} onClick={() => { setError(''); run.mutate(); }}>Run evaluation</button>{error && <p className="error">{error}</p>}</div><pre>{result ? JSON.stringify(result, null, 2) : 'Evaluation results will appear here.'}</pre></div>;
}
