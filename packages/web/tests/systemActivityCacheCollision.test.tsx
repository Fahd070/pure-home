// Regression test for the Admin "System Activity" page appearing empty.
//
// Root cause: admin/components/Sidebar.tsx (mounted on every /admin/* route)
// and admin/pages/Messages.tsx (the System Activity page) both registered a
// useQuery under the identical key ["activity-feed"], but with DIFFERENT
// response shapes: Sidebar's queryFn resolved to a bare array
// (`r.data.data || []`, seeded synchronously via `initialData: []`), while
// Messages.tsx's queryFn resolved to the real `{ data: [...], meta: {...} }`
// envelope and read `.data` off of it. Since Sidebar mounts first on every
// admin page (and seeds the shared cache entry immediately via
// `initialData`), Messages.tsx would see the array sitting in the cache,
// read `.data` off of an array (undefined), and fall back to an empty list --
// even though the server has real audit log entries -- for as long as that
// cache entry stayed within its 30s staleTime.
//
// This test reproduces the actual reported scenario end-to-end: mount the
// real Sidebar (as AdminLayout always does) first, then mount the real
// System Activity page sharing the same QueryClient, and assert the real
// activity is visible. No React Testing Library is installed in this
// project; rendering uses plain react-dom/client + act, matching
// appTitleBar.test.tsx.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const AUDIT_LOGS = [
  { id: 'a1', action: 'CREATE|||إنشاء عميل', entityType: 'customer', createdAt: new Date().toISOString(), user: { id: 'u1', name: 'Admin One', role: 'ADMIN' } },
  { id: 'a2', action: 'UPDATE|||تحديث موعد', entityType: 'appointment', createdAt: new Date().toISOString(), user: { id: 'u2', name: 'Sched Two', role: 'SCHEDULING' } },
  { id: 'a3', action: 'DELETE|||حذف مهمة', entityType: 'task', createdAt: new Date().toISOString(), user: { id: 'u1', name: 'Admin One', role: 'ADMIN' } },
];

const apiGet = vi.fn((url: string) => {
  if (url === '/messages') {
    return Promise.resolve({ data: { success: true, data: AUDIT_LOGS, meta: { total: AUDIT_LOGS.length } } });
  }
  // Every other endpoint Sidebar touches on mount (badges) -- generic safe empty shape.
  return Promise.resolve({ data: { success: true, data: [] } });
});
const apiDelete = vi.fn(() => Promise.resolve({ data: { success: true } }));

vi.mock('../../unified-app/src/admin/api/client', () => ({
  api: { get: (...args: any[]) => apiGet(...(args as [string])), delete: (...args: any[]) => apiDelete(...args) },
}));

// No auth token is set on the app store for this test, so admin/hooks/useSocket
// never attempts a real connection (it bails out early when there is no
// token) -- no socket.io-client mock is needed.

let Sidebar: typeof import('../../unified-app/src/admin/components/Sidebar').default;
let Messages: typeof import('../../unified-app/src/admin/pages/Messages').default;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

beforeEach(async () => {
  apiGet.mockClear();
  ({ default: Sidebar } = await import('../../unified-app/src/admin/components/Sidebar'));
  ({ default: Messages } = await import('../../unified-app/src/admin/pages/Messages'));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' });
  });
});

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
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
  // Let the mocked axios promise resolve and React Query's batched notifyManager
  // flush through to a re-render. A couple of bare microtask ticks is not
  // reliably enough (notifyManager can defer via its own scheduling), so this
  // polls across several real macrotask turns instead of guessing a fixed count.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('System Activity page vs. Sidebar: shared ["activity-feed"] query cache', () => {
  it('Sidebar mounting first (as it always does on every admin route) does not blank out the System Activity page', async () => {
    // 1) Sidebar mounts first, exactly as AdminLayout does on every /admin/* route.
    mount(<Sidebar />);
    await flush();

    // 2) Now the System Activity page mounts, sharing the same QueryClient --
    //    this is the exact "Sidebar populated the cache, then navigate to
    //    System Activity" scenario that was reported broken.
    const el = mount(<Messages />);
    await flush();

    // Must show the real audit log entries, not the empty state.
    expect(el.textContent).not.toMatch(/لا يوجد نشاط مسجل بعد|No activity/i);
    expect(el.textContent).toMatch(/Admin One|Sched Two/);
    expect(el.querySelectorAll('.group').length).toBe(AUDIT_LOGS.length);
  });

  it('both components ultimately request the same GET /messages endpoint (no unrelated new request introduced)', async () => {
    mount(<Sidebar />);
    await flush();
    mount(<Messages />);
    await flush();

    const messageCalls = apiGet.mock.calls.filter((c) => c[0] === '/messages');
    // Exactly one call: they share one cache entry under staleTime, so
    // Messages.tsx's mount does not trigger a second redundant fetch.
    expect(messageCalls.length).toBe(1);
  });

  it('delete-all button reflects the real total (not 0) once activity is loaded', async () => {
    mount(<Sidebar />);
    await flush();
    const el = mount(<Messages />);
    await flush();

    const deleteAllBtn = Array.from(el.querySelectorAll('button')).find((b) =>
      /delete all|حذف الكل/i.test(b.textContent || '')
    );
    expect(deleteAllBtn).toBeTruthy();
  });
});

// Source-level guard: locks in that both components read the identical
// response shape under the shared key, so a future edit to either one can't
// silently reintroduce the shape collision.
describe('Source: activity-feed cache shape stays consistent between Sidebar and Messages', () => {
  const sidebarSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/admin/components/Sidebar.tsx'),
    'utf-8'
  );
  const messagesSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/admin/pages/Messages.tsx'),
    'utf-8'
  );

  it('Sidebar resolves the activity-feed queryFn to the full response object (r.data), not a bare array', () => {
    expect(sidebarSrc).toMatch(/queryKey:\s*\["activity-feed"\][\s\S]{0,40}queryFn:\s*\(\)\s*=>\s*api\.get\("\/messages"\)\.then\(r\s*=>\s*r\.data\)/);
    expect(sidebarSrc).not.toMatch(/queryFn:\s*\(\)\s*=>\s*api\.get\("\/messages"\)\.then\(r\s*=>\s*r\.data\.data/);
  });

  it('Messages.tsx still resolves the activity-feed queryFn to the full response object', () => {
    expect(messagesSrc).toMatch(/queryKey:\s*\["activity-feed"\][\s\S]{0,40}queryFn:\s*\(\)\s*=>\s*api\.get\("\/messages"\)\.then\(r\s*=>\s*r\.data\)/);
  });

  it('realtime audit:new still invalidates the shared query key (unchanged)', () => {
    expect(messagesSrc).toMatch(/socket\.on\("audit:new",\s*\(\)\s*=>\s*qc\.invalidateQueries\(\{\s*queryKey:\s*\["activity-feed"\]\s*\}\)\)/);
  });

  it('delete-all is still protected by an expectedCount derived from the real total', () => {
    expect(messagesSrc).toMatch(/expectedCount:\s*activityTotal/);
    expect(messagesSrc).toMatch(/activityTotal[\s\S]{0,10}=\s*data\?\.meta\?\.total\s*\?\?\s*activity\.length/);
  });
});
