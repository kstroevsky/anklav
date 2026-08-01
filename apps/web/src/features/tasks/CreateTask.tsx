import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Project, WorkflowState, Workspace } from '../../api';
import { Error } from '../../components/atoms/Error';
import { Field } from '../../components/atoms/Field';
import { InlineForm } from '../../components/molecules/InlineForm';

export function CreateTask({ workspace, projects, states }: { workspace: Workspace; projects: Project[]; states: WorkflowState[] }) {
  const client = useQueryClient(); const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id); }, [projectId, projects]);
  const action = useMutation({ mutationFn: () => api(`/workspaces/${workspace.id}/tasks`, mutation('POST', { title, projectId, workflowStateId: states.find((state) => state.isInitial)?.id })), onSuccess: () => { client.invalidateQueries({ queryKey: ['tasks', workspace.id] }); setOpen(false); setTitle(''); } });
  if (!open) return <button className="button primary" disabled={!projects.length} onClick={() => setOpen(true)}>New task</button>;
  return <InlineForm onCancel={() => setOpen(false)} onSubmit={() => action.mutate()} pending={action.isPending}><Field label="Title" value={title} onChange={setTitle} autoFocus /><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><Error text={action.error instanceof Error ? action.error.message : ''} /></InlineForm>;
}
