import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

let socket: Socket | null = null;

export function useSocket() {
  const { token, serverUrl } = useAuthStore();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;
    if (!socket || !socket.connected) {
      socket = io(serverUrl, { auth: { token }, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000 });
    }
    socketRef.current = socket;
    return () => {};
  }, [token, serverUrl]);

  return socketRef.current;
}

export function getSocket() { return socket; }
