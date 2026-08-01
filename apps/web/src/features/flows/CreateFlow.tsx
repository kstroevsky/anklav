import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { WorkflowState, Workspace } from '../../api';
import { Field } from '../../components/atoms/Field';
import { InlineForm } from '../../components/molecules/InlineForm';

export function CreateFlow({ workspace, states }: { workspace: Workspace; states: WorkflowState[] }) {
  const client = useQueryClient(); const [open, setOpen] = useState(false); const [name, setName] = useState('');
  const create = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/flows`, mutation('POST', { name, workflowStateId: states.find((state) => state.isInitial)?.id })), onSuccess: () => { client.invalidateQueries({ queryKey: ['flows', workspace.id] }); setOpen(false); setName(''); } });
  return open ? <InlineForm onCancel={() => setOpen(false)} onSubmit={() => create.mutate()} pending={create.isPending}><Field label="Flow name" value={name} onChange={setName} autoFocus /></InlineForm> : <button className="button primary" onClick={() => setOpen(true)}>New flow</button>;
}
