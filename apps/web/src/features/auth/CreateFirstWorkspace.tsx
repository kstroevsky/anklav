import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import { Brand } from '../../components/atoms/Brand';
import { Field } from '../../components/atoms/Field';

export function CreateFirstWorkspace() {
  const client = useQueryClient(); const [name, setName] = useState('');
  const create = useMutation({ mutationFn: () => api('/workspaces', mutation('POST', { name })), onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces'] }) });
  return <main className="access"><section className="access-card"><Brand /><h1>Create a workspace</h1><p>Workspaces are your isolated portfolios. You will be its first owner.</p><form className="stack" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><Field label="Workspace name" value={name} onChange={setName} /><button className="button primary">Create workspace</button></form></section></main>;
}
