import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api';

export type AfterPage<T> = { items: T[]; nextAfter: number | null };
export const mergeAfterPages = <T,>(pages: AfterPage<T>[] | undefined) => pages?.flatMap((page) => page.items) ?? [];

export function useAfterList<T>(key: unknown[], path: string, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    enabled,
    queryFn: ({ pageParam }) => api<AfterPage<T>>(`${path}${pageParam ? `?after=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextAfter ?? undefined,
  });
  return { ...result, items: mergeAfterPages(result.data?.pages) };
}
