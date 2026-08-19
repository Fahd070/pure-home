// Regression tests for the Oregon -> Singapore default-backend migration
// (appStore.ts's persisted store: version 4 -> 5). appStore.ts's serverUrl
// default and the migrate() function are both evaluated at module import
// time / store creation time, so each test seeds localStorage with a
// specific persisted-store shape *before* dynamically re-importing the
// store with vi.resetModules() to force a fresh rehydration -- the same
// pattern already established in apiUrl.test.ts for this same module.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'wfm-unified';
const OLD_OREGON_URL = 'https://wfm-system.onrender.com';
const SINGAPORE_URL = 'https://pure-home-singapore.onrender.com';

function seedPersistedStore(state: Record<string, unknown>, version: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version }));
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_API_URL', ''); // Electron-desktop-like: no build-time override
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Server URL Singapore migration (store version 4 -> 5)', () => {
  it('1. fresh install (no persisted state at all) defaults to Singapore', async () => {
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe(SINGAPORE_URL);
  });

  it('2. a v4 install persisted with the old Oregon URL migrates to Singapore, auth tokens untouched', async () => {
    const adminAuth = { user: { id: 'u1', name: 'Admin', email: 'a@wfm.local', role: 'ADMIN' }, token: 'real-jwt-token' };
    seedPersistedStore(
      { serverUrl: OLD_OREGON_URL, adminAuth, schedulingAuth: null, technicianAuth: null, adminLoginTime: 12345, schedulingLoginTime: 0, technicianLoginTime: 0 },
      4
    );
    const { useAppStore } = await import('@/store/appStore');
    const state = useAppStore.getState();
    expect(state.serverUrl).toBe(SINGAPORE_URL);
    // Do NOT clear login/auth tokens solely for this migration.
    expect(state.adminAuth).toEqual(adminAuth);
    expect(state.adminLoginTime).toBe(12345);
  });

  it('3. a v4 install already pointed at Singapore remains untouched (not re-processed/duplicated)', async () => {
    seedPersistedStore(
      { serverUrl: SINGAPORE_URL, adminAuth: null, schedulingAuth: null, technicianAuth: null, adminLoginTime: 0, schedulingLoginTime: 0, technicianLoginTime: 0 },
      4
    );
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe(SINGAPORE_URL);
  });

  it('4. a v4 install with a custom Server Setup URL is never touched by this migration', async () => {
    const customUrl = 'http://100.64.12.34:3001'; // Tailscale-style on-prem override
    seedPersistedStore(
      { serverUrl: customUrl, adminAuth: null, schedulingAuth: null, technicianAuth: null, adminLoginTime: 0, schedulingLoginTime: 0, technicianLoginTime: 0 },
      4
    );
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe(customUrl);
  });

  it('4b. localhost and other non-Oregon values are never touched by this migration', async () => {
    seedPersistedStore(
      { serverUrl: 'http://127.0.0.1:3001', adminAuth: null, schedulingAuth: null, technicianAuth: null, adminLoginTime: 0, schedulingLoginTime: 0, technicianLoginTime: 0 },
      4
    );
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe('http://127.0.0.1:3001');
  });

  it('5. old pre-v4 migration behavior is preserved: forces the current default and clears auth tokens', async () => {
    const adminAuth = { user: { id: 'u1', name: 'Admin', email: 'a@wfm.local', role: 'ADMIN' }, token: 'stale-pre-v4-token' };
    seedPersistedStore(
      { serverUrl: 'https://some-ancient-url.example.com', adminAuth, schedulingAuth: null, technicianAuth: null, adminLoginTime: 999, schedulingLoginTime: 0, technicianLoginTime: 0 },
      2 // pre-v4
    );
    const { useAppStore } = await import('@/store/appStore');
    const state = useAppStore.getState();
    // Pre-v4 behavior is unchanged: forced to the current default (now
    // Singapore, since that's what the current default resolves to) and
    // every department's auth is cleared -- exactly as it did before this
    // migration existed, just pointed at the new canonical URL.
    expect(state.serverUrl).toBe(SINGAPORE_URL);
    expect(state.adminAuth).toBeNull();
  });

  it('6. setServerUrl still allows a custom runtime override after migration', async () => {
    seedPersistedStore(
      { serverUrl: OLD_OREGON_URL, adminAuth: null, schedulingAuth: null, technicianAuth: null, adminLoginTime: 0, schedulingLoginTime: 0, technicianLoginTime: 0 },
      4
    );
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe(SINGAPORE_URL);
    useAppStore.getState().setServerUrl('https://on-prem.local:4000');
    expect(useAppStore.getState().serverUrl).toBe('https://on-prem.local:4000');
  });

  it('the persisted store version is now 5 (not 4) after this change', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), '../unified-app/src/store/appStore.ts'), 'utf-8'
    );
    expect(src).toMatch(/version:\s*5/);
    expect(src).not.toMatch(/version:\s*4,/);
  });
});
