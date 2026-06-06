import React, { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

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

  const cfg: Record<Exclude<Status, "connected">, { bg: string; spin: boolean; text: string; textAr: string }> = {
    disconnected: { bg: "bg-red-600",    spin: false, text: "Connection lost — retrying...",         textAr: "انقطع الاتصال — جاري إعادة المحاولة..." },
    reconnecting: { bg: "bg-yellow-500", spin: true,  text: "Reconnecting to server...",             textAr: "جاري إعادة الاتصال بالخادم..." },
    restored:     { bg: "bg-green-600",  spin: false, text: "Connection restored.",                  textAr: "تمت إعادة الاتصال." },
  };

  const { bg, spin, text, textAr } = cfg[status as Exclude<Status, "connected">];

  return (
    <div className={`${bg} text-white text-xs px-4 py-1.5 flex items-center justify-center gap-2 select-none shrink-0 z-50`}>
      {spin && <span className="inline-block animate-spin">↻</span>}
      <span>{text}</span>
      <span className="opacity-60 text-[10px]">/ {textAr}</span>
    </div>
  );
}
