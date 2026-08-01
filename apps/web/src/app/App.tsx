import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, setCsrfToken } from '../api';
import { Loading } from '../components/atoms/Loading';
import { Access } from '../features/auth/AccessPage';
import { AuthedApp } from './AuthedApp';
import type { Session } from './types';

export function App() {
  const session = useQuery<Session>({ queryKey: ['session'], queryFn: () => api('/auth/me'), retry: false });
  useEffect(() => { if (session.data?.csrfToken) setCsrfToken(session.data.csrfToken); }, [session.data]);
  if (session.isLoading) return <Loading />;
  if (!session.data) return <Access />;
  return <AuthedApp session={session.data} />;
}

export default App;
