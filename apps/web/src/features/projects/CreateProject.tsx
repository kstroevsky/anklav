import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Workspace } from '../../api';
import { Field } from '../../components/atoms/Field';
import { InlineForm } from '../../components/molecules/InlineForm';

export function CreateProject({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient(); const [open, setOpen] = useState(false); const [name, setName] = useState('');
  const create = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/projects`, mutation('POST', { name })), onSuccess: () => { client.invalidateQueries({ queryKey: ['projects', workspace.id] }); setOpen(false); setName(''); } });
  return open ? <InlineForm onCancel={() => setOpen(false)} onSubmit={() => create.mutate()} pending={create.isPending}><Field label="Project name" value={name} onChange={setName} autoFocus /></InlineForm> : <button className="button primary" onClick={() => setOpen(true)}>New project</button>;
}
