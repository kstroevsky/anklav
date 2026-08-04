import { statusTone } from './taskRunsUtils';

export function StatusText({ value }: { value: string }) {
  return <span className={`ops-status ${statusTone(value)}`}><i />{value.replaceAll('_', ' ')}</span>;
}
