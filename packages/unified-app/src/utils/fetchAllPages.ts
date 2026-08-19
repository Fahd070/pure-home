// Shared helper for callers that genuinely need every row matching a filter
// from a paginated list endpoint (e.g. urgent-work lists, the technician work
// queue, the appointments report/export) -- as opposed to a browsable
// list/table page, which should use the endpoint's page/limit + meta directly
// instead of this helper. Fetches page 1 to learn the real page count from
// the response's own `meta.totalPages`, then fetches any remaining pages in
// parallel and concatenates every page's rows, in order. Uses the endpoint's
// documented maximum page size (100) per request, never an arbitrary large
// single-page limit, so it stays correct however many rows actually exist.
type PaginatedResponse<T> = {
  success: boolean;
  data: T[];
  meta?: { page: number; limit: number; total: number; totalPages: number };
};

type ApiGet = (url: string, config?: { params?: Record<string, unknown> }) => Promise<{ data: PaginatedResponse<any> }>;

const MAX_PAGE_SIZE = 100;

export async function fetchAllPages<T = any>(
  api: { get: ApiGet },
  url: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const first = await api.get(url, { params: { ...params, page: 1, limit: MAX_PAGE_SIZE } });
  const firstBody = first.data;
  const results: T[] = firstBody.data || [];
  const totalPages = firstBody.meta?.totalPages ?? 1;
  if (totalPages <= 1) return results;

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      api.get(url, { params: { ...params, page: i + 2, limit: MAX_PAGE_SIZE } }).then(r => r.data.data || [])
    )
  );
  for (const chunk of rest) results.push(...chunk);
  return results;
}
