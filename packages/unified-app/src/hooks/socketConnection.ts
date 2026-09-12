import { io, Socket } from "socket.io-client";

export interface SocketState {
  socket: Socket | null;
  token: string | null;
}

/**
 * Shared core of each department's useSocket() hook. Fixes a race where
 * checking only `!socket.connected` let a second component mounting in the
 * same tick (e.g. a layout's Sidebar and its Dashboard child both calling
 * useSocket() on first render) create a duplicate, orphaned socket -- because
 * `.connected` is false both while the socket is still in the process of
 * connecting AND once it has genuinely disconnected, and the original guard
 * couldn't tell those two cases apart.
 *
 * `.active` (socket.io-client v4+) distinguishes them: it stays true while
 * the client is still retrying on its own (per `reconnection: true` below),
 * and only goes false once it has truly given up or was manually
 * disconnected. So: create a socket only if none exists yet; while one is
 * connecting or auto-reconnecting, reuse it as-is; only call `.connect()`
 * explicitly once it has genuinely stopped trying. A token change (e.g.
 * logout then re-login with a fresh JWT) updates the existing socket's auth
 * and forces a fresh handshake instead of leaving stale credentials attached
 * or creating a second connection.
 */
export function getOrCreateSocket(state: SocketState, token: string, serverUrl: string): Socket {
  if (!state.socket) {
    state.token = token;
    state.socket = io(serverUrl, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
    return state.socket;
  }

  if (state.token !== token) {
    state.token = token;
    state.socket.auth = { token };
    if (state.socket.connected) {
      state.socket.disconnect().connect();
    } else if (!state.socket.active) {
      state.socket.connect();
    }
    return state.socket;
  }

  if (!state.socket.connected && !state.socket.active) {
    state.socket.connect();
  }

  return state.socket;
}

/**
 * Tears the department's socket down on logout (v4 Requirement #13).
 *
 * Navigating away is not enough: these SocketState objects are module-level
 * singletons, so without this the connection authenticated as the previous user
 * survives logout, stays in that user's rooms, and keeps receiving their
 * private realtime events. The socket is fully discarded rather than just
 * disconnected -- `reconnection: true` means a merely-disconnected socket would
 * try to come back with the old credentials, and clearing `token` guarantees
 * the next login takes the create-a-new-socket path instead of the
 * reuse-if-token-matches one.
 */
export function destroySocket(state: SocketState): void {
  if (state.socket) {
    state.socket.removeAllListeners();
    state.socket.disconnect();
  }
  state.socket = null;
  state.token = null;
}
