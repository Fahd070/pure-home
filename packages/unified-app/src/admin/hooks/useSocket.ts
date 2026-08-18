import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { useAppStore } from "../../store/appStore";
import { getOrCreateSocket, SocketState } from "../../hooks/socketConnection";

const adminSocketState: SocketState = { socket: null, token: null };

export function useSocket() {
  const { adminAuth, serverUrl } = useAppStore();
  const token = adminAuth?.token;
  const ref = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token) return;
    ref.current = getOrCreateSocket(adminSocketState, token, serverUrl);
  }, [token, serverUrl]);
  return ref.current;
}
export function getSocket() { return adminSocketState.socket; }
