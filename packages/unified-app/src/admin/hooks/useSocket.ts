import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useAppStore } from "../../store/appStore";

let adminSocket: Socket | null = null;

export function useSocket() {
  const { adminAuth, serverUrl } = useAppStore();
  const token = adminAuth?.token;
  const ref = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token) return;
    if (!adminSocket || !adminSocket.connected) {
      adminSocket = io(serverUrl, { auth: { token }, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000 });
    }
    ref.current = adminSocket;
  }, [token, serverUrl]);
  return ref.current;
}
export function getSocket() { return adminSocket; }