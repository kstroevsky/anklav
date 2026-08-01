import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';

export function ChangePoller({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient(); const [after, setAfter] = useState(() => Number(sessionStorage.getItem(`anklav-sequence-${workspaceId}`) ?? 0));
  const changes = useQuery<any[]>({ queryKey: ['changes', workspaceId, after], queryFn: () => api(`/workspaces/${workspaceId}/changes?after=${after}`), refetchInterval: 15_000, retry: false });
  useEffect(() => { if (!changes.data?.length) return; const next = Math.max(...changes.data.map((entry) => Number(entry.sequence))); sessionStorage.setItem(`anklav-sequence-${workspaceId}`, String(next)); setAfter(next); client.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes(workspaceId) && query.queryKey[0] !== 'changes' }); }, [changes.data, client, workspaceId]);
  return null;
}
