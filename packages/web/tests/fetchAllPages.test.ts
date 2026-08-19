// Unit tests for the shared fetchAllPages() helper, used by every appointment
// list/queue/export flow that needs the COMPLETE matching dataset from the
// now-paginated GET /appointments (see utils/fetchAllPages.ts's own comment
// for why this exists and which callers use it instead of paginated browsing UI).
import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages } from '@/utils/fetchAllPages';

function makeApi(pages: any[][]) {
  const get = vi.fn((_url: string, config: any) => {
    const page = config.params.page as number;
    const rows = pages[page - 1] || [];
    const total = pages.reduce((sum, p) => sum + p.length, 0);
    return Promise.resolve({
      data: { success: true, data: rows, meta: { page, limit: config.params.limit, total, totalPages: pages.length } },
    });
  });
  return { get };
}

describe('fetchAllPages', () => {
  it('returns all rows from a single page without a second request', async () => {
    const api = makeApi([[{ id: 'a' }, { id: 'b' }]]);
    const rows = await fetchAllPages(api, '/appointments', { status: 'SCHEDULED' });
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('fetches and concatenates every page, in order, when there is more than one', async () => {
    const api = makeApi([[{ id: 'p1a' }, { id: 'p1b' }], [{ id: 'p2a' }], [{ id: 'p3a' }, { id: 'p3b' }]]);
    const rows = await fetchAllPages(api, '/appointments', {});
    expect(rows.map((r: any) => r.id)).toEqual(['p1a', 'p1b', 'p2a', 'p3a', 'p3b']);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('requests every page with the endpoint\'s documented max page size (100), never an arbitrary large single-page limit', async () => {
    const api = makeApi([[{ id: 'a' }], [{ id: 'b' }]]);
    await fetchAllPages(api, '/appointments', { urgent: 'true' });
    for (const call of api.get.mock.calls) {
      expect(call[1].params.limit).toBe(100);
    }
  });

  it('passes through caller-supplied filters unchanged on every page request', async () => {
    const api = makeApi([[{ id: 'a' }], [{ id: 'b' }]]);
    await fetchAllPages(api, '/appointments', { status: 'CANCELLED', from: '2026-01-01' });
    for (const call of api.get.mock.calls) {
      expect(call[1].params.status).toBe('CANCELLED');
      expect(call[1].params.from).toBe('2026-01-01');
    }
  });

  it('returns an empty array when there are no matching rows at all', async () => {
    const api = makeApi([[]]);
    const rows = await fetchAllPages(api, '/appointments', {});
    expect(rows).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
