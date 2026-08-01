import { and, eq, lt, or } from 'drizzle-orm';
import { tasks } from '../db/schema';

export const pageLimit = 25;
export const maximumPageLimit = 100;

export type ListPage<T> = { items: T[]; nextCursor: string | null };
export type UpdatedCursor = { updatedAt: string; id: string };

export function selectChanged(record: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(input).map((key) => [key, record[key]]));
}

export function canonicalPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

export function countBy<T>(items: T[], key: (item: T) => string | null): Record<string, number> {
  return items.reduce<Record<string, number>>((total, item) => {
    const value = key(item) ?? 'unknown';
    total[value] = (total[value] ?? 0) + 1;
    return total;
  }, {});
}

export function requestedLimit(value: string | undefined): number {
  const parsed = Number(value ?? pageLimit);
  if (!Number.isInteger(parsed) || parsed < 1) return pageLimit;
  return Math.min(parsed, maximumPageLimit);
}

export function decodeUpdatedCursor(value: string | undefined): UpdatedCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as UpdatedCursor;
    if (!parsed.id || Number.isNaN(new Date(parsed.updatedAt).valueOf())) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function beforeUpdatedCursor(updatedAt: any, id: any, cursor: UpdatedCursor | null) {
  if (!cursor) return undefined;
  const timestamp = new Date(cursor.updatedAt);
  return or(lt(updatedAt, timestamp), and(eq(updatedAt, timestamp), lt(id, cursor.id)));
}

export function paginate<T>(rows: T[], limit: number, cursorSubject: (row: T) => { id: string; updatedAt: Date } = (row) => row as { id: string; updatedAt: Date }): ListPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const cursor = last && rows.length > limit ? cursorSubject(last) : null;
  return {
    items,
    nextCursor: cursor ? Buffer.from(JSON.stringify({ id: cursor.id, updatedAt: cursor.updatedAt.toISOString() })).toString('base64url') : null,
  };
}

export function taskTimestamps(semantic: string, current: typeof tasks.$inferSelect) {
  if (semantic === 'in_progress' && !current.startedAt) return { startedAt: new Date(), completedAt: current.completedAt };
  if (semantic === 'done') return { startedAt: current.startedAt ?? new Date(), completedAt: new Date() };
  if (current.completedAt) return { completedAt: null };
  return {};
}

