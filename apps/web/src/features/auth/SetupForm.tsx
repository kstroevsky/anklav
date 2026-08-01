import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, mutation, setCsrfToken } from '../../api';
import { Error } from '../../components/atoms/Error';
import { Field } from '../../components/atoms/Field';
import type { Session } from '../../app/types';

export function Setup() {
  const client = useQueryClient(); const [error, setError] = useState('');
  const action = useMutation({ mutationFn: (body: any) => api<Session>('/auth/setup', mutation('POST', body)), onSuccess: (data) => { setCsrfToken(data.csrfToken); client.setQueryData(['session'], data); }, onError: (err: ApiError) => setError(err.message) });
  return <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); action.mutate(Object.fromEntries(form)); }} className="stack"><Field label="Your name" name="displayName" required /><Field label="Email" name="email" type="email" required /><Field label="Password" name="password" type="password" required minLength={12} /><Field label="First workspace" name="workspaceName" required /><Field label="Setup token" name="setupToken" type="password" required /><Error text={error} /><button className="button primary" disabled={action.isPending}>{action.isPending ? 'Creating…' : 'Create Anklav'}</button></form>;
}
