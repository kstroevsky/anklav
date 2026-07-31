export const priorities = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export const healthStates = ['unknown', 'on_track', 'at_risk', 'off_track'] as const;
export const projectStatuses = ['proposed', 'planned', 'active', 'paused', 'completed', 'archived'] as const;
export const taskSemantics = ['inbox', 'planned', 'ready', 'in_progress', 'human_review', 'blocked', 'done', 'cancelled'] as const;
export const flowSemantics = ['proposed', 'active', 'paused', 'converged', 'closed'] as const;

export type TaskSemantic = (typeof taskSemantics)[number];
export type FlowSemantic = (typeof flowSemantics)[number];

export const DEFAULT_TASK_STATES = [
  ['Inbox', 'inbox', '#64748b'],
  ['Planned', 'planned', '#6366f1'],
  ['Ready', 'ready', '#0ea5e9'],
  ['In Progress', 'in_progress', '#f59e0b'],
  ['Human Review', 'human_review', '#a855f7'],
  ['Blocked', 'blocked', '#ef4444'],
  ['Done', 'done', '#22c55e'],
  ['Cancelled', 'cancelled', '#94a3b8'],
] as const;

export const DEFAULT_FLOW_STATES = [
  ['Proposed', 'proposed', '#64748b'],
  ['Active', 'active', '#0ea5e9'],
  ['Paused', 'paused', '#f59e0b'],
  ['Converged', 'converged', '#22c55e'],
  ['Closed', 'closed', '#94a3b8'],
] as const;

export function isTaskTerminal(semantic: string): boolean {
  return semantic === 'done' || semantic === 'cancelled';
}

export function isFlowTerminal(semantic: string): boolean {
  return semantic === 'converged' || semantic === 'closed';
}
