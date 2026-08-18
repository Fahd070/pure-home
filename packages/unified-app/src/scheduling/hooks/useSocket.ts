import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { useAppStore } from "../../store/appStore";
import { getOrCreateSocket, SocketState } from "../../hooks/socketConnection";

const schedSocketState: SocketState = { socket: null, token: null };

export function useSocket() {
  const { schedulingAuth, serverUrl } = useAppStore();
  const token = schedulingAuth?.token;
  const ref = useRef<Socket | null>(null);
  useEffect(() => {
    if (!token) return;
    ref.current = getOrCreateSocket(schedSocketState, token, serverUrl);
  }, [token, serverUrl]);
  return ref.current;
}
export function getSocket() { return schedSocketState.socket; }
