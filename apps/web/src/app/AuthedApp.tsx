import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, mutation } from '../api';
import type { User, Workspace } from '../api';
import { Loading } from '../components/atoms/Loading';
import { CreateFirstWorkspace } from '../features/auth/CreateFirstWorkspace';
import { OAuthConsent } from '../features/auth/OAuthConsentPage';
import { WorkspaceShell } from '../components/organisms/WorkspaceShell';
import type { Session } from './types';

export function AuthedApp({ session }: { session: Session }) {
  const workspaces = useQuery<Workspace[]>({ queryKey: ['workspaces'], queryFn: () => api('/workspaces'), refetchInterval: 15_000 });
  const savedTheme = localStorage.getItem('anklav-theme');
  const initialTheme = session.user.theme ?? (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system' ? savedTheme : 'system');
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(initialTheme);
  const saveTheme = useMutation({ mutationFn: (next: string) => api<{ user: User }>('/auth/preferences', mutation('PATCH', { theme: next })), onSuccess: (next) => { setTheme(next.user.theme); localStorage.setItem('anklav-theme', next.user.theme); } });
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('anklav-theme', theme); }, [theme]);
  if (workspaces.isLoading) return <Loading />;
  if (!workspaces.data?.length) return <CreateFirstWorkspace />;
  return <Routes>
    <Route path="/oauth/consent" element={<OAuthConsent />} />
    <Route path="/" element={<Navigate to={`/w/${workspaces.data[0]!.id}/tasks`} replace />} />
    <Route path="/w/:workspaceId/*" element={<WorkspaceShell session={session} workspaces={workspaces.data} theme={theme} setTheme={(next) => { setTheme(next); saveTheme.mutate(next); }} />} />
    <Route path="*" element={<Navigate to={`/w/${workspaces.data[0]!.id}/tasks`} replace />} />
  </Routes>;
}
