// Regression tests for Part 2's pagination UI: GET /appointments is now
// paginated (see routes/appointments.ts), and admin/pages/Appointments.tsx +
// scheduling/pages/Appointments.tsx were updated to consume the new
// { data, meta } envelope with next/previous page controls, matching the
// existing GET /customers pagination convention (admin/pages/Customers.tsx).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeAppointment(id: string, hoursFromNow: number, status = 'SCHEDULED') {
  return {
    id, status, type: 'MAINTENANCE', isUrgent: false,
    scheduledDate: new Date(Date.now() + hoursFromNow * 3600000).toISOString(),
    customer: { id: 'c1', name: `Customer ${id}` },
    visibleToScheduling: true, visibleToTechnician: true, adminApproved: true,
    createdByRole: 'ADMIN', version: 1,
  };
}

// 25 rows -> page 1 (20 rows) + page 2 (5 rows) at the backend's default limit=20.
const ALL_ROWS = Array.from({ length: 25 }, (_, i) => makeAppointment(`a${i}`, i));

function paginatedResponse(page: number, limit: number, status?: string) {
  const filtered = status ? ALL_ROWS.filter(a => a.status === status) : ALL_ROWS;
  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);
  return { success: true, data, meta: { page, limit, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / limit)) } };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  vi.resetModules();
});

function mount(children: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('Admin Appointments: pagination UI', () => {
  const apiGet = vi.fn((url: string, config: any = {}) => {
    if (url === '/appointments') {
      if (config.params?.pendingSchedulingApproval === 'true') {
        return Promise.resolve({ data: { success: true, data: [], meta: { page: 1, limit: 1, total: 2, totalPages: 2 } } });
      }
      const page = config.params?.page ?? 1;
      const limit = config.params?.limit ?? 20;
      return Promise.resolve({ data: paginatedResponse(page, limit, config.params?.status) });
    }
    if (url === '/appointments/pending-export-approval') {
      return Promise.resolve({ data: { success: true, data: [{ id: 'exp1' }, { id: 'exp2' }, { id: 'exp3' }] } });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });

  beforeEach(() => {
    apiGet.mockClear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
  });

  it('shows page 1 of 2 and the correct row count on initial mount (meta consumed correctly)', async () => {
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Appointments } = await import('../../unified-app/src/admin/pages/Appointments');
    const el = mount(<Appointments />);
    await flush();

    expect(el.textContent).toContain('1 / 2');
    expect(el.querySelectorAll('tbody tr').length).toBe(20);
  });

  it('next page fetches page 2 (5 rows) and updates the page indicator; previous returns to page 1', async () => {
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Appointments } = await import('../../unified-app/src/admin/pages/Appointments');
    const el = mount(<Appointments />);
    await flush();

    const nextBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent === '›')!;
    act(() => { nextBtn.click(); });
    await flush();

    expect(el.textContent).toContain('2 / 2');
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
    const page2Call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 2 && !c[1]?.params?.pendingSchedulingApproval);
    expect(page2Call).toBeTruthy();

    const prevBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent === '‹')!;
    act(() => { prevBtn.click(); });
    await flush();
    expect(el.textContent).toContain('1 / 2');
  });

  it('changing the status filter resets to page 1 (not left on whatever page was previously open)', async () => {
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Appointments } = await import('../../unified-app/src/admin/pages/Appointments');
    const el = mount(<Appointments />);
    await flush();

    const nextBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent === '›')!;
    act(() => { nextBtn.click(); });
    await flush();
    expect(el.textContent).toContain('2 / 2');

    apiGet.mockClear();
    const cancelledFilterBtn = Array.from(el.querySelectorAll('button')).find(b => /cancelled|ملغ/i.test(b.textContent || ''))!;
    act(() => { cancelledFilterBtn.click(); });
    await flush();

    const call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.status && !c[1]?.params?.pendingSchedulingApproval);
    expect(call?.[1]?.params?.page).toBe(1);
  });

  it('existing status filter still narrows results correctly alongside pagination (no regression)', async () => {
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Appointments } = await import('../../unified-app/src/admin/pages/Appointments');
    const el = mount(<Appointments />);
    await flush();

    const cancelledFilterBtn = Array.from(el.querySelectorAll('button')).find(b => /cancelled|ملغ/i.test(b.textContent || ''))!;
    act(() => { cancelledFilterBtn.click(); });
    await flush();

    // No row has status CANCELLED in ALL_ROWS, so the filtered result is empty
    // -- also exercises empty-page handling (no crash, zero rows, "1 / 1").
    expect(el.querySelectorAll('tbody tr').length).toBe(0);
    expect(el.textContent).toContain('1 / 1');
  });

  it('banners reflect the dedicated total-based queries, not the paginated table array', async () => {
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Appointments } = await import('../../unified-app/src/admin/pages/Appointments');
    const el = mount(<Appointments />);
    await flush();

    expect(el.textContent).toMatch(/2 (scheduling appointment|موعد من الجدولة)/);
    expect(el.textContent).toMatch(/3 (exported appointment|موعد مصدّر)/);
  });
});

describe('Scheduling Appointments: pagination UI', () => {
  const apiGet = vi.fn((url: string, config: any = {}) => {
    if (url === '/appointments') {
      const page = config.params?.page ?? 1;
      const limit = config.params?.limit ?? 20;
      return Promise.resolve({ data: paginatedResponse(page, limit) });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });

  beforeEach(() => {
    apiGet.mockClear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => { useAppStore.setState({ schedulingAuth: null, serverUrl: 'http://localhost:9999' }); });
  });

  it('shows page 1 of 2 on mount and advances to page 2 (5 rows) on next', async () => {
    vi.doMock('../../unified-app/src/scheduling/api/client', () => ({ api: { get: apiGet } }));
    const { default: SchedAppointments } = await import('../../unified-app/src/scheduling/pages/Appointments');
    const el = mount(<SchedAppointments />);
    await flush();

    expect(el.textContent).toContain('1 / 2');
    expect(el.querySelectorAll('tbody tr').length).toBe(20);

    const nextBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent === '›')!;
    act(() => { nextBtn.click(); });
    await flush();

    expect(el.textContent).toContain('2 / 2');
    expect(el.querySelectorAll('tbody tr').length).toBe(5);
  });
});
