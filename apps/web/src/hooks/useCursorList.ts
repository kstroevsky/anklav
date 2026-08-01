import { useInfiniteQuery } from '@tanstack/react-query';
import { api, Page as ApiPage } from '../api';

export function useCursorList<T>(key: unknown[], path: string, params: Record<string, string>) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  const result = useInfiniteQuery({
    queryKey: [...key, params],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const next = new URLSearchParams(query);
      if (pageParam) next.set('cursor', pageParam as string);
      return api<ApiPage<T>>(`${path}?${next.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  return { ...result, items: result.data?.pages.flatMap((page) => page.items) ?? [] };
}
