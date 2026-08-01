import type { WorkflowState } from '../../api';

export function Status({ state }: { state: Partial<WorkflowState> }) { return <span className="status-dot" title={state.name} style={{ background: state.color ?? '#64748b' }} />; }
