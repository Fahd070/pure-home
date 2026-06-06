import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useAppStore } from "../../store/appStore";

let schedSocket: Socket | null = null;

export function useSocket() {
  const { schedulingAuth, serverUrl } = useAppStore();
  const token = schedulingAuth?.token;
  const ref = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token) return;
    if (!schedSocket || !schedSocket.connected) {
      schedSocket = io(serverUrl, { auth: { token }, reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 2000 });
    }
    ref.current = schedSocket;
  }, [token, serverUrl]);
  return ref.current;
}
export function getSocket() { return schedSocket; }