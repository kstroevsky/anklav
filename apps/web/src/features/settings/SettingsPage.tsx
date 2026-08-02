import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { WorkflowState, Workspace } from '../../api';
import { Field } from '../../components/atoms/Field';
import { Status } from '../../components/atoms/Status';
import { Page } from '../../components/templates/Page';
import { ConnectedClients } from './ConnectedClients';
import { TrashSection } from './TrashSection';
import { RepositorySettings } from './RepositorySettings';
import type { Session } from '../../app/types';

export function SettingsPage({ workspace, session }: { workspace: Workspace; session: Session }) {
  const states = useQuery<WorkflowState[]>({
    queryKey: ['states', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/workflows`),
  });
  const labels = useQuery<any[]>({
    queryKey: ['labels', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/labels`),
  });
  const members = useQuery<any[]>({
    queryKey: ['members', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/members`),
  });
  const availableUsers = useQuery<any[]>({
    queryKey: ['available-users', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/available-users`),
    enabled: workspace.role === 'owner' || workspace.role === 'admin',
  });
  const trash = useQuery<any>({
    queryKey: ['trash', workspace.id],
    queryFn: () => api(`/workspaces/${workspace.id}/trash`),
  });
  const client = useQueryClient();
  const [labelName, setLabelName] = useState('');
  const [newState, setNewState] = useState({
    entityType: 'task',
    name: '',
    semantic: 'planned',
    color: '#64748b',
  });
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';
  const refreshSettings = () => {
    client.invalidateQueries({ queryKey: ['states', workspace.id] });
    client.invalidateQueries({ queryKey: ['labels', workspace.id] });
    client.invalidateQueries({ queryKey: ['members', workspace.id] });
    client.invalidateQueries({ queryKey: ['trash', workspace.id] });
  };
  const addLabel = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}/labels`, mutation('POST', { name: labelName })),
    onSuccess: () => {
      setLabelName('');
      refreshSettings();
    },
  });
  const updateLabel = useMutation({
    mutationFn: ({ label, body }: any) => api(`/workspaces/${workspace.id}/labels/${label.id}`, mutation('PATCH', body, label.version)),
    onSuccess: refreshSettings,
  });
  const deleteLabel = useMutation({
    mutationFn: (label: any) => api(`/workspaces/${workspace.id}/label/${label.id}`, mutation('DELETE', undefined, label.version)),
    onSuccess: refreshSettings,
  });
  const updateState = useMutation({
    mutationFn: ({ state, body }: any) => api(`/workspaces/${workspace.id}/workflows/${state.id}`, mutation('PATCH', body, state.version)),
    onSuccess: refreshSettings,
  });
  const archiveState = useMutation({
    mutationFn: (state: WorkflowState) => api(`/workspaces/${workspace.id}/workflows/${state.id}/archive`, mutation('POST', { replacementStateId: replacements[state.id] }, state.version)),
    onSuccess: refreshSettings,
  });
  const createState = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}/workflows/${newState.entityType}`, mutation('POST', newState)),
    onSuccess: () => {
      setNewState({
        entityType: 'task',
        name: '',
        semantic: 'planned',
        color: '#64748b',
      });
      refreshSettings();
    },
  });
  const addMember = useMutation({
    mutationFn: (body: any) => api(`/workspaces/${workspace.id}/members`, mutation('POST', body)),
    onSuccess: refreshSettings,
  });
  const updateMember = useMutation({
    mutationFn: ({ member, body }: any) => api(`/workspaces/${workspace.id}/members/${member.id}`, mutation('PATCH', body)),
    onSuccess: refreshSettings,
  });
  const createAccount = useMutation({
    mutationFn: (body: any) => api('/accounts', mutation('POST', body)),
    onSuccess: () => client.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const restore = useMutation({
    mutationFn: ({ kind, item }: any) => api(`/workspaces/${workspace.id}/${kind}/${item.id}/restore`, mutation('POST', undefined, item.version)),
    onSuccess: refreshSettings,
  });
  const semantics = newState.entityType === 'task' ? ['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled'] : ['proposed', 'active', 'paused', 'converged', 'closed'];
  return (
    <Page heading="Settings" subheading="Workspace membership, workflows, labels, and recovery.">
      <div className="settings-grid">
        <section className="settings-card wide">
          <h2>Workflow states</h2>
          {states.data?.map((state) => (
            <div className="state-row" key={state.id}>
              <Status state={state} />
              <input
                aria-label={`${state.name} name`}
                defaultValue={state.name}
                disabled={!canAdmin}
                onBlur={(event) =>
                  event.target.value !== state.name &&
                  updateState.mutate({
                    state,
                    body: { name: event.target.value },
                  })
                }
              />
              <input
                aria-label={`${state.name} color`}
                className="color-input"
                type="color"
                defaultValue={state.color}
                disabled={!canAdmin}
                onBlur={(event) =>
                  event.target.value !== state.color &&
                  updateState.mutate({
                    state,
                    body: { color: event.target.value },
                  })
                }
              />
              <span className="chip">
                {state.entityType} · {state.taskSemantic ?? state.flowSemantic}
              </span>
              <button
                className="text-button"
                disabled={!canAdmin || state.position === 0}
                onClick={() =>
                  updateState.mutate({
                    state,
                    body: { position: state.position - 1 },
                  })
                }
              >
                ↑
              </button>
              <button
                className="text-button"
                disabled={!canAdmin}
                onClick={() =>
                  updateState.mutate({
                    state,
                    body: { position: state.position + 1 },
                  })
                }
              >
                ↓
              </button>
              <select
                aria-label={`Replacement for ${state.name}`}
                value={replacements[state.id] ?? ''}
                disabled={!canAdmin}
                onChange={(event) =>
                  setReplacements((current) => ({
                    ...current,
                    [state.id]: event.target.value,
                  }))
                }
              >
                <option value="">Replace with…</option>
                {states.data
                  ?.filter((candidate) => candidate.entityType === state.entityType && candidate.id !== state.id && !candidate.archivedAt)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
              <button className="text-button danger" disabled={!canAdmin || !replacements[state.id]} onClick={() => archiveState.mutate(state)}>
                Archive
              </button>
            </div>
          ))}
          {canAdmin && (
            <form
              className="add-row"
              onSubmit={(event) => {
                event.preventDefault();
                createState.mutate();
              }}
            >
              <select
                value={newState.entityType}
                onChange={(event) =>
                  setNewState({
                    entityType: event.target.value,
                    name: '',
                    semantic: event.target.value === 'task' ? 'planned' : 'active',
                    color: '#64748b',
                  })
                }
              >
                <option value="task">Task state</option>
                <option value="flow">Flow state</option>
              </select>
              <input
                placeholder="State name"
                value={newState.name}
                onChange={(event) =>
                  setNewState((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
              />
              <select
                value={newState.semantic}
                onChange={(event) =>
                  setNewState((current) => ({
                    ...current,
                    semantic: event.target.value,
                  }))
                }
              >
                {semantics.map((semantic) => (
                  <option key={semantic} value={semantic}>
                    {semantic.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              <input
                className="color-input"
                type="color"
                value={newState.color}
                onChange={(event) =>
                  setNewState((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
              />
              <button className="button" disabled={createState.isPending}>
                Add state
              </button>
            </form>
          )}
          <p className="muted">Semantic categories stay stable even as workspace vocabulary changes. Archiving atomically reassigns existing work.</p>
        </section>
        <section className="settings-card">
          <h2>Labels</h2>
          {labels.data?.map((label) => (
            <div className="setting-row" key={label.id}>
              <input
                className="color-input"
                type="color"
                defaultValue={label.color}
                disabled={!canAdmin}
                onBlur={(event) =>
                  event.target.value !== label.color &&
                  updateLabel.mutate({
                    label,
                    body: { color: event.target.value },
                  })
                }
              />
              <input
                aria-label={`${label.name} label`}
                defaultValue={label.name}
                disabled={!canAdmin}
                onBlur={(event) =>
                  event.target.value !== label.name &&
                  updateLabel.mutate({
                    label,
                    body: { name: event.target.value },
                  })
                }
              />
              {canAdmin && (
                <button className="text-button danger" onClick={() => window.confirm(`Delete ${label.name}?`) && deleteLabel.mutate(label)}>
                  Delete
                </button>
              )}
            </div>
          ))}
          {canAdmin && (
            <div className="inline-fields">
              <input value={labelName} onChange={(event) => setLabelName(event.target.value)} placeholder="New label" />
              <button className="button" onClick={() => addLabel.mutate()} disabled={!labelName.trim()}>
                Add
              </button>
            </div>
          )}
        </section>
        <section className="settings-card">
          <h2>Members</h2>
          {members.data?.map((member) => (
            <div className="setting-row" key={member.id}>
              <span>
                <strong>{member.displayName}</strong>
                <small>{member.email}</small>
              </span>
              {canAdmin ? (
                <select
                  value={member.role}
                  onChange={(event) =>
                    updateMember.mutate({
                      member,
                      body: { role: event.target.value },
                    })
                  }
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              ) : (
                <span className="chip">{member.role}</span>
              )}
              {canAdmin && (
                <button className="text-button danger" disabled={!member.active} onClick={() => window.confirm(`Remove ${member.displayName} from this workspace?`) && updateMember.mutate({ member, body: { active: false } })}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {canAdmin && (
            <form
              className="add-row"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                addMember.mutate({
                  userId: form.get('userId'),
                  role: form.get('role'),
                });
                event.currentTarget.reset();
              }}
            >
              <select name="userId" required defaultValue="">
                <option value="" disabled>
                  Add an account…
                </option>
                {availableUsers.data
                  ?.filter((account) => !members.data?.some((member) => member.userId === account.id && member.active))
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} · {account.email}
                    </option>
                  ))}
              </select>
              <select name="role" defaultValue="member">
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </select>
              <button className="button">Add member</button>
            </form>
          )}
        </section>
        <RepositorySettings workspace={workspace} />
        <TrashSection workspace={workspace} trash={trash.data} restore={restore} />
        <ConnectedClients />
        {session.user.instanceRole === 'instance_admin' && (
          <section className="settings-card">
            <h2>Instance accounts</h2>
            <form
              className="property-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                createAccount.mutate({
                  email: form.get('email'),
                  displayName: form.get('displayName'),
                  password: form.get('password'),
                });
                event.currentTarget.reset();
              }}
            >
              <Field label="Name" name="displayName" required />
              <Field label="Email" name="email" type="email" required />
              <Field label="Temporary password" name="password" type="password" minLength={12} required />
              <button className="button primary">Create account</button>
            </form>
          </section>
        )}
      </div>
    </Page>
  );
}
