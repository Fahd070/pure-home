import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useAppStore } from "../../store/appStore";

let techSocket: Socket | null = null;

export function useSocket() {
  const { technicianAuth, serverUrl } = useAppStore();
  const token = technicianAuth?.token;
  const ref = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token) return;
    if (!techSocket || !techSocket.connected) {
      techSocket = io(serverUrl, { auth: { token }, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000 });
    }
    ref.current = techSocket;
  }, [token, serverUrl]);
  return ref.current;
}
export function getSocket() { return techSocket; }