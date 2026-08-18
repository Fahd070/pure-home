// Regression tests for the socket singleton race (audit finding: checking
// only `!socket.connected` let two components mounting in the same commit --
// e.g. a layout's Sidebar and its Dashboard child both calling useSocket() on
// first render -- create a duplicate, orphaned WebSocket connection, because
// `.connected` is false both while a socket is still CONNECTING and once it
// has genuinely disconnected).
//
// No React Testing Library is installed in this project; component-level
// rendering uses plain react-dom/client + act, matching the pattern used by
// appTitleBar.test.tsx / departmentSelector.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Part 1: pure unit tests against the shared helper directly ─────────────
// Each test uses its own fresh `state` object, so there is no cross-test
// module-singleton state to reset.
import { getOrCreateSocket, type SocketState } from '../../unified-app/src/hooks/socketConnection';

vi.mock('socket.io-client', () => {
  function makeFakeSocket() {
    return {
      connected: false,
      active: true,
      auth: {} as any,
      connect: vi.fn(function (this: any) { this.connected = true; return this; }),
      disconnect: vi.fn(function (this: any) { this.connected = false; this.active = false; return this; }),
      on: vi.fn(),
      off: vi.fn(),
    };
  }
  const io = vi.fn(() => makeFakeSocket());
  return { io };
});

import { io } from 'socket.io-client';

describe('getOrCreateSocket (unit)', () => {
  beforeEach(() => {
    (io as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('creates a socket on the first call', () => {
    const state: SocketState = { socket: null, token: null };
    const s = getOrCreateSocket(state, 'tok-1', 'http://localhost:9999');
    expect(io).toHaveBeenCalledTimes(1);
    expect(state.socket).toBe(s);
  });

  it('reuses the same socket while it is still connecting (connected=false, active=true) instead of creating a second one', () => {
    const state: SocketState = { socket: null, token: null };
    const first = getOrCreateSocket(state, 'tok-1', 'http://localhost:9999');
    // Simulate: handshake still in flight -- this is exactly the window where
    // the old `!socket.connected` guard would have created a duplicate.
    (first as any).connected = false;
    (first as any).active = true;

    const second = getOrCreateSocket(state, 'tok-1', 'http://localhost:9999');

    expect(io).toHaveBeenCalledTimes(1); // still only one socket ever created
    expect(second).toBe(first);
  });

  it('reconnects the existing socket (does not create a new one) once it has genuinely given up (active=false)', () => {
    const state: SocketState = { socket: null, token: null };
    const first = getOrCreateSocket(state, 'tok-1', 'http://localhost:9999');
    (first as any).connected = false;
    (first as any).active = false; // reconnection attempts exhausted / manually disconnected

    const second = getOrCreateSocket(state, 'tok-1', 'http://localhost:9999');

    expect(io).toHaveBeenCalledTimes(1); // no second socket instance
    expect(second).toBe(first);
    expect((first as any).connect).toHaveBeenCalled();
  });

  it('updates auth and reconnects (without creating a new instance) when the token changes', () => {
    const state: SocketState = { socket: null, token: null };
    const first = getOrCreateSocket(state, 'tok-old', 'http://localhost:9999');
    (first as any).connected = true;

    const second = getOrCreateSocket(state, 'tok-new', 'http://localhost:9999');

    expect(io).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect((first as any).auth).toEqual({ token: 'tok-new' });
    expect((first as any).disconnect).toHaveBeenCalled();
  });
});

// ── Part 2: end-to-end regression -- two real components mounting together ──
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import { useSocket as useAdminSocket } from '../../unified-app/src/admin/hooks/useSocket';
import { useAppStore } from '../../unified-app/src/store/appStore';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function SidebarLike() {
  useAdminSocket();
  return null;
}
function DashboardLike() {
  useAdminSocket();
  return null;
}

describe('useSocket: simultaneous component mounting (Sidebar + Dashboard) creates exactly one socket', () => {
  beforeEach(() => {
    (io as unknown as ReturnType<typeof vi.fn>).mockClear();
    act(() => {
      useAppStore.setState({
        serverUrl: 'http://localhost:9999',
        adminAuth: { user: { id: 'u1', name: 'Admin', email: 'a@a.com', role: 'ADMIN' }, token: 'tok-1' },
      });
    });
  });

  afterEach(() => {
    if (root) { act(() => { root!.unmount(); }); root = null; }
    if (container) { container.remove(); container = null; }
    act(() => {
      useAppStore.setState({ adminAuth: null });
    });
  });

  it('mounting two socket-consuming components in the same render only ever calls io() once', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <>
          <SidebarLike />
          <DashboardLike />
        </>
      );
    });

    expect(io).toHaveBeenCalledTimes(1);
  });
});
