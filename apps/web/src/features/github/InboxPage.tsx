import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../../api';
import type { Workspace } from '../../api';
import { Empty } from '../../components/molecules/Empty';
import { Loading } from '../../components/atoms/Loading';
import { Page } from '../../components/templates/Page';
import { relativeTime } from '../../utils/formatting';

export function InboxPage({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient(); const notifications = useQuery<any[]>({ queryKey: ['github-notifications', workspace.id], queryFn: () => api(`/workspaces/${workspace.id}/github/notifications`), refetchInterval: 15_000 });
  const read = useMutation({ mutationFn: (id: string) => api(`/workspaces/${workspace.id}/github/notifications/${id}/read`, mutation('PATCH')), onSuccess: () => { client.invalidateQueries({ queryKey: ['github-notifications', workspace.id] }); client.invalidateQueries({ queryKey: ['github-notification-count', workspace.id] }); } });
  return <Page heading="Inbox" subheading="Review requests, comments, checks, and merge activity."><section className="settings-card">{notifications.isLoading ? <Loading /> : notifications.data?.length ? notifications.data.map((notification) => <button key={notification.id} className="notification-row" onClick={() => { read.mutate(notification.id); if (notification.href) window.location.assign(notification.href); }}><span><strong>{notification.title}</strong><small>{notification.body || relativeTime(notification.createdAt)}</small></span>{!notification.readAt && <span className="status-dot" />}</button>) : <Empty title="You’re all caught up" text="GitHub review activity will appear here after a connection is enabled." />}</section></Page>;
}
