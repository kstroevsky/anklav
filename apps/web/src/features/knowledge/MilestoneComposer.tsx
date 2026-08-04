import { useMutation } from '@tanstack/react-query';
import { api, mutation, type Project, type Workspace } from '../../api';
import { ControlDrawer } from '../../components/organisms/ControlDrawer';

export function MilestoneComposer({ workspace, projects, close, done }: { workspace: Workspace; projects: Project[]; close: () => void; done: () => void }) {
  const create = useMutation({ mutationFn: (body: any) => api(`/workspaces/${workspace.id}/milestones`, mutation('POST', body)), onSuccess: done });
  return <ControlDrawer title="New milestone" close={close}><form className="drawer-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); create.mutate({ projectId: form.get('projectId'), name: form.get('name'), description: form.get('description'), status: form.get('status'), targetDate: form.get('targetDate') || null }); }}><label>Project<select name="projectId" required>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Name<input name="name" required /></label><label>Description<textarea name="description" /></label><label>Status<select name="status"><option>planned</option><option>in_progress</option></select></label><label>Target date<input name="targetDate" type="date" /></label><button className="button primary">Create milestone</button></form></ControlDrawer>;
}
