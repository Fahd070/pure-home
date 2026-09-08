import React, { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { Icon } from "../ui/icons";

type Status = "connected" | "disconnected" | "reconnecting" | "restored";

interface Props {
  getSocket: () => Socket | null;
}

export default function ConnectionBanner({ getSocket }: Props) {
  const [status, setStatus] = useState<Status>("connected");

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let detach: (() => void) | null = null;

    function attach(s: Socket) {
      setStatus(s.connected ? "connected" : "disconnected");

      const onDisconnect = () => setStatus("disconnected");
      const onReconnectAttempt = () => setStatus("reconnecting");
      const onConnect = () => {
        if (restoreTimer) clearTimeout(restoreTimer);
        setStatus("restored");
        restoreTimer = setTimeout(() => setStatus("connected"), 2500);
      };

      s.on("disconnect", onDisconnect);
      s.on("reconnect_attempt", onReconnectAttempt);
      s.on("connect", onConnect);

      return () => {
        s.off("disconnect", onDisconnect);
        s.off("reconnect_attempt", onReconnectAttempt);
        s.off("connect", onConnect);
      };
    }

    function tryAttach() {
      const s = getSocket();
      if (s) {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        detach = attach(s);
      }
    }

    tryAttach();
    // Socket initializes inside Sidebar on its first render; poll until it exists
    if (!getSocket()) {
      pollTimer = setInterval(tryAttach, 300);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (restoreTimer) clearTimeout(restoreTimer);
      if (detach) detach();
    };
  }, [getSocket]);

  if (status === "connected") return null;

  // Connection state is operational information, so it uses the semantic tone
  // tokens rather than raw palette colours -- the same red/amber/green a status
  // badge uses anywhere else in the app, and it follows dark and high contrast.
  const cfg: Record<Exclude<Status, "connected">, { cls: string; spin: boolean; text: string; textAr: string }> = {
    disconnected: { cls: "bg-danger-bg  text-danger-fg  border-danger-border",  spin: false, text: "Connection lost — retrying...", textAr: "انقطع الاتصال — جاري إعادة المحاولة..." },
    reconnecting: { cls: "bg-warning-bg text-warning-fg border-warning-border", spin: true,  text: "Reconnecting to server...",    textAr: "جاري إعادة الاتصال بالخادم..." },
    restored:     { cls: "bg-success-bg text-success-fg border-success-border", spin: false, text: "Connection restored.",         textAr: "تمت إعادة الاتصال." },
  };

  const { cls, spin, text, textAr } = cfg[status as Exclude<Status, "connected">];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${cls} border-b text-2xs px-4 py-1.5 flex items-center justify-center gap-2 select-none flex-shrink-0`}
    >
      {spin && <Icon name="refresh" className="w-3.5 h-3.5 animate-spin" />}
      <span className="font-medium">{text}</span>
      <span className="opacity-70">/ {textAr}</span>
    </div>
  );
}
