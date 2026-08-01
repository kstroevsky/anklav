import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, mutation, setCsrfToken } from '../../api';
import { Error } from '../../components/atoms/Error';
import { Field } from '../../components/atoms/Field';
import type { Session } from '../../app/types';

export function Login() {
  const client = useQueryClient(); const [error, setError] = useState('');
  const action = useMutation({ mutationFn: (body: any) => api<Session>('/auth/login', mutation('POST', body)), onSuccess: (data) => { setCsrfToken(data.csrfToken); client.setQueryData(['session'], data); }, onError: (err: ApiError) => setError(err.message) });
  return <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action.mutate({ email: form.get('email'), password: form.get('password') }); }} className="stack"><Field label="Email" name="email" type="email" required autoComplete="email" /><Field label="Password" name="password" type="password" required autoComplete="current-password" /><Error text={error} /><button className="button primary" disabled={action.isPending}>{action.isPending ? 'Signing in…' : 'Sign in'}</button></form>;
}
