import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { Loading } from '../../components/atoms/Loading';
import { Hint } from '../../components/molecules/Hint';
import { Page } from '../../components/templates/Page';
import type { Workspace } from '../../api';

export function SearchPage({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate(); const [q, setQ] = useState('');
  const results = useQuery<any>({ queryKey: ['search', workspace.id, q], queryFn: () => api(`/workspaces/${workspace.id}/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 1 });
  const groups = results.data ? [['tasks', 'Tasks'], ['projects', 'Projects'], ['flows', 'Flows']] as const : [];
  return <Page heading="Search" subheading="Find work across projects, flows, and tasks."><section className="search-surface"><input className="search large" autoFocus placeholder="Search titles and Markdown content" value={q} onChange={(event) => setQ(event.target.value)} />{q.trim().length < 2 ? <Hint title="Search your control room" text="Enter at least two characters to search all core work records." /> : results.isLoading ? <Loading /> : <div className="search-results">{groups.map(([key, title]) => <section key={key}><h2>{title}</h2>{results.data[key]?.length ? results.data[key].map((entry: any) => <button className="search-result" key={entry.id} onClick={() => navigate(`/w/${workspace.id}/${key}/${entry.id}`)}><span className="chip">{entry.kind}</span><strong>{entry.name}</strong></button>) : <p className="muted">No matches.</p>}</section>)}</div>}</section></Page>;
}
