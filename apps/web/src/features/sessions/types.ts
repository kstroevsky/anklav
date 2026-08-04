import type { NativeSession, Run } from '../tasks/taskRunsTypes';
export type SharedSession = NativeSession & { run: Run; task: { id: string; identifier: string; title: string } };
export type SessionPage = { items: SharedSession[]; total: number; nextOffset: number | null };
