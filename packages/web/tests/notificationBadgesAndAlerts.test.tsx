/**
 * PHASE 2 frontend: navigation badges, the centred critical alert queue, and
 * the technician urgent banner.
 *
 * The properties under test are the ones that make these surfaces trustworthy:
 * a badge that counts correctly and says what it counts, an alert that appears
 * exactly while the SERVER considers it unread, and -- most important -- an
 * alert that never silently disappears when acknowledging it failed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../unified-app/src/i18n';
import i18n from '../../unified-app/src/i18n';
import { waitFor } from './helpers/waitForCondition';
import fs from 'fs';
import path from 'path';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { CountBadge } from '../../unified-app/src/ui/Badge';
import { resolveNotificationText } from '../../unified-app/src/utils/notificationText';
import CriticalAlerts, { notificationRoute } from '../../unified-app/src/components/CriticalAlerts';
import UrgentTechnicianBanner from '../../unified-app/src/components/UrgentTechnicianBanner';

// ---------------------------------------------------------------- harness
let container: HTMLDivElement | null = null;
let root: Root | null = null;
let qc: QueryClient;

function makeNotification(over: Partial<any> = {}) {
  return {
    id: 'n1',
    // Plain Arabic in title/body -- exactly what a v3.6.5 client renders --
    // with English beside it in the additive columns.
    title: 'زيارة عاجلة مسندة إليك',
    body: 'العميل أحمد — بتاريخ 01/10/2026',
    titleEn: 'Urgent visit assigned to you',
    bodyEn: 'Customer Ahmed — on 01/10/2026',
    type: 'URGENT_APPOINTMENT_ASSIGNED',
    severity: 'CRITICAL',
    entityType: 'appointment',
    entityId: 'appt-1',
    isRead: false,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** A minimal axios-shaped stub: only `get` and `patch` are ever used. */
function makeApi(rows: any[], opts: { patchFails?: boolean } = {}) {
  const patch = vi.fn(() =>
    opts.patchFails
      ? Promise.reject(new Error('network'))
      : Promise.resolve({ data: { success: true, data: { isRead: true } } })
  );
  const get = vi.fn((url: string) => {
    if (url === '/notifications') return Promise.resolve({ data: { success: true, data: rows } });
    if (url === '/notifications/unread-count') {
      return Promise.resolve({ data: { success: true, data: { total: rows.length, byType: {} } } });
    }
    return Promise.resolve({ data: { success: true, data: [] } });
  });
  return { get, patch } as any;
}

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

beforeEach(async () => {
  navigateSpy.mockClear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { await i18n.changeLanguage('en'); });
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

/** The dialog renders into the same container tree; find it by role. */
const dialog = () => document.querySelector('[role="dialog"]');
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === text);

// ============================================================ BADGE COUNTS
describe('CountBadge counting rules', () => {
  it('renders nothing at all for 0 -- no empty circle, no layout shift', () => {
    const el = mount(<CountBadge value={0} />);
    expect(el.textContent).toBe('');
    expect(el.querySelector('span')).toBeNull();
  });

  it.each([
    [1, '1'],
    [9, '9'],
    [24, '24'],
    [99, '99'],
  ])('renders %i exactly as "%s"', (value, expected) => {
    const el = mount(<CountBadge value={value} />);
    expect(el.textContent).toBe(expected);
  });

  it.each([
    [100, '99+'],
    [250, '99+'],
  ])('clamps %i to "%s" so the nav item cannot widen', (value, expected) => {
    const el = mount(<CountBadge value={value} />);
    expect(el.textContent).toBe(expected);
  });

  it('exposes an accessible name carrying the REAL count, not the clamped glyph', () => {
    const el = mount(<CountBadge value={250} label="250 unread notifications" />);
    const badge = el.querySelector('[role="img"]')!;
    expect(badge.getAttribute('aria-label')).toBe('250 unread notifications');
    // The meaning must not be conveyed by colour alone.
    expect(badge.getAttribute('aria-label')).toContain('unread');
    // NOT a live region: several badges refresh on a poll, and role="status"
    // would announce unrelated counts to a screen-reader user repeatedly.
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('is positioned by flex order, so it needs no RTL mirroring', () => {
    // No directional left/right/ms-/me- offset classes: placement comes from
    // the parent's flex order, which mirrors automatically under dir="rtl".
    const el = mount(<CountBadge value={5} />);
    const cls = el.querySelector('span')!.className;
    expect(cls).not.toMatch(/\b(left-|right-|ml-|mr-)/);
  });
});

// ====================================================== BILINGUAL RENDERING
describe('resolveNotificationText', () => {
  const row = {
    title: 'زيارة عاجلة', body: 'نص عربي',
    titleEn: 'Urgent visit', bodyEn: 'English body',
  };

  it('an Arabic reader gets the default-language title/body columns', () => {
    expect(resolveNotificationText(row, 'title', 'ar')).toBe('زيارة عاجلة');
    expect(resolveNotificationText(row, 'body', 'ar')).toBe('نص عربي');
  });

  it('an English reader gets the titleEn/bodyEn columns', () => {
    expect(resolveNotificationText(row, 'title', 'en')).toBe('Urgent visit');
    expect(resolveNotificationText(row, 'body', 'en')).toBe('English body');
  });

  it('a legacy row with NULL English columns falls back to Arabic rather than rendering blank', () => {
    const legacy = { title: 'تذكير قديم', body: 'نص قديم', titleEn: null, bodyEn: null };
    expect(resolveNotificationText(legacy, 'title', 'en')).toBe('تذكير قديم');
    expect(resolveNotificationText(legacy, 'body', 'en')).toBe('نص قديم');
    expect(resolveNotificationText(legacy, 'title', 'ar')).toBe('تذكير قديم');
  });

  it('treats an empty English string the same as a missing one', () => {
    const partial = { title: 'عنوان', body: 'نص', titleEn: '', bodyEn: '' };
    expect(resolveNotificationText(partial, 'title', 'en')).toBe('عنوان');
  });

  it('never parses its input -- a body that looks like JSON is shown verbatim', () => {
    // Guards the removed codec: title/body are plain text and must be rendered
    // as-is, never decoded.
    const odd = { title: '{"ar":"x"}', body: 'b', titleEn: null, bodyEn: null };
    expect(resolveNotificationText(odd, 'title', 'ar')).toBe('{"ar":"x"}');
    expect(resolveNotificationText(odd, 'title', 'en')).toBe('{"ar":"x"}');
  });

  it('handles a missing notification without throwing', () => {
    expect(resolveNotificationText(null, 'title', 'en')).toBe('');
    expect(resolveNotificationText(undefined, 'body', 'ar')).toBe('');
  });
});

// ================================================= ROUTING (BOLA-SAFE HINT)
describe('notificationRoute', () => {
  it('sends a technician to the urgent screen for an urgent assignment', () => {
    expect(notificationRoute('tech', makeNotification())).toBe('/technician/urgent-appointments');
  });

  it('sends a technician to their own work item for other appointment alerts', () => {
    expect(notificationRoute('tech', makeNotification({ type: 'APPOINTMENT_POSTPONED', entityId: 'a9' })))
      .toBe('/technician/queue/a9');
  });

  it('uses only existing Administration and Scheduling routes', () => {
    expect(notificationRoute('admin', makeNotification())).toBe('/admin/appointments');
    expect(notificationRoute('sched', makeNotification())).toBe('/scheduling/dashboard');
  });
});

// ========================================================= CRITICAL ALERTS
describe('Critical alert queue', () => {
  it('surfaces an unread critical notification on arrival', async () => {
    const api = makeApi([makeNotification()]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog(), { message: 'critical dialog never appeared' });

    expect(dialog()!.textContent).toContain('Urgent visit assigned to you');
    // Fetched with the server-side filter, not by filtering 50 rows locally.
    const call = api.get.mock.calls.find((c: any[]) => c[0] === '/notifications');
    expect(call[1].params).toEqual({ unread: 'true', severity: 'CRITICAL' });
  });

  it('does NOT surface a notification the server reports as read', async () => {
    const api = makeApi([makeNotification({ isRead: true })]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(dialog()).toBeNull();
  });

  it('shows ONE dialog at a time even with several unread criticals', async () => {
    const api = makeApi([
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2' }),
      makeNotification({ id: 'n3' }),
    ]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    // ...and it says how many are still queued behind it.
    expect(dialog()!.textContent).toContain('2 more');
  });

  it('advances to the next unread alert after acknowledging one', async () => {
    const api = makeApi([makeNotification({ id: 'n1' }), makeNotification({ id: 'n2' })]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());
    expect(dialog()!.textContent).toContain('1 more');

    await act(async () => { buttonByText('Acknowledge')!.click(); });
    await waitFor(() => !(dialog()!.textContent || '').includes('1 more'), {
      message: 'queue never advanced to the second alert',
    });

    expect(api.patch).toHaveBeenCalledWith('/notifications/n1/read');
    // Still exactly one dialog -- the second one, not two stacked.
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
  });

  it('does not reopen an acknowledged alert when the query refetches with stale data', async () => {
    // The server list still reports n1 as unread (the refetch raced the write).
    const api = makeApi([makeNotification({ id: 'n1' })]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    await act(async () => { buttonByText('Acknowledge')!.click(); });
    await waitFor(() => dialog() === null, { message: 'alert did not close after acknowledgement' });

    // Force exactly the refetch that used to resurrect it.
    await act(async () => { await qc.refetchQueries({ queryKey: ['notif-critical-tech'] }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(dialog()).toBeNull();
  });

  it('marks read AND routes when "View appointment" is used', async () => {
    const api = makeApi([makeNotification({ id: 'n7', entityId: 'appt-7' })]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    await act(async () => { buttonByText('View appointment')!.click(); });
    await waitFor(() => navigateSpy.mock.calls.length > 0, { message: 'never navigated' });

    expect(api.patch).toHaveBeenCalledWith('/notifications/n7/read');
    expect(navigateSpy).toHaveBeenCalledWith('/technician/urgent-appointments');
  });

  it('a FAILED acknowledgement keeps the alert on screen and reports the error', async () => {
    const api = makeApi([makeNotification({ id: 'n1' })], { patchFails: true });
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    await act(async () => { buttonByText('Acknowledge')!.click(); });
    await waitFor(() => !!document.querySelector('[role="alert"]'), {
      message: 'no visible error after a failed acknowledgement',
    });

    // The critical point: it did NOT pretend to succeed.
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('still unread');
  });

  it('a failure notice does not follow the queue onto the next alert', async () => {
    const api = makeApi([makeNotification({ id: 'n1' }), makeNotification({ id: 'n2' })], { patchFails: true });
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    // Acknowledge fails -> the notice appears for THIS alert.
    await act(async () => { buttonByText('Acknowledge')!.click(); });
    await waitFor(() => !!document.querySelector('[role="alert"]'));
    expect(dialog()!.textContent).toContain('still unread');

    // Dismiss with Later -> the next alert must not inherit that error.
    await act(async () => { buttonByText('Later')!.click(); });
    await waitFor(() => !(dialog()?.textContent || '').includes('1 more'), {
      message: 'queue never advanced',
    });
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).not.toContain('still unread');
  });

  it('closing without acknowledging leaves it unread (it returns on reload)', async () => {
    const api = makeApi([makeNotification({ id: 'n1' })]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());

    await act(async () => { buttonByText('Later')!.click(); });
    await waitFor(() => dialog() === null);
    // Dismissing is not acknowledging: nothing was written to the server, so
    // the badge keeps counting it and a fresh session shows it again.
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('renders the alert in the reader\'s language', async () => {
    await act(async () => { await i18n.changeLanguage('ar'); });
    const api = makeApi([makeNotification()]);
    mount(<CriticalAlerts api={api} scope="tech" getSocket={() => null} />);
    await waitFor(() => !!dialog());
    expect(dialog()!.textContent).toContain('زيارة عاجلة مسندة إليك');
    expect(dialog()!.textContent).not.toContain('Urgent visit assigned to you');
    // ...and the English reader sees the English columns (proved above in
    // resolveNotificationText, exercised end-to-end by the other alert tests).
  });
});

// ==================================================== TECHNICIAN URGENT BANNER
describe('Technician urgent banner', () => {
  it('appears for an unread assigned urgent appointment', async () => {
    const api = makeApi([makeNotification()]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await waitFor(() => !!el.querySelector('[role="alert"]'), { message: 'banner never appeared' });
    expect(el.textContent).toContain('Urgent visit assigned to you');
  });

  it('does not appear when there is no unread urgent notification', async () => {
    const api = makeApi([]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores critical notifications that are not urgent assignments', async () => {
    // A postponement alert is CRITICAL, but it is not urgent work assigned to
    // this technician -- the red banner is specifically for the latter.
    const api = makeApi([makeNotification({ type: 'APPOINTMENT_POSTPONED' })]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows ONE banner plus a "+N more" count, never a vertical stack', async () => {
    const api = makeApi([
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2' }),
      makeNotification({ id: 'n3' }),
    ]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await waitFor(() => !!el.querySelector('[role="alert"]'));

    expect(el.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(el.textContent).toContain('+2 more');
  });

  it('acknowledges and routes when its View action is used', async () => {
    const api = makeApi([makeNotification({ id: 'nb' })]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await waitFor(() => !!el.querySelector('[role="alert"]'));

    await act(async () => { (el.querySelector('button') as HTMLButtonElement).click(); });
    await waitFor(() => navigateSpy.mock.calls.length > 0, { message: 'banner never navigated' });

    expect(api.patch).toHaveBeenCalledWith('/notifications/nb/read');
    expect(navigateSpy).toHaveBeenCalledWith('/technician/urgent-appointments');
  });

  it('sits in normal flow and cannot overlay the navigation or overflow sideways', async () => {
    const api = makeApi([makeNotification()]);
    const el = mount(<UrgentTechnicianBanner api={api} />);
    await waitFor(() => !!el.querySelector('[role="alert"]'));

    const banner = el.querySelector('[role="alert"]')! as HTMLElement;
    // Not fixed/absolute -- so it can never cover the menu button or the rail.
    expect(banner.className).not.toMatch(/\b(fixed|absolute)\b/);
    // Long text truncates rather than forcing the page wider.
    expect(banner.querySelector('.truncate')).not.toBeNull();
  });
});

// ============================================ SHELL PLACEMENT (SOURCE GUARD)
describe('shell placement of the critical alert', () => {
  const read = (p: string) =>
    fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', p), 'utf8');

  it.each([
    ['admin/components/Layout.tsx'],
    ['scheduling/components/Layout.tsx'],
    ['technician/components/Layout.tsx'],
  ])('%s mounts CriticalAlerts in the overlays slot, not inside the routed content', (file) => {
    const src = read(file);
    // Must go through AppFrame's `overlays` prop. Rendering it as a child would
    // place it inside PageTransition, whose enter animation holds a non-none
    // transform -- which becomes the containing block for the dialog's
    // `position: fixed`, pushing a "centred" alert off-centre on every route
    // change. This guard is cheap; that bug is invisible in jsdom.
    expect(src).toMatch(/overlays=\{<CriticalAlerts/);
  });

  it('AppFrame renders overlays outside <main>', () => {
    const src = read('ui/AppFrame.tsx');
    const mainEnd = src.indexOf('</main>');
    const overlaysAt = src.indexOf('{overlays}');
    expect(mainEnd).toBeGreaterThan(-1);
    expect(overlaysAt).toBeGreaterThan(mainEnd);
  });
});

// ============================= URGENT TECHNICIAN ASSIGNMENT (SOURCE GUARD)
describe('urgent-appointment technician assignment control', () => {
  const src = () =>
    fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/admin/pages/UrgentAppointments.tsx'), 'utf8');

  it('offers an explicit unassigned option, so shared-pool urgent work stays supported', () => {
    expect(src()).toMatch(/<option value="">\{t\("alerts\.unassigned"\)\}<\/option>/);
  });

  it('lists only ACTIVE technicians', () => {
    expect(src()).toMatch(/\.filter\(techRow => techRow\.isActive\)/);
  });

  it('reads the roster from the shared employees hook, which excludes the legacy shared account', () => {
    // useTechnicianEmployees -> GET /employees/technicians -> listTechnicianEmployees(),
    // whose where-clause is individualTechnicianWhere() (NOT the shared bridge account).
    expect(src()).toContain('useTechnicianEmployees');
    expect(src()).not.toMatch(/api\.get\(["'`]\/users/);
  });

  it('sends technicianId only when one was chosen', () => {
    expect(src()).toMatch(/technicianId: form\.technicianId \|\| undefined/);
  });
});

// ================================ SHARED SOCKET LISTENER (REGRESSION GUARD)
describe('notification socket listeners are removed by reference', () => {
  const pages = [
    'technician/pages/Notifications.tsx',
    'admin/pages/Notifications.tsx',
    'scheduling/pages/Notifications.tsx',
  ];

  it.each(pages)('%s does not blanket-remove notification:new listeners', (file) => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', file), 'utf8');
    // `socket.off("notification:new")` with no handler removes EVERY listener
    // for that event. The socket is a module-level singleton shared with the
    // application shell, so the blanket form silently tore off CriticalAlerts'
    // listener when this page unmounted -- downgrading every critical alert and
    // nav badge for the rest of the session to polling, with no re-attach.
    expect(src).not.toMatch(/\.off\(\s*["']notification:new["']\s*\)/);
    expect(src).toMatch(/\.off\(\s*["']notification:new["']\s*,\s*\w+\s*\)/);
  });

  it('the shared realtime hook also detaches by reference', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../unified-app/src/hooks/useNotifications.ts'), 'utf8');
    expect(src).not.toMatch(/\.off\(\s*["']notification:(new|read)["']\s*\)/);
    expect(src).toMatch(/\.off\("notification:new", refresh\)/);
  });
});
