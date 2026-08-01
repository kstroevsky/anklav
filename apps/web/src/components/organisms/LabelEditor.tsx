import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Workspace } from '../../api';

export function LabelEditor({ workspace, subject, subjectId, assigned }: { workspace: Workspace; subject: 'project' | 'flow' | 'task'; subjectId: string; assigned: any[] }) {
  const client = useQueryClient(); const labels = useQuery<any[]>({ queryKey: ['labels', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/labels`) }); const [labelId, setLabelId] = useState('');
  const changed = () => { client.invalidateQueries({ queryKey: [subject, workspace.id, subjectId] }); client.invalidateQueries({ queryKey: ['tasks', workspace.id] }); client.invalidateQueries({ queryKey: ['projects', workspace.id] }); client.invalidateQueries({ queryKey: ['flows', workspace.id] }); };
  const add = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/${subject}/${subjectId}/labels/${labelId}`, mutation('POST')), onSuccess: () => { setLabelId(''); changed(); } });
  const remove = useMutation({ mutationFn: (id: string) => api(`/workspaces/${workspace.id}/${subject}/${subjectId}/labels/${id}`, mutation('DELETE')), onSuccess: changed });
  const selected = new Set(assigned.map((label) => label.id));
  return <section><h3>Labels</h3>{assigned.map((label) => <span className="chip removable" key={label.id}><span className="label-dot" style={{ background: label.color }} />{label.name}<button aria-label={`Remove ${label.name}`} onClick={() => remove.mutate(label.id)}>×</button></span>)}{!assigned.length && <p className="muted">No labels applied.</p>}<div className="inline-fields"><select value={labelId} onChange={(event) => setLabelId(event.target.value)}><option value="">Add label…</option>{labels.data?.filter((label) => !selected.has(label.id)).map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}</select><button className="button" onClick={() => add.mutate()} disabled={!labelId || add.isPending}>Add</button></div></section>;
}
