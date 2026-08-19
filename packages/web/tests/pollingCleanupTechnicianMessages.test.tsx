// Regression tests for the polling-cleanup fix: the Technician Sidebar and
// the Technician "Messages" (System Activity) page both called
// GET /messages -- a route whose backend authorization
// (routes/messages.ts: requireRole('ADMIN', 'SCHEDULING')) never included
// TECHNICIAN, so every 30s poll and every page visit produced a guaranteed
// 403. No other authorized endpoint represents the same data for
// Technicians, so both the recurring badge request and the always-empty
// page/route/nav-entry were removed entirely -- backend authorization was
// NOT broadened. This file proves: the unauthorized call is gone, Technician
// navigation still works, and the same functionality for Admin (which IS
// authorized) is completely unaffected.
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

describe('Technician Sidebar: no unauthorized GET /messages request', () => {
  it('never calls GET /messages, and its other authorized badges still work', async () => {
    act(() => { useAppStore.setState({ technicianAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = vi.fn((url: string) => {
      if (url === '/messages') {
        // Simulates the real backend 403 -- if the Sidebar ever calls this
        // again, this test fails loudly instead of silently passing.
        return Promise.reject({ response: { status: 403, data: { success: false, message: 'Forbidden' } } });
      }
      if (url === '/notifications') return Promise.resolve({ data: { success: true, data: [{ id: '1', isRead: false }] } });
      if (url === '/direct-messages/unread-count') return Promise.resolve({ data: { success: true, data: 2 } });
      if (url === '/appointments/urgent-unresolved-count') return Promise.resolve({ data: { success: true, data: 0 } });
      return Promise.resolve({ data: { success: true, data: [] } });
    });
    vi.doMock('../../unified-app/src/technician/api/client', () => ({ api: { get: apiGet } }));
    const { default: TechSidebar } = await import('../../unified-app/src/technician/components/Sidebar');
    const el = mount(<TechSidebar />);
    await flush();

    const messagesCalls = apiGet.mock.calls.filter((c) => c[0] === '/messages');
    expect(messagesCalls.length).toBe(0);

    // Other authorized badges (notifications, DM unread) still fetch and render.
    expect(apiGet.mock.calls.some((c) => c[0] === '/notifications')).toBe(true);
    expect(apiGet.mock.calls.some((c) => c[0] === '/direct-messages/unread-count')).toBe(true);
    expect(el.textContent).toContain('1'); // unread notification badge
    expect(el.textContent).toContain('2'); // DM unread badge
  });

  it('no longer renders a "Messages" nav link (no route to navigate to)', async () => {
    act(() => { useAppStore.setState({ technicianAuth: null, serverUrl: 'http://localhost:9999' }); });
    vi.doMock('../../unified-app/src/technician/api/client', () => ({
      api: { get: vi.fn(() => Promise.resolve({ data: { success: true, data: [] } })) },
    }));
    const { default: TechSidebar } = await import('../../unified-app/src/technician/components/Sidebar');
    const el = mount(<TechSidebar />);
    await flush();

    const links = Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).not.toContain('/technician/messages');

    // The rest of Technician navigation is untouched.
    expect(links).toEqual(expect.arrayContaining([
      '/technician/queue', '/technician/urgent-appointments', '/technician/expenses',
      '/technician/notifications', '/technician/messaging', '/technician/settings',
    ]));
  });

  it('urgent badge socket-triggered refetch remains wired (30s fallback interval unchanged)', async () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/technician/components/Sidebar.tsx'), 'utf-8'
    );
    expect(src).toMatch(/queryKey:\s*\["urgent-unresolved-tech"\][\s\S]{0,200}refetchInterval:\s*30000/);
    expect(src).toMatch(/socket\.on\("appointment:created",\s*refetchUrgentBadge\)/);
    expect(src).toMatch(/socket\.on\("appointment:deleted",\s*refetchUrgentBadge\)/);
    expect(src).toMatch(/socket\.on\("urgent_visit:submitted",\s*refetchUrgentBadge\)/);
  });
});

describe('Technician Messages page/route: removed entirely, not silently broadened', () => {
  it('technician/pages/Messages.tsx no longer exists', () => {
    const messagesPagePath = path.resolve(__dirname, '../../unified-app/src/technician/pages/Messages.tsx');
    expect(fs.existsSync(messagesPagePath)).toBe(false);
  });

  it('App.tsx no longer imports or routes to a technician Messages page', () => {
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/App.tsx'), 'utf-8');
    expect(appSrc).not.toMatch(/TechMessages/);
    expect(appSrc).not.toMatch(/<Route path="messages" element=\{<TechMessages/);
    // The technician route block itself is otherwise intact.
    expect(appSrc).toMatch(/<Route path="queue" element=\{<WorkQueue \/>\} \/>/);
    expect(appSrc).toMatch(/<Route path="notifications" element=\{<TechNotifications \/>\} \/>/);
  });

  it('technician Layout.tsx no longer references the removed route', () => {
    const layoutSrc = fs.readFileSync(
      path.resolve(__dirname, '../../unified-app/src/technician/components/Layout.tsx'), 'utf-8'
    );
    expect(layoutSrc).not.toMatch(/\/technician\/messages/);
  });

  it('backend routes/messages.ts authorization is unchanged (not broadened to include TECHNICIAN)', () => {
    const routeSrc = fs.readFileSync(
      path.resolve(__dirname, '../../backend/src/routes/messages.ts'), 'utf-8'
    );
    expect(routeSrc).toMatch(/router\.get\('\/',\s*requireRole\('ADMIN',\s*'SCHEDULING'\)/);
    expect(routeSrc).not.toMatch(/requireRole\([^)]*'TECHNICIAN'[^)]*\)[\s\S]{0,20}router\.get\('\/'/);
  });
});

describe('Admin System Activity: completely unaffected by the Technician-only fix', () => {
  it('Admin Sidebar + System Activity page still fetch and render GET /messages correctly', async () => {
    // Sidebar's activity-feed query seeds an empty initialData placeholder and
    // deliberately never forces its own network fetch (by design, to avoid a
    // loading flicker) -- the real fetch happens when the actual System
    // Activity page mounts, exactly as in the existing
    // systemActivityCacheCollision.test.tsx pattern. Mounting only the
    // Sidebar in isolation would never call GET /messages, which is not a
    // regression, just this shared-cache design -- reusing the real
    // Sidebar-then-page mount order here to test the thing that's actually
    // supposed to change: Admin fetches successfully, unlike Technician.
    act(() => { useAppStore.setState({ adminAuth: null, serverUrl: 'http://localhost:9999' }); });
    const apiGet = vi.fn((url: string) => {
      if (url === '/messages') return Promise.resolve({ data: { success: true, data: [{ id: 'a1', createdAt: new Date().toISOString() }], meta: { total: 1 } } });
      return Promise.resolve({ data: { success: true, data: [] } });
    });
    vi.doMock('../../unified-app/src/admin/api/client', () => ({ api: { get: apiGet } }));
    const { default: AdminSidebar } = await import('../../unified-app/src/admin/components/Sidebar');
    const { default: AdminMessages } = await import('../../unified-app/src/admin/pages/Messages');
    mount(<AdminSidebar />);
    await flush();
    const el = mount(<AdminMessages />);
    await flush();

    expect(apiGet.mock.calls.some((c) => c[0] === '/messages')).toBe(true);
    expect(el.textContent).not.toMatch(/لا يوجد نشاط مسجل بعد|No activity/i);
  });

  it('Admin admin/pages/Messages.tsx (System Activity page) still exists and is untouched', () => {
    const adminMessagesPath = path.resolve(__dirname, '../../unified-app/src/admin/pages/Messages.tsx');
    expect(fs.existsSync(adminMessagesPath)).toBe(true);
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/App.tsx'), 'utf-8');
    expect(appSrc).toMatch(/<Route path="messages" element=\{<AdminMessages \/>\} \/>/);
  });

  it('Scheduling System Activity page/route is also untouched', () => {
    const schedMessagesPath = path.resolve(__dirname, '../../unified-app/src/scheduling/pages/Messages.tsx');
    expect(fs.existsSync(schedMessagesPath)).toBe(true);
    const appSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/App.tsx'), 'utf-8');
    expect(appSrc).toMatch(/<Route path="messages" element=\{<SchedMessages \/>\} \/>/);
  });
});
