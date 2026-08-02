import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation, type Repository, type Workspace } from '../../api';

export function RepositorySettings({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient();
  const repositories = useQuery<Repository[]>({
    queryKey: ['repositories', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/repositories`),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['repositories', workspace.id] });
  const create = useMutation({
    mutationFn: (body: any) => api(`/workspaces/${workspace.id}/repositories`, mutation('POST', body)),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ repository, body }: { repository: Repository; body: any }) => api(`/workspaces/${workspace.id}/repositories/${repository.id}`, mutation('PATCH', body, repository.version)),
    onSuccess: refresh,
  });
  return (
    <section className="settings-card wide">
      <h2>Repository registry</h2>
      {repositories.data?.map((repository) => (
        <div className="setting-row" key={repository.id}>
          <span>
            <strong>{repository.fullName}</strong>
            <small>
              {repository.provider} · {repository.visibility} · {repository.defaultBranch}
            </small>
          </span>
          <input
            aria-label={`${repository.fullName} remote URL`}
            defaultValue={repository.remoteUrl}
            placeholder="Remote URL"
            onBlur={(event) =>
              event.target.value !== repository.remoteUrl &&
              update.mutate({
                repository,
                body: { remoteUrl: event.target.value },
              })
            }
          />
        </div>
      ))}
      <form
        className="add-row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const fullName = String(form.get('fullName'));
          const parts = fullName.split('/');
          create.mutate({
            provider: form.get('provider'),
            owner: parts.slice(0, -1).join('/'),
            name: parts.at(-1),
            fullName,
            remoteUrl: form.get('remoteUrl'),
            defaultBranch: form.get('defaultBranch'),
            visibility: form.get('visibility'),
          });
          event.currentTarget.reset();
        }}
      >
        <select name="provider" defaultValue="git">
          <option value="git">Git</option>
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="bitbucket">Bitbucket</option>
        </select>
        <input name="fullName" placeholder="owner/repository" required />
        <input name="remoteUrl" placeholder="Remote URL" />
        <input name="defaultBranch" placeholder="Default branch" defaultValue="main" required />
        <select name="visibility" defaultValue="private">
          <option value="private">private</option>
          <option value="internal">internal</option>
          <option value="public">public</option>
        </select>
        <button className="button" disabled={create.isPending}>
          Register
        </button>
      </form>
      <p className="muted">Local checkout paths are machine aliases set through the API or MCP; they never become repository identity.</p>
    </section>
  );
}
