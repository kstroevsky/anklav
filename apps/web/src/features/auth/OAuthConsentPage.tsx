import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api, mutation } from '../../api';
import type { Workspace } from '../../api';
import { Brand } from '../../components/atoms/Brand';
import { Error } from '../../components/atoms/Error';
import { Loading } from '../../components/atoms/Loading';

export function OAuthConsent() {
  const [params] = useSearchParams(); const requestId = params.get('request') ?? '';
  const request = useQuery<any>({ queryKey: ['oauth-request', requestId], queryFn: () => api(`/oauth/requests/${requestId}`), enabled: Boolean(requestId), retry: false });
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  useEffect(() => { if (request.data) setWorkspaceIds(request.data.workspaces.map((workspace: Workspace) => workspace.id)); }, [request.data]);
  const decide = useMutation({ mutationFn: (approve: boolean) => api<{ redirectUri: string }>(`/oauth/requests/${requestId}/decision`, mutation('POST', { approve, workspaceIds: approve ? workspaceIds : [] })), onSuccess: ({ redirectUri }) => window.location.assign(redirectUri) });
  if (!requestId) return <Navigate to="/" replace />;
  if (request.isLoading) return <Loading />;
  if (!request.data) return <main className="access"><section className="access-card"><Brand /><h1>Authorization request unavailable</h1><p>This OAuth request is invalid or has expired. Return to your MCP client and start again.</p></section></main>;
  const toggle = (id: string) => setWorkspaceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  return <main className="access"><section className="access-card"><Brand /><h1>Connect {request.data.client.name}</h1><p>It requests access to Anklav via the MCP endpoint.</p><div className="stack"><p><strong>Scopes:</strong> {request.data.scopes.join(', ')}</p><p><strong>Redirect:</strong> {request.data.redirectUri}</p><label className="field"><span>Workspaces</span>{request.data.workspaces.map((workspace: Workspace) => <span key={workspace.id}><input type="checkbox" checked={workspaceIds.includes(workspace.id)} onChange={() => toggle(workspace.id)} /> {workspace.name}</span>)}</label><Error text={decide.error instanceof Error ? decide.error.message : ''} /><button className="button primary" disabled={!workspaceIds.length || decide.isPending} onClick={() => decide.mutate(true)}>Authorize</button><button className="button ghost" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Cancel</button></div></section></main>;
}
