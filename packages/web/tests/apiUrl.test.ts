// Regression tests for audit finding F-9 (VITE_API_URL configuration drift).
// appStore.ts's serverUrl is a module-level const evaluated at import time, so
// each test stubs VITE_API_URL via vi.stubEnv (Vitest's supported mechanism for
// import.meta.env, backed by Vite's own dev-mode module transform) and then
// dynamically re-imports the store with vi.resetModules() to force
// re-evaluation -- the same pattern needed for any Vite env-driven constant.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appStore serverUrl (F-9 VITE_API_URL source of truth)', () => {
  it('uses VITE_API_URL as the initial serverUrl when it is configured', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe('https://api.example.test');
  });

  it('falls back to the documented default when VITE_API_URL is not configured (local/dev behavior)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { useAppStore } = await import('@/store/appStore');
    expect(useAppStore.getState().serverUrl).toBe('https://wfm-system.onrender.com');
  });

  it('a runtime override via setServerUrl still works regardless of the build-time default (Electron Server Setup behavior preserved)', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    const { useAppStore } = await import('@/store/appStore');
    useAppStore.getState().setServerUrl('https://on-prem.local:4000');
    expect(useAppStore.getState().serverUrl).toBe('https://on-prem.local:4000');
  });
});

describe('axios and Socket.IO share the same configured backend URL (no drift)', () => {
  it('the admin API client reads serverUrl from the same store that Socket.IO reads from', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    const { useAppStore } = await import('@/store/appStore');
    const { getAuthState } = await import('@/admin/store/authStore');

    // Both call sites resolve through the same underlying store instance --
    // proven by confirming they observe the same value, then confirming a
    // change to the store is visible from both without re-configuring either.
    expect(getAuthState().serverUrl).toBe(useAppStore.getState().serverUrl);

    useAppStore.getState().setServerUrl('https://on-prem.local:4000');
    expect(getAuthState().serverUrl).toBe('https://on-prem.local:4000');
  });
});
