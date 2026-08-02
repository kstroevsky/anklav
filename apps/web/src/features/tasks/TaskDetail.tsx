import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, mutation } from '../../api';
import type { WorkflowState, Workspace } from '../../api';
import { Activity } from '../../components/molecules/Activity';
import { Callout } from '../../components/molecules/Callout';
import { EditableMarkdown } from '../../components/molecules/EditableMarkdown';
import { Empty } from '../../components/molecules/Empty';
import { Markdown } from '../../components/molecules/Markdown';
import { Meta } from '../../components/molecules/Meta';
import { Loading } from '../../components/atoms/Loading';
import { LabelEditor } from '../../components/organisms/LabelEditor';
import { RelationEditor } from '../../components/organisms/RelationEditor';
import { Checklist } from './Checklist';
import { TaskProperties } from './TaskProperties';
import { TaskGitHub } from '../github/TaskGitHub';
import { relativeTime } from '../../utils/formatting';

export function TaskDetail({ workspace, taskId, states }: { workspace: Workspace; taskId: string; states: WorkflowState[] }) {
  const client = useQueryClient();
  const detail = useQuery<any>({
    queryKey: ['task', workspace.id, taskId],
    queryFn: () => api(`/workspaces/${workspace.id}/tasks/${taskId}`),
    refetchInterval: 15_000,
  });
  const [comment, setComment] = useState('');
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['task', workspace.id, taskId] });
    client.invalidateQueries({ queryKey: ['tasks', workspace.id] });
  };
  const update = useMutation({
    mutationFn: (body: any) => api(`/workspaces/${workspace.id}/tasks/${taskId}`, mutation('PATCH', body, detail.data.version)),
    onSuccess: refresh,
    onError: (err: ApiError) => err.status === 412 && refresh(),
  });
  const review = useMutation({
    mutationFn: (reviewStatus: string) => api(`/workspaces/${workspace.id}/tasks/${taskId}/review`, mutation('PATCH', { reviewStatus }, detail.data.version)),
    onSuccess: refresh,
  });
  const commentAction = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}/task/${taskId}/comments`, mutation('POST', { body: comment })),
    onSuccess: () => {
      setComment('');
      refresh();
    },
  });
  if (detail.isLoading) return <Loading />;
  if (!detail.data) return <Empty title="Task not found" text="It may have been deleted or moved." />;
  const task = detail.data;
  const chooseState = async (workflowStateId: string) => {
    const preview = await api<{ warnings: string[] }>(`/workspaces/${workspace.id}/tasks/${taskId}/transition-preview?stateId=${workflowStateId}`);
    if (!preview.warnings.length || window.confirm(`This transition has advisory signals:\n\n${preview.warnings.join('\n')}\n\nContinue?`)) update.mutate({ workflowStateId });
  };
  return (
    <article className="detail">
      <header className="detail-header">
        <div>
          <span className="eyebrow">
            {task.identifier} · {task.project?.name}
          </span>
          <h2>{task.title}</h2>
        </div>
        <select aria-label="Task state" value={task.workflowStateId} onChange={(event) => void chooseState(event.target.value)}>
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </select>
      </header>
      <TaskGitHub workspace={workspace} task={task} />
      {task.transitionWarnings?.length > 0 && (
        <Callout title="Transition signals">
          {task.transitionWarnings.map((warning: string) => (
            <p key={warning}>{warning}</p>
          ))}
        </Callout>
      )}
      <EditableMarkdown title="Goal and scope" value={task.description} onSave={(description) => update.mutate({ description })} />
      <EditableMarkdown title="Objective" value={task.objective} empty="State the concrete outcome this task must achieve." onSave={(objective) => update.mutate({ objective })} />
      <section className="meta-grid">
        <Meta label="Priority" value={task.priority} />
        {task.humanReviewRequired ? (
          <label>
            Human review
            <select value={task.reviewStatus} onChange={(event) => review.mutate(event.target.value)}>
              <option value="pending">pending</option>
              <option value="approved">approved</option>
              <option value="changes_requested">changes requested</option>
            </select>
          </label>
        ) : (
          <Meta label="Human review" value="Not required" />
        )}
        <Meta label="Due" value={task.dueDate ?? '—'} />
      </section>
      <TaskProperties workspace={workspace} task={task} save={(body) => update.mutate(body)} />
      <Checklist workspace={workspace} task={task} />
      <EditableMarkdown title="Verification performed" value={task.verificationPerformed} empty="Record the verification you performed." onSave={(verificationPerformed) => update.mutate({ verificationPerformed })} />
      <EditableMarkdown title="Completion evidence" value={task.completionEvidence} empty="Record completion evidence." onSave={(completionEvidence) => update.mutate({ completionEvidence })} />
      <EditableMarkdown title="Remaining limitations" value={task.remainingLimitations} empty="Record known limitations." onSave={(remainingLimitations) => update.mutate({ remainingLimitations })} />
      <EditableMarkdown title="Follow-up work" value={task.followUpWork} empty="Record follow-up work." onSave={(followUpWork) => update.mutate({ followUpWork })} />
      <section>
        <h3>Flows</h3>
        {task.flows?.length ? (
          task.flows.map((entry: any) => (
            <span className="chip" key={entry.flow.id}>
              {entry.link.role}: {entry.flow.name}
            </span>
          ))
        ) : (
          <p className="muted">Not connected to a flow.</p>
        )}
      </section>
      <LabelEditor workspace={workspace} subject="task" subjectId={task.id} assigned={task.labels ?? []} />
      <RelationEditor workspace={workspace} kind="task" subjectId={task.id} relations={task.relations ?? []} />
      <section>
        <h3>Discussion</h3>
        <div className="comments">
          {task.comments?.map((entry: any) => (
            <article key={entry.id} className="comment">
              <Markdown value={entry.body} />
              <small>{relativeTime(entry.createdAt)}</small>
            </article>
          ))}
        </div>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add progress, evidence, or a question…" />
        <button className="button" disabled={!comment.trim() || commentAction.isPending} onClick={() => commentAction.mutate()}>
          Add comment
        </button>
      </section>
      <Activity events={task.activity ?? []} />
    </article>
  );
}
