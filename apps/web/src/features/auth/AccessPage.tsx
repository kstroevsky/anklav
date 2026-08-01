import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Brand } from '../../components/atoms/Brand';
import { Loading } from '../../components/atoms/Loading';
import { Login } from './LoginForm';
import { Setup } from './SetupForm';

export function Access() {
  const setup = useQuery<{ initialized: boolean }>({ queryKey: ['setup-status'], queryFn: () => api('/auth/setup-status') });
  if (setup.isLoading) return <Loading />;
  return <main className="access"><section className="access-card"><Brand /><h1>{setup.data?.initialized ? 'Welcome back' : 'Set up your control room'}</h1><p>{setup.data?.initialized ? 'Sign in to continue where the work is.' : 'Create the first administrator and workspace.'}</p>{setup.data?.initialized ? <Login /> : <Setup />}</section></main>;
}
