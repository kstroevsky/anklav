import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';

export function ConnectedClients() {
  const client = useQueryClient(); const grants = useQuery<any[]>({ queryKey: ['oauth-grants'], queryFn: () => api('/oauth/grants') });
  const revoke = useMutation({ mutationFn: (grantId: string) => api(`/oauth/grants/${grantId}`, mutation('DELETE')), onSuccess: () => client.invalidateQueries({ queryKey: ['oauth-grants'] }) });
  return <section className="settings-card"><h2>Connected clients</h2>{grants.data?.length ? grants.data.map((grant) => <div className="setting-row" key={grant.id}><span><strong>{grant.client.name}</strong><small>{grant.scopes.join(', ')} · {grant.workspaceIds.length} workspace{grant.workspaceIds.length === 1 ? '' : 's'}</small></span><button className="text-button danger" disabled={revoke.isPending} onClick={() => window.confirm(`Revoke ${grant.client.name}?`) && revoke.mutate(grant.id)}>Revoke</button></div>) : <p className="muted">No MCP clients are connected.</p>}</section>;
}
