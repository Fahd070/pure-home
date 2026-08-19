// Regression tests proving that every "must not silently truncate" caller of
// GET /appointments (urgent-work lists, the technician work queue, and the
// admin appointments report/export) genuinely fetches every page via
// fetchAllPages(), not just page 1 -- the exact failure mode Part 3/5 of the
// pagination task warns against. Each mock backend returns 2 pages; if any
// of these components regressed to a single unpaginated/truncated call, the
// second page's rows would be missing from what's rendered.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function urgentAppt(id: string, createdByRole = 'ADMIN') {
  return {
    id, status: 'SCHEDULED', type: 'MAINTENANCE', isUrgent: true, createdByRole,
    scheduledDate: new Date().toISOString(), customer: { name: `Urgent ${id}` },
    visibleToTechnician: true, urgentVisitRecord: null, version: 1,
  };
}
function workQueueAppt(id: string) {
  return {
    id, status: 'SCHEDULED', workStatus: 'WAITING', type: 'MAINTENANCE', isUrgent: false,
    scheduledDate: new Date().toISOString(), customer: { name: `Job ${id}` }, version: 1,
  };
}
function reportAppt(id: string, isUrgent: boolean) {
  return {
    id, status: 'SCHEDULED', type: 'MAINTENANCE', isUrgent, createdByRole: 'ADMIN',
    scheduledDate: new Date().toISOString(), customer: { name: `Report ${id}`, phone: '0500000000' },
  };
}

// Generic 2-page mock: page 1 has `page1`, page 2 has `page2`; anything else
// (non-/appointments URLs, or a request missing page:1/2) returns an empty list.
function twoPageApiGet(page1: any[], page2: any[]) {
  return vi.fn((url: string, config: any = {}) => {
    if (url === '/appointments') {
      const page = config.params?.page;
      if (page === 1) return Promise.resolve({ data: { success: true, data: page1, meta: { page: 1, limit: 100, total: page1.length + page2.length, totalPages: 2 } } });
      if (page === 2) return Promise.resolve({ data: { success: true, data: page2, meta: { page: 2, limit: 100, total: page1.length + page2.length, totalPages: 2 } } });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });
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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('Admin Urgent Appointments: fetches every page, not just page 1', () => {
  it('renders urgent appointments from both mocked pages', async () => {
    act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = twoPageApiGet([urgentAppt('u1'), urgentAppt('u2')], [urgentAppt('u3')]);
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet, post: vi.fn() } }));
    const { default: UrgentAppointments } = await import('../../unified-app/src/admin/pages/UrgentAppointments');
    const el = mount(<UrgentAppointments />);
    await flush();

    // 3 rows total (2 from page 1 + 1 from page 2) -- would be 2 on a
    // truncation regression back to a single unpaginated/page-1-only call.
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    const page2Call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 2);
    expect(page2Call).toBeTruthy();
  });
});

describe('Technician Urgent Appointments: fetches every page, not just page 1', () => {
  it('renders urgent appointments from both mocked pages', async () => {
    act(() => { useAppStore.setState({ technicianAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = twoPageApiGet([urgentAppt('tu1')], [urgentAppt('tu2'), urgentAppt('tu3')]);
    vi.doMock('../../unified-app/src/technician/api/client', () => ({ api: { get: apiGet, post: vi.fn() } }));
    const { default: TechUrgentAppointments } = await import('../../unified-app/src/technician/pages/UrgentAppointments');
    const el = mount(<TechUrgentAppointments />);
    await flush();

    // 3 rows total (1 from page 1 + 2 from page 2) -- would be 1 on a
    // truncation regression back to a single unpaginated/page-1-only call.
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    const page2Call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 2);
    expect(page2Call).toBeTruthy();
  });
});

describe('Technician Work Queue: fetches every page, not just page 1', () => {
  it('renders work queue jobs from both mocked pages', async () => {
    act(() => { useAppStore.setState({ technicianAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = twoPageApiGet([workQueueAppt('w1')], [workQueueAppt('w2')]);
    vi.doMock('../../unified-app/src/technician/api/client', () => ({ api: { get: apiGet } }));
    const { default: WorkQueue } = await import('../../unified-app/src/technician/pages/WorkQueue');
    const el = mount(<WorkQueue />);
    await flush();

    expect(el.textContent).toContain('Job w1');
    expect(el.textContent).toContain('Job w2'); // page 2
    const page2Call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 2);
    expect(page2Call).toBeTruthy();
    const call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 1);
    expect(call?.[1]?.params?.workStatus).toBe('WAITING,IN_PROGRESS');
  });
});

describe('Admin Reports: appointments export fetches every page (no silent truncation)', () => {
  it('the loaded appointment counts reflect all rows across both mocked pages, not just page 1', async () => {
    act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = twoPageApiGet(
      [reportAppt('r1', false), reportAppt('r2', false)],
      [reportAppt('r3', false), reportAppt('r4', true)]
    );
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: Reports } = await import('../../unified-app/src/admin/pages/Reports');
    const el = mount(<Reports />);
    await flush();

    // Reports.tsx gates each report type behind a top-level tab (customers /
    // appointments / sales); the appointments filter section only renders
    // after selecting the "Appointment Reports" tab.
    const apptsTabBtn = Array.from(el.querySelectorAll('button')).find(b => /appointment reports|تقارير المواعيد/i.test(b.textContent || ''));
    expect(apptsTabBtn).toBeTruthy();
    act(() => { apptsTabBtn!.click(); });
    await flush();

    const loadBtn = Array.from(el.querySelectorAll('button')).find(b => /load results|تحميل النتائج/i.test(b.textContent || ''));
    expect(loadBtn).toBeTruthy();
    act(() => { loadBtn!.click(); });
    await flush();

    // 3 regular (non-urgent) across both pages, 1 urgent -- both counts only
    // add up correctly if page 2's rows were actually fetched and included.
    expect(el.textContent).toMatch(/\(3\)/); // regularAppts.length
    expect(el.textContent).toMatch(/\(1\)/); // urgentAppts.length
    const page2Call = apiGet.mock.calls.find(c => c[0] === '/appointments' && c[1]?.params?.page === 2);
    expect(page2Call).toBeTruthy();
  });
});
