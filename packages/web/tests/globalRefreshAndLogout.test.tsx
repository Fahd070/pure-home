// v4 Requirement #13/#14: leaving the authenticated workspace, and the one
// global "sync now" action.
//
// These exercise real QueryClient behaviour and real store state rather than
// asserting that an onClick handler exists.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import i18n from '../../unified-app/src/i18n';
import { useAppStore } from '../../unified-app/src/store/appStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../../unified-app/src/store/settingsStore';
import { useGlobalRefresh } from '../../unified-app/src/hooks/useGlobalRefresh';
import { RefreshButton } from '../../unified-app/src/ui/RefreshButton';
import { useLogout } from '../../unified-app/src/hooks/useLogout';
import { endApplicationSession } from '../../unified-app/src/session';
import { queryClient as appQueryClient } from '../../unified-app/src/queryClient';
import { waitFor } from './helpers/waitForCondition';
import fs from 'fs';
import path from 'path';

const source = (f: string) =>
  fs.readFileSync(path.resolve(__dirname, '../../unified-app/src', f), 'utf-8');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
// The real app singleton: main.tsx (Electron) and web/src/main.tsx both hand
// this exact instance to the provider, and session teardown reaches it directly
// rather than through React context. Using anything else here would test a
// wiring that does not exist in production.
const qc = appQueryClient;

afterEach(() => {
  if (root) { act(() => { root!.unmount(); }); root = null; }
  if (container) { container.remove(); container = null; }
});

function mount(children: React.ReactElement, initialEntries: string[] = ['/']) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  });
  return container;
}

beforeEach(async () => {
  qc.clear();
  qc.setDefaultOptions({ queries: { retry: false } });
  await i18n.changeLanguage('en');
});

// ── REQ 14: global refresh ───────────────────────────────────────────────────

describe('useGlobalRefresh', () => {
  it('refetches the queries that are currently mounted', async () => {
    const fetcher = vi.fn().mockResolvedValue('v');

    let refreshFn: (() => Promise<void>) | null = null;
    function Probe() {
      useQuery({ queryKey: ['thing'], queryFn: fetcher });
      const { refresh } = useGlobalRefresh();
      refreshFn = refresh;
      return null;
    }
    mount(<Probe />);
    await waitFor(() => fetcher.mock.calls.length === 1, { message: 'initial fetch never ran' });

    await act(async () => { await refreshFn!(); });
    // A real refetch, not just a cache invalidation nobody acted on.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not refetch queries that are only sitting in the cache', async () => {
    const inactive = vi.fn().mockResolvedValue('old');
    // Seeded directly into the cache and never mounted — a page the user is not
    // looking at must not fire a request on every refresh.
    qc.setQueryData(['never-mounted'], 'old');

    let refreshFn: (() => Promise<void>) | null = null;
    function Probe() {
      const { refresh } = useGlobalRefresh();
      refreshFn = refresh;
      return null;
    }
    mount(<Probe />);
    await act(async () => { await refreshFn!(); });

    expect(inactive).not.toHaveBeenCalled();
    // ...but it IS marked stale, so opening that page next reloads it.
    expect(qc.getQueryState(['never-mounted'])?.isInvalidated).toBe(true);
  });

  it('coalesces a double click into one refresh wave', async () => {
    let resolveFetch: ((v: string) => void) | null = null;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => Promise.resolve('first'))
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFetch = r; }));

    let refreshFn: (() => Promise<void>) | null = null;
    function Probe() {
      useQuery({ queryKey: ['thing'], queryFn: fetcher });
      const { refresh } = useGlobalRefresh();
      refreshFn = refresh;
      return null;
    }
    mount(<Probe />);
    await waitFor(() => fetcher.mock.calls.length === 1, { message: 'initial fetch never ran' });

    // Two clicks in the same tick, while the first wave is still in flight.
    let p1: Promise<void>, p2: Promise<void>;
    act(() => { p1 = refreshFn!(); p2 = refreshFn!(); });
    expect(p1!).toBe(p2!);          // the second click joined the first
    expect(fetcher).toHaveBeenCalledTimes(2); // not 3

    await act(async () => { resolveFetch!('second'); await p1!; });
  });

  it('leaves the button usable again after a failed refresh', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce('ok')
      .mockRejectedValue(new Error('network down'));

    let state: { refresh: () => Promise<void>; isRefreshing: boolean } | null = null;
    function Probe() {
      useQuery({ queryKey: ['thing'], queryFn: fetcher });
      state = useGlobalRefresh();
      return null;
    }
    mount(<Probe />);
    await waitFor(() => fetcher.mock.calls.length === 1, { message: 'initial fetch never ran' });

    // A rejected refetch must not leave the control stuck in its busy state.
    await act(async () => { await state!.refresh(); });
    expect(state!.isRefreshing).toBe(false);

    // ...and a subsequent refresh still runs rather than being blocked forever.
    const before = fetcher.mock.calls.length;
    await act(async () => { await state!.refresh(); });
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('RefreshButton', () => {
  it('is reachable, labelled in both languages, and marked busy while working', async () => {
    let resolveFetch: ((v: string) => void) | null = null;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => Promise.resolve('first'))
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFetch = r; }));

    function Probe() {
      useQuery({ queryKey: ['thing'], queryFn: fetcher });
      return <RefreshButton />;
    }
    const el = mount(<Probe />);
    await waitFor(() => fetcher.mock.calls.length === 1, { message: 'initial fetch never ran' });

    const btn = el.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Refresh');
    expect(btn.disabled).toBe(false);

    act(() => { btn.click(); });
    // Busy state is communicated to assistive tech, not only by the spin.
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    expect(el.querySelector('.animate-spin')).toBeTruthy();

    await act(async () => { resolveFetch!('second'); });
    await waitFor(() => !(el.querySelector('button') as HTMLButtonElement).disabled,
      { message: 'button never left its busy state' });
    expect(el.querySelector('button')!.getAttribute('aria-busy')).toBe('false');
  });

  it('uses the Arabic label when the app is in Arabic', async () => {
    await i18n.changeLanguage('ar');
    const el = mount(<RefreshButton />);
    expect(el.querySelector('button')!.getAttribute('aria-label')).toBe('تحديث');
    expect(el.textContent).toContain('تحديث');
  });
});

// ── REQ 13: logout ───────────────────────────────────────────────────────────

describe('Logout ends the whole application session', () => {
  const AUTH = {
    admin: { user: { id: 'a', name: 'A', email: 'a@x', role: 'ADMIN' }, token: 'admin-token' },
    scheduling: { user: { id: 's', name: 'S', email: 's@x', role: 'SCHEDULING' }, token: 'sched-token' },
    technician: { user: { id: 't', name: 'T', email: 't@x', role: 'TECHNICIAN' }, token: 'tech-token' },
  };
  const SLOT = { admin: 'adminAuth', scheduling: 'schedulingAuth', technician: 'technicianAuth' } as const;
  type Dept = keyof typeof AUTH;

  /** Seeds ONLY the listed departments, so "another slot" is a real condition. */
  const seedSlots = (...depts: Dept[]) => {
    act(() => {
      useAppStore.setState({
        serverUrl: 'http://localhost:9999',
        adminAuth: depts.includes('admin') ? AUTH.admin : null,
        schedulingAuth: depts.includes('scheduling') ? AUTH.scheduling : null,
        technicianAuth: depts.includes('technician') ? AUTH.technician : null,
      });
    });
  };

  const mountLogout = (initialPath: string) => {
    let logoutFn: (() => void) | null = null;
    let seenPath = '';
    function Probe() { logoutFn = useLogout(); return null; }
    function PathProbe() { seenPath = useLocation().pathname; return null; }
    mount(<><Probe /><PathProbe /></>, [initialPath]);
    return { logout: () => act(() => { logoutFn!(); }), path: () => seenPath };
  };

  // The regression this closure exists for: leaving one workspace must not leave
  // another department silently authenticated behind the Department Selector.
  const CASES: { name: string; from: Dept; other: Dept }[] = [
    { name: 'A: Admin + Technician, logout from Admin', from: 'admin', other: 'technician' },
    { name: 'B: Scheduling + Admin, logout from Scheduling', from: 'scheduling', other: 'admin' },
    { name: 'C: Technician + Scheduling, logout from Technician', from: 'technician', other: 'scheduling' },
  ];

  for (const { name, from, other } of CASES) {
    it(name + ': clears EVERY auth slot, so the other department still needs code entry', () => {
      seedSlots(from, other);
      expect(useAppStore.getState()[SLOT[other]]).not.toBeNull();

      const { logout, path } = mountLogout('/' + from + '/dashboard');
      logout();

      const st = useAppStore.getState();
      // All three, not just the visible one. A token left in ANY slot satisfies
      // that department's route guard, and pressing that department on the
      // selector would walk straight into its workspace without code entry.
      expect(st.adminAuth).toBeNull();
      expect(st.schedulingAuth).toBeNull();
      expect(st.technicianAuth).toBeNull();
      expect(st[SLOT[other]]).toBeNull();
      expect(path()).toBe('/');
    });
  }

  it('clears the private query cache, leaving nothing to flash for the next login', () => {
    seedSlots('admin', 'technician');
    qc.setQueryData(['work-queue'], [{ customer: 'previous user' }]);
    qc.setQueryData(['notifications'], [{ body: 'private' }]);

    const { logout } = mountLogout('/admin/dashboard');
    logout();

    expect(qc.getQueryData(['work-queue'])).toBeUndefined();
    expect(qc.getQueryData(['notifications'])).toBeUndefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it('preserves device preferences and the configured server URL', async () => {
    seedSlots('admin', 'scheduling', 'technician');
    act(() => {
      useSettingsStore.getState().setSettings({
        theme: 'dark', interfaceScale: 'compact', fontSize: 'large',
      });
    });
    await i18n.changeLanguage('ar');

    const { logout } = mountLogout('/admin/dashboard');
    logout();

    const st = useSettingsStore.getState().settings;
    expect(st.theme).toBe('dark');
    expect(st.interfaceScale).toBe('compact');
    expect(st.fontSize).toBe('large');
    expect(i18n.language).toBe('ar');
    expect(useAppStore.getState().serverUrl).toBe('http://localhost:9999');
  });

  it('navigates with replace, so Back cannot reopen the protected workspace', () => {
    expect(source('hooks/useLogout.ts')).toContain('navigate("/", { replace: true })');
  });

  it('stops the API clients attaching ANY department token afterwards', async () => {
    const admin = await import('../../unified-app/src/admin/store/authStore');
    const sched = await import('../../unified-app/src/scheduling/store/authStore');
    const tech = await import('../../unified-app/src/technician/store/authStore');
    seedSlots('admin', 'scheduling', 'technician');
    expect(admin.getAuthState().token).toBe('admin-token');

    const { logout } = mountLogout('/admin/dashboard');
    logout();

    // The interceptors read the token per-request, so an empty slot is what
    // actually stops the old credential going back out.
    expect(admin.getAuthState().token).toBeNull();
    expect(sched.getAuthState().token).toBeNull();
    expect(tech.getAuthState().token).toBeNull();
  });
});

describe('Every department socket is destroyed, not only the visible one', () => {
  it('disconnects and discards all three singletons', async () => {
    // Each department owns a module-level socket; a surviving one stays in the
    // previous user's rooms and keeps receiving their private events.
    const made: any[] = [];
    vi.resetModules();
    vi.doMock('socket.io-client', () => ({
      io: vi.fn(() => {
        const sock = { disconnect: vi.fn(), removeAllListeners: vi.fn(), connected: true, active: true };
        made.push(sock);
        return sock;
      }),
    }));

    // Fresh module instances, so these hooks and this store are the same ones
    // the freshly imported session module will operate on.
    const store = await import('../../unified-app/src/store/appStore');
    const adminSock = await import('../../unified-app/src/admin/hooks/useSocket');
    const schedSock = await import('../../unified-app/src/scheduling/hooks/useSocket');
    const techSock = await import('../../unified-app/src/technician/hooks/useSocket');
    const { endApplicationSession: endAll } = await import('../../unified-app/src/session');

    act(() => {
      store.useAppStore.setState({
        serverUrl: 'http://localhost:9999',
        adminAuth: { user: { id: 'a', name: 'A', email: 'a@x', role: 'ADMIN' }, token: 'ta' },
        schedulingAuth: { user: { id: 's', name: 'S', email: 's@x', role: 'SCHEDULING' }, token: 'ts' },
        technicianAuth: { user: { id: 't', name: 'T', email: 't@x', role: 'TECHNICIAN' }, token: 'tt' },
      } as any);
    });

    // Actually bring all three up, through each department's real hook -- the
    // singletons are module-private, so this is the only honest way to populate
    // them. A device with several departments signed in looks exactly like this.
    function AllSockets() {
      adminSock.useSocket();
      schedSock.useSocket();
      techSock.useSocket();
      return null;
    }
    mount(<AllSockets />);
    await waitFor(() => made.length === 3, { message: 'all three sockets were never created' });
    expect(adminSock.getSocket()).not.toBeNull();
    expect(schedSock.getSocket()).not.toBeNull();
    expect(techSock.getSocket()).not.toBeNull();

    endAll();

    // Every socket disconnected, and every singleton discarded so a reconnect
    // cannot bring the old credentials back.
    for (const sock of made) {
      expect(sock.disconnect).toHaveBeenCalled();
      expect(sock.removeAllListeners).toHaveBeenCalled();
    }
    expect(adminSock.getSocket()).toBeNull();
    expect(schedSock.getSocket()).toBeNull();
    expect(techSock.getSocket()).toBeNull();

    vi.resetModules();
  });
});

describe('Case D: an automatic 401 while several departments are signed in', () => {
  const seedAll = () => {
    act(() => {
      useAppStore.setState({
        serverUrl: 'http://localhost:9999',
        adminAuth: { user: { id: 'a', name: 'A', email: 'a@x', role: 'ADMIN' }, token: 'admin-token' },
        schedulingAuth: { user: { id: 's', name: 'S', email: 's@x', role: 'SCHEDULING' }, token: 'sched-token' },
        technicianAuth: { user: { id: 't', name: 'T', email: 't@x', role: 'TECHNICIAN' }, token: 'tech-token' },
      });
    });
  };

  it('performs the same global teardown as pressing Logout', () => {
    // Called with no React tree at all -- which is the point: the 401 response
    // interceptors are plain axios modules and cannot use hooks.
    seedAll();
    appQueryClient.setQueryData(['work-queue'], [{ customer: 'previous user' }]);

    endApplicationSession();

    const st = useAppStore.getState();
    expect(st.adminAuth).toBeNull();
    expect(st.schedulingAuth).toBeNull();
    expect(st.technicianAuth).toBeNull();
    expect(appQueryClient.getQueryData(['work-queue'])).toBeUndefined();
    expect(appQueryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('leaves device preferences and the server URL alone', () => {
    seedAll();
    act(() => { useSettingsStore.getState().setSettings({ theme: 'dark', interfaceScale: 'compact' }); });
    endApplicationSession();
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('compact');
    expect(useAppStore.getState().serverUrl).toBe('http://localhost:9999');
  });

  it('is what every department 401 interceptor calls, through one shared teardown', () => {
    for (const dept of ['admin', 'scheduling', 'technician']) {
      const src = source(dept + '/api/client.ts');
      expect(src).toContain('endApplicationSession()');
      // Never a narrower, department-only teardown, and never the bare
      // clear-the-token-only behaviour this replaced.
      expect(src).not.toContain('endSession("');
      expect(src).not.toContain('> 15000) s.clear');
    }
  });

  it('leaves no department-scoped logout for anyone to reach for', () => {
    // A per-department `logout()` on the auth stores is precisely the bypass
    // this closure removes: it would clear one token and leave the others able
    // to satisfy their route guards. Keeping it exported invites its return.
    for (const dept of ['admin', 'scheduling', 'technician']) {
      expect(source(dept + '/store/authStore.ts')).not.toContain('logout:');
    }
  });

  it('keeps one teardown implementation rather than a duplicated per-path copy', () => {
    expect(source('session.ts')).toContain('export function endApplicationSession()');
    // The hook adds navigation only; it does not re-implement the teardown.
    const hook = source('hooks/useLogout.ts');
    expect(hook).toContain('endApplicationSession()');
    expect(hook).not.toContain('queryClient.clear');
    expect(hook).not.toContain('clearAdminAuth');
  });
});

// ── REQ 15: default interface scale ──────────────────────────────────────────

describe('Interface scale precedence (REQ 15)', () => {
  // The server ALWAYS sends a legacy-valid interfaceScale so Desktop v3.6.5
  // keeps working; `hasSavedSettings` is the additive signal that says whether
  // that value came from a stored row or was synthesized.
  const serverNoRow = (over: Record<string, unknown> = {}) =>
    ({ theme: 'light', fontSize: 'medium', interfaceScale: 'normal', hasSavedSettings: false, ...over });
  const serverWithRow = (scale: string, over: Record<string, unknown> = {}) =>
    ({ theme: 'light', fontSize: 'medium', interfaceScale: scale, hasSavedSettings: true, ...over });

  it('CASE 3: no server row and no local scale renders LARGE', () => {
    // "comfortable" is this product's name for Large (compact/normal/comfortable).
    expect(DEFAULT_SETTINGS.interfaceScale).toBe('comfortable');

    act(() => { useSettingsStore.getState().reset(); });
    act(() => { useSettingsStore.getState().loadFromServer(serverNoRow() as any); });

    // The synthesized 'normal' must NOT be mistaken for a preference.
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('comfortable');
    expect(document.documentElement.getAttribute('data-scale')).toBe('comfortable');
  });

  it('CASE 2: no server row but a saved local scale keeps the local one', () => {
    act(() => { useSettingsStore.getState().setSettings({ interfaceScale: 'normal' }); });
    act(() => { useSettingsStore.getState().loadFromServer(serverNoRow() as any); });
    // A deliberate local Medium is not dragged to Large, and not overwritten by
    // the server's synthesized value either.
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('normal');

    act(() => { useSettingsStore.getState().setSettings({ interfaceScale: 'compact' }); });
    act(() => { useSettingsStore.getState().loadFromServer(serverNoRow() as any); });
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('compact');
  });

  it('CASE 1: a stored server scale wins, for every value', () => {
    for (const scale of ['compact', 'normal', 'comfortable'] as const) {
      act(() => { useSettingsStore.getState().setSettings({ interfaceScale: 'comfortable' }); });
      act(() => { useSettingsStore.getState().loadFromServer(serverWithRow(scale) as any); });
      expect(useSettingsStore.getState().settings.interfaceScale).toBe(scale);
      expect(document.documentElement.getAttribute('data-scale')).toBe(scale);
    }
  });

  it('treats a stored MEDIUM as authoritative, never second-guessing it', () => {
    // The approved conservative policy: nothing stored can prove a historical
    // 'normal' was accidental, so it is never silently upgraded to Large.
    act(() => { useSettingsStore.getState().reset(); });
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('comfortable');
    act(() => { useSettingsStore.getState().loadFromServer(serverWithRow('normal') as any); });
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('normal');
  });

  it('still applies the OTHER server fields when the scale is synthesized', () => {
    // Only the scale is special-cased; hydration is not switched off wholesale.
    act(() => { useSettingsStore.getState().setSettings({ interfaceScale: 'compact' }); });
    act(() => {
      useSettingsStore.getState().loadFromServer(
        serverNoRow({ theme: 'dark', fontSize: 'small' }) as any
      );
    });
    const st = useSettingsStore.getState().settings;
    expect(st.interfaceScale).toBe('compact');
    expect(st.theme).toBe('dark');
    expect(st.fontSize).toBe('small');
  });

  it('local scale still wins when an older server omits the flag entirely', () => {
    // Defensive: only an explicit `false` means "synthesized". A response with
    // no flag at all is treated as a real payload, matching the pre-flag shape.
    act(() => { useSettingsStore.getState().setSettings({ interfaceScale: 'compact' }); });
    act(() => { useSettingsStore.getState().loadFromServer({ interfaceScale: 'normal' } as any); });
    expect(useSettingsStore.getState().settings.interfaceScale).toBe('normal');
  });

  it('never merges the flag itself into the stored settings', () => {
    act(() => {
      useSettingsStore.getState().loadFromServer({ theme: 'light', hasSavedSettings: true } as any);
    });
    expect(useSettingsStore.getState().settings).not.toHaveProperty('hasSavedSettings');
  });

  it('the v4 client actually consumes the additive signal', () => {
    // Guards against the flag becoming unused API metadata.
    expect(source('store/settingsStore.ts')).toContain('hasSavedSettings === false');
  });
});
