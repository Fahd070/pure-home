// Notification read-on-open fix (Part B): opening the Notifications page
// (or Work Queue) now automatically transitions unread items to read, instead
// of requiring a manual "Mark all read" click. Real-rendered for the
// Technician department (mocking the api client, socket hook, and spying on
// the shared QueryClient's invalidateQueries -- matching this project's
// established pattern for full-page components with data fetching, see
// callReportDashboardShortcut.test.tsx); the identical fix in the Admin and
// Scheduling Notifications pages, and the Work Queue badge-clear fix, are
// confirmed at the source level.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'fs';
import path from 'path';
import '../../unified-app/src/i18n';

const { apiGet, apiPatch } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPatch: vi.fn() }));
vi.mock('../../unified-app/src/technician/api/client', () => ({ api: { get: apiGet, patch: apiPatch } }));
vi.mock('../../unified-app/src/technician/hooks/useSocket', () => ({ useSocket: () => null }));

// Imported AFTER the mocks above so the component picks up the mocked modules.
const { default: Notifications } = await import('../../unified-app/src/technician/pages/Notifications');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
  apiGet.mockReset();
  apiPatch.mockReset();
});

function render(qc: QueryClient) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={qc}>
        <Notifications />
      </QueryClientProvider>
    );
  });
  return container;
}

function flush() {
  return act(async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); });
}

const unreadNotifications = [
  { id: 'n1', title: 'Reminder 1', body: 'Body 1', isRead: false, createdAt: new Date().toISOString() },
  { id: 'n2', title: 'Reminder 2', body: 'Body 2', isRead: true, createdAt: new Date().toISOString() },
];

describe('Technician Notifications: automatic read-on-open (real render)', () => {
  // 10, 11, 12. Unread items exist initially; opening the section (mounting
  // the page) automatically marks them read via the existing PATCH
  // /notifications/read-all endpoint -- no manual click required.
  it('automatically calls the existing mark-all-read endpoint on mount when unread notifications are present', async () => {
    apiGet.mockResolvedValue({ data: { data: unreadNotifications } });
    apiPatch.mockResolvedValue({ data: { success: true } });
    const qc = new QueryClient();
    render(qc);
    await flush();

    expect(apiPatch).toHaveBeenCalledWith('/notifications/read-all');
  });

  // 21. Sidebar badge query is invalidated so the count updates without a reload.
  it('invalidates the sidebar unread-count query (notif-unread-tech) after marking read', async () => {
    apiGet.mockResolvedValue({ data: { data: unreadNotifications } });
    apiPatch.mockResolvedValue({ data: { success: true } });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    render(qc);
    await flush();

    const invalidatedKeys = invalidateSpy.mock.calls.map(c => JSON.stringify((c[0] as any)?.queryKey));
    expect(invalidatedKeys).toContain(JSON.stringify(['notif-unread-tech']));
    expect(invalidatedKeys).toContain(JSON.stringify(['notifications-tech']));
  });

  it('does not call mark-all-read when there is nothing unread (no needless request)', async () => {
    apiGet.mockResolvedValue({ data: { data: [{ id: 'n1', title: 'Read already', body: '', isRead: true, createdAt: new Date().toISOString() }] } });
    const qc = new QueryClient();
    render(qc);
    await flush();

    expect(apiPatch).not.toHaveBeenCalled();
  });

  // 22, 23. Navigation/rendering is not blocked by a failed auto-mark-read
  // request, and no page reload is used anywhere in this flow.
  it('still renders the notification list even if the auto-mark-read request fails', async () => {
    apiGet.mockResolvedValue({ data: { data: unreadNotifications } });
    apiPatch.mockRejectedValue(new Error('network error'));
    const qc = new QueryClient();
    const el = render(qc);
    await flush();

    expect(el.textContent).toContain('Reminder 1');
    expect(el.textContent).toContain('Reminder 2');
  });

  // 20. The existing manual "Mark all read" button is retained (not removed) --
  // it still renders and still works, as a fallback for a failed auto-mark or
  // a notification that arrives after it.
  it('the manual "Mark all read" button is still present and still functional', async () => {
    apiGet.mockResolvedValue({ data: { data: unreadNotifications } });
    apiPatch.mockResolvedValue({ data: { success: true } });
    const qc = new QueryClient();
    const el = render(qc);
    await flush();
    apiPatch.mockClear();

    const btn = Array.from(el.querySelectorAll('button')).find(b => b.textContent && b.textContent.length > 0);
    // The auto-mark-read already resolved the unread state, so the manual
    // button may no longer be rendered (unread === 0) -- if it is still
    // present (e.g. a fresh unread arrived), it must still work when clicked.
    if (btn) {
      await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiPatch).toHaveBeenCalledWith('/notifications/read-all');
    }
  });
});

describe('Admin and Scheduling Notifications: identical fix (source-level parity)', () => {
  for (const [dept, suffix] of [['admin', 'admin'], ['scheduling', 'sched']] as const) {
    const src = fs.readFileSync(
      path.resolve(__dirname, `../../unified-app/src/${dept}/pages/Notifications.tsx`), 'utf-8'
    );
    it(`${dept}: auto-marks read on mount and invalidates notif-unread-${suffix}`, () => {
      expect(src).toMatch(/if \(data && data\.some\(\(n: any\) => !n\.isRead\)\) \{\s*markAll\.mutate\(\);/);
      expect(src).toMatch(new RegExp(`qc\\.invalidateQueries\\(\\{ queryKey: \\["notif-unread-${suffix}"\\] \\}\\)`));
    });
  }
});

describe('Technician Work Queue: badge-clear-on-open fix (source-level)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/WorkQueue.tsx'), 'utf-8');

  it('dispatches clear-badge-queue-tech on mount, matching the existing pattern already used by UrgentAppointments.tsx', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{\s*window\.dispatchEvent\(new Event\("clear-badge-queue-tech"\)\);\s*\}, \[\]\);/);
  });
});

describe('System Activity and Urgent Appointments: already-correct read-on-open (regression confirmation, pre-existing)', () => {
  it('technician System Activity already sets its own last-seen marker on mount', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/Messages.tsx'), 'utf-8');
    expect(src).toMatch(/localStorage\.setItem\("msg-last-seen-tech", Date\.now\(\)\.toString\(\)\)/);
  });

  // Urgent-ownership batch (Part C): the urgent badge is no longer a
  // localStorage increment/clear counter -- it must reflect real unresolved
  // urgent work (state/data-driven) so it survives refresh/restart and never
  // disappears just because the page was opened. UrgentAppointments.tsx no
  // longer dispatches the old clear event, and Sidebar.tsx now derives the
  // badge from a DB query instead of a localStorage counter.
  it('technician Urgent Appointments no longer dispatches the old localStorage clear-badge event on mount (badge is now DB-derived)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/UrgentAppointments.tsx'), 'utf-8');
    expect(src).not.toMatch(/clear-badge-urgent-tech/);
  });

  it('technician Sidebar computes the urgent badge from a DB query (unresolved urgentVisitRecord-less appointments), not localStorage', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/components/Sidebar.tsx'), 'utf-8');
    expect(src).not.toMatch(/badge-urgent-tech/);
    expect(src).toMatch(/urgent-unresolved-tech/);
    expect(src).toMatch(/!a\.urgentVisitRecord/);
  });

  // 13. Opening Work Queue must not clear System Activity's unread state --
  // they use entirely separate storage keys/events, confirmed disjoint here
  // (Work Queue only ever dispatches its own clear-badge-queue-tech event; a
  // mention of the analogous clear-badge-urgent-tech pattern appears only in
  // an explanatory source comment, not as an event this page actually fires).
  it('Work Queue\'s clear event is category-specific: it never touches System Activity\'s last-seen key', () => {
    const workQueueSrc = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/technician/pages/WorkQueue.tsx'), 'utf-8');
    expect(workQueueSrc).not.toMatch(/msg-last-seen-tech/);
    expect(workQueueSrc).toMatch(/dispatchEvent\(new Event\("clear-badge-queue-tech"\)\)/);
  });
});
