import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Workspace } from '../../api';

export function Checklist({ workspace, task }: { workspace: Workspace; task: any }) {
  const client = useQueryClient(); const [text, setText] = useState(''); const [kind, setKind] = useState<'readiness' | 'acceptance'>('acceptance');
  const add = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/tasks/${task.id}/checklists`, mutation('POST', { text, kind })), onSuccess: () => { setText(''); client.invalidateQueries({ queryKey: ['task', workspace.id, task.id] }); } });
  const toggle = useMutation({ mutationFn: (item: any) => api(`/workspaces/${workspace.id}/checklists/${item.id}`, mutation('PATCH', { completed: !item.completed })), onSuccess: () => client.invalidateQueries({ queryKey: ['task', workspace.id, task.id] }) });
  return <section><h3>Criteria</h3>{['readiness', 'acceptance'].map((group) => <div className="criteria" key={group}><h4>{group === 'readiness' ? 'Readiness' : 'Acceptance'}</h4>{task.checklists?.filter((item: any) => item.kind === group).map((item: any) => <label className="check" key={item.id}><input type="checkbox" checked={item.completed} onChange={() => toggle.mutate(item)} />{item.text}</label>)}</div>)}<div className="inline-fields"><select value={kind} onChange={(event) => setKind(event.target.value as any)}><option value="acceptance">Acceptance</option><option value="readiness">Readiness</option></select><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Add criterion" /><button className="button" onClick={() => add.mutate()} disabled={!text.trim()}>Add</button></div></section>;
}
