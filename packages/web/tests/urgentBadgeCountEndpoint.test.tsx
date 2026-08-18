// Perf fix regression test: the Admin/Technician Sidebar urgent badges used
// to call GET /appointments?urgent=true&limit=200 (a `limit` the backend
// never read, so it was always fully unbounded, transferring every
// relation for every urgent appointment) purely to compute
// `.filter(a => !a.urgentVisitRecord).length` client-side. Both Sidebars now
// call the dedicated GET /appointments/urgent-unresolved-count endpoint
// instead. This locks in: the new endpoint is actually called, the old
// unbounded query is gone, and the existing 30s-poll/socket-refetch/badge
// display behavior is unchanged.
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

const adminApiGet = vi.fn((url: string) => {
  if (url === '/appointments/urgent-unresolved-count') return Promise.resolve({ data: { success: true, data: 3 } });
  if (url === '/messages') return Promise.resolve({ data: { success: true, data: [], meta: { total: 0 } } });
  return Promise.resolve({ data: { success: true, data: [] } });
});
vi.mock('../../unified-app/src/admin/api/client', () => ({
  api: { get: (...args: any[]) => adminApiGet(...(args as [string])) },
}));

const techApiGet = vi.fn((url: string) => {
  if (url === '/appointments/urgent-unresolved-count') return Promise.resolve({ data: { success: true, data: 2 } });
  if (url === '/messages') return Promise.resolve({ data: { success: true, data: [] } });
  return Promise.resolve({ data: { success: true, data: [] } });
});
vi.mock('../../unified-app/src/technician/api/client', () => ({
  api: { get: (...args: any[]) => techApiGet(...(args as [string])) },
}));

// No auth token on the shared app store for either role, so admin/technician
// hooks/useSocket bail out before attempting a real connection (same pattern
// as systemActivityCacheCollision.test.tsx) -- no socket.io-client mock needed.

let AdminSidebar: typeof import('../../unified-app/src/admin/components/Sidebar').default;
let TechSidebar: typeof import('../../unified-app/src/technician/components/Sidebar').default;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

beforeEach(async () => {
  adminApiGet.mockClear();
  techApiGet.mockClear();
  ({ default: AdminSidebar } = await import('../../unified-app/src/admin/components/Sidebar'));
  ({ default: TechSidebar } = await import('../../unified-app/src/technician/components/Sidebar'));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    useAppStore.setState({ adminAuth: null, technicianAuth: null, serverUrl: 'http://localhost:9999' });
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
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('Admin Sidebar urgent badge: uses the count endpoint', () => {
  it('7/9. calls GET /appointments/urgent-unresolved-count and never calls GET /appointments for the urgent badge', async () => {
    const el = mount(<AdminSidebar />);
    await flush();

    const countCalls = adminApiGet.mock.calls.filter((c) => c[0] === '/appointments/urgent-unresolved-count');
    expect(countCalls.length).toBeGreaterThan(0);

    const oldUnboundedCalls = adminApiGet.mock.calls.filter((c) => c[0] === '/appointments');
    expect(oldUnboundedCalls.length).toBe(0);

    // Badge display behavior unchanged: renders the count from the endpoint.
    expect(el.textContent).toContain('3');
  });
});

describe('Technician Sidebar urgent badge: uses the count endpoint', () => {
  it('8/9. calls GET /appointments/urgent-unresolved-count and never calls GET /appointments for the urgent badge', async () => {
    const el = mount(<TechSidebar />);
    await flush();

    const countCalls = techApiGet.mock.calls.filter((c) => c[0] === '/appointments/urgent-unresolved-count');
    expect(countCalls.length).toBeGreaterThan(0);

    const oldUnboundedCalls = techApiGet.mock.calls.filter((c) => c[0] === '/appointments');
    expect(oldUnboundedCalls.length).toBe(0);

    expect(el.textContent).toContain('2');
  });
});

// Source-level guards: the behavioral tests above prove the endpoint is
// actually called; these lock in the surrounding query configuration
// (queryKey, 30s fallback poll, socket-refetch wiring) staying unchanged,
// the same convention systemActivityCacheCollision.test.tsx uses.
describe('Source: urgent badge query configuration unchanged apart from the endpoint', () => {
  const adminSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/admin/components/Sidebar.tsx'), 'utf-8'
  );
  const techSrc = fs.readFileSync(
    path.resolve(__dirname, '../../unified-app/src/technician/components/Sidebar.tsx'), 'utf-8'
  );

  it('Admin: queryKey unchanged, queryFn hits the new endpoint, initialData 0, 30s refetchInterval preserved', () => {
    expect(adminSrc).toMatch(
      /queryKey:\s*\["urgent-unresolved-admin"\][\s\S]{0,80}queryFn:\s*\(\)\s*=>\s*api\.get\("\/appointments\/urgent-unresolved-count"\)\.then\(r\s*=>\s*Number\(r\.data\.data\)\s*\|\|\s*0\)[\s\S]{0,60}refetchInterval:\s*30000[\s\S]{0,20}initialData:\s*0/
    );
  });

  it('Technician: queryKey unchanged, queryFn hits the new endpoint, initialData 0, 30s refetchInterval preserved', () => {
    expect(techSrc).toMatch(
      /queryKey:\s*\["urgent-unresolved-tech"\][\s\S]{0,80}queryFn:\s*\(\)\s*=>\s*api\.get\("\/appointments\/urgent-unresolved-count"\)\.then\(r\s*=>\s*Number\(r\.data\.data\)\s*\|\|\s*0\)[\s\S]{0,60}refetchInterval:\s*30000[\s\S]{0,20}initialData:\s*0/
    );
  });

  it('10/11. Admin: 30s poll and all three socket-triggered refetches remain wired to refetchUrgentBadge', () => {
    expect(adminSrc).toMatch(/refetch:\s*refetchUrgentBadge/);
    expect(adminSrc).toMatch(/socket\.on\("appointment:created",\s*refetchUrgentBadge\)/);
    expect(adminSrc).toMatch(/socket\.on\("appointment:deleted",\s*refetchUrgentBadge\)/);
    expect(adminSrc).toMatch(/socket\.on\("urgent_visit:submitted",\s*refetchUrgentBadge\)/);
  });

  it('10/11. Technician: 30s poll and all three socket-triggered refetches remain wired to refetchUrgentBadge', () => {
    expect(techSrc).toMatch(/refetch:\s*refetchUrgentBadge/);
    expect(techSrc).toMatch(/socket\.on\("appointment:created",\s*refetchUrgentBadge\)/);
    expect(techSrc).toMatch(/socket\.on\("appointment:deleted",\s*refetchUrgentBadge\)/);
    expect(techSrc).toMatch(/socket\.on\("urgent_visit:submitted",\s*refetchUrgentBadge\)/);
  });

  it('neither Sidebar source references the old unbounded query shape anymore', () => {
    expect(adminSrc).not.toMatch(/api\.get\("\/appointments",\s*\{\s*params:\s*\{\s*urgent:/);
    expect(techSrc).not.toMatch(/api\.get\("\/appointments",\s*\{\s*params:\s*\{\s*urgent:/);
  });
});
