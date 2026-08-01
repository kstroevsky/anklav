import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation, Page as ApiPage } from '../../api';
import type { Workspace } from '../../api';
import { Error } from '../atoms/Error';
import { shortId } from '../../utils/formatting';

export function RelationEditor({ workspace, kind, subjectId, relations }: { workspace: Workspace; kind: 'task' | 'flow'; subjectId: string; relations: any[] }) {
  const client = useQueryClient(); const [targetId, setTargetId] = useState(''); const [type, setType] = useState(kind === 'task' ? 'blocks' : 'blocks'); const [explanation, setExplanation] = useState('');
  const targets = useQuery<ApiPage<any>>({ queryKey: [`${kind}-relation-options`, workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/${kind === 'task' ? 'tasks' : 'flows'}?limit=100`) });
  const refresh = () => client.invalidateQueries({ queryKey: [kind, workspace.id, subjectId] });
  const add = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/${kind}/relations`, mutation('POST', { sourceId: subjectId, targetId, type, explanation })), onSuccess: () => { setTargetId(''); setExplanation(''); refresh(); } });
  const remove = useMutation({ mutationFn: (relationId: string) => api(`/workspaces/${workspace.id}/${kind}/relations/${relationId}`, mutation('DELETE')), onSuccess: refresh });
  const choices = targets.data?.items.map((entry) => kind === 'task' ? { id: entry.task.id, name: entry.task.title } : { id: entry.flow.id, name: entry.flow.name }) ?? [];
  const typeOptions = kind === 'task' ? ['blocks', 'related', 'duplicate_of'] : ['blocks', 'related', 'replaces', 'merged_into'];
  const display = (relation: any) => { const source = kind === 'task' ? relation.sourceTaskId : relation.sourceFlowId; const target = kind === 'task' ? relation.targetTaskId : relation.targetFlowId; if (source === subjectId) return `${relation.type.replaceAll('_', ' ')} ${shortId(target)}`; if (relation.type === 'blocks') return `blocked by ${shortId(source)}`; return `${relation.type.replaceAll('_', ' ')} ${shortId(source)}`; };
  return <section><h3>Relations and dependencies</h3>{relations.length ? relations.map((relation) => <div className="relation-row" key={relation.id}><span>{display(relation)}{relation.explanation ? ` — ${relation.explanation}` : ''}</span><button className="text-button" aria-label="Remove relation" onClick={() => remove.mutate(relation.id)}>Remove</button></div>) : <p className="muted">No relations recorded.</p>}<div className="relation-form"><select value={type} onChange={(event) => setType(event.target.value)}>{typeOptions.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}</select><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Select {kind}…</option>{choices.filter((choice) => choice.id !== subjectId).map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select><input value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Optional explanation" /><button className="button" disabled={!targetId || add.isPending} onClick={() => add.mutate()}>Link</button></div><Error text={add.error instanceof Error ? add.error.message : ''} /></section>;
}
