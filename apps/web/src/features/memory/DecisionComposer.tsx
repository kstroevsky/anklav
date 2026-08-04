import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, mutation, type Workspace } from '../../api';
import { ControlDrawer } from '../../components/organisms/ControlDrawer';
import type { EvidenceRow } from './types';

const splitLines = (value: string) => value.split('\n').map((entry) => entry.trim()).filter(Boolean);

export function DecisionComposer({ workspace, projectId, evidence, close, done }: { workspace: Workspace; projectId: string; evidence: EvidenceRow[]; close: () => void; done: () => void }) {
  const [form, setForm] = useState({ question: '', selectedOption: '', alternatives: '', rationale: '', consequences: '', evidenceId: evidence[0]?.artifact.id ?? '' }); const [error, setError] = useState('');
  const submit = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/memory/decisions`, mutation('POST', { projectId, question: form.question, selectedOption: form.selectedOption, rejectedAlternatives: splitLines(form.alternatives), rationale: form.rationale, consequences: splitLines(form.consequences), evidenceArtifactIds: [form.evidenceId] })), onSuccess: done, onError: (err: Error) => setError(err.message) });
  return <ControlDrawer eyebrow="Durable memory" title="Propose decision" close={close}><div className="drawer-form"><label>Question<input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="How should session state be stored?" /></label><label>Selected option<input value={form.selectedOption} onChange={(e) => setForm({ ...form, selectedOption: e.target.value })} /></label><label>Rejected alternatives (one per line)<textarea value={form.alternatives} onChange={(e) => setForm({ ...form, alternatives: e.target.value })} /></label><label>Rationale<textarea value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} /></label><label>Consequences (one per line)<textarea value={form.consequences} onChange={(e) => setForm({ ...form, consequences: e.target.value })} /></label><label>Evidence<select value={form.evidenceId} onChange={(e) => setForm({ ...form, evidenceId: e.target.value })}><option value="">Choose exact evidence…</option>{evidence.map(({ artifact }) => <option key={artifact.id} value={artifact.id}>{artifact.title}</option>)}</select></label>{error && <p className="error">{error}</p>}<button className="button primary" disabled={!form.question || !form.selectedOption || !form.evidenceId || submit.isPending} onClick={() => submit.mutate()}>Propose decision</button></div></ControlDrawer>;
}
