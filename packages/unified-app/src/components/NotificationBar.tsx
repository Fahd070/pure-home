import React, { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

type Role = "ADMIN" | "SCHEDULING" | "TECHNICIAN";
interface Notif { id: string; text: string; icon: string; bg: string; }

const EVENTS: Record<string, { text: string; icon: string; bg: string; roles: Role[] }> = {
  "customer:created":    { text: "تم إضافة عميل جديد",        icon: "👤", bg: "from-blue-600 to-blue-700",      roles: ["ADMIN", "SCHEDULING"] },
  "appointment:created": { text: "تم جدولة موعد جديد",        icon: "📅", bg: "from-indigo-600 to-indigo-700",  roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "appointment:deleted": { text: "تم حذف موعد",               icon: "🗑️", bg: "from-red-600 to-red-700",       roles: ["ADMIN"] },
  "task:completed":      { text: "تم إكمال مهمة",             icon: "✅", bg: "from-green-600 to-green-700",   roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "task:postponed":      { text: "تم تأجيل مهمة",             icon: "⏸️", bg: "from-orange-500 to-orange-600", roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "task:approved":       { text: "تمت الموافقة على مهمة",     icon: "✔️", bg: "from-purple-600 to-purple-700", roles: ["ADMIN", "TECHNICIAN"] },
  "call_report:new":     { text: "تم إرسال تقرير مكالمة",     icon: "📞", bg: "from-teal-600 to-teal-700",     roles: ["ADMIN", "SCHEDULING"] },
  "expense:new":         { text: "تم إضافة مصروف جديد",       icon: "💰", bg: "from-amber-500 to-amber-600",   roles: ["ADMIN"] },
};

interface Props { role: Role; getSocket: () => Socket | null; }

export default function NotificationBar({ role, getSocket }: Props) {
  const queueRef = useRef<Notif[]>([]);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shown, setShown] = useState<Notif | null>(null);
  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0);

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(() => {
      setShown(null);
      busyRef.current = false;
      if (queueRef.current.length > 0) setTick(k => k + 1);
    }, 350);
  }

  // Process next in queue whenever tick changes
  useEffect(() => {
    if (busyRef.current || queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    busyRef.current = true;
    setShown(next);
    const mountDelay = setTimeout(() => setVisible(true), 20);
    timerRef.current = setTimeout(() => hide(), 4520);
    return () => { clearTimeout(mountDelay); if (timerRef.current) clearTimeout(timerRef.current); };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach socket listeners
  useEffect(() => {
    let detach: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    function enqueue(ev: string, data?: any) {
      const def = EVENTS[ev];
      if (!def || !def.roles.includes(role)) return;
      let text = def.text;
      if (ev === "appointment:created" && data?.isUrgent) text = "تم إنشاء موعد عاجل";
      queueRef.current.push({ id: `${ev}-${Date.now()}`, text, icon: def.icon, bg: def.bg });
      if (!busyRef.current) setTick(k => k + 1);
    }

    function attach(s: Socket) {
      const pairs = Object.keys(EVENTS).map(ev => {
        const h = (data?: any) => enqueue(ev, data);
        s.on(ev, h);
        return [ev, h] as const;
      });
      return () => pairs.forEach(([ev, h]) => s.off(ev, h as any));
    }

    function tryAttach() {
      const s = getSocket();
      if (s) {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (detach) detach();
        detach = attach(s);
      }
    }

    tryAttach();
    if (!getSocket()) pollTimer = setInterval(tryAttach, 500);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (detach) detach();
    };
  }, [role, getSocket]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;

  return (
    <div
      dir="rtl"
      className={`fixed inset-x-0 top-0 z-[9999] flex justify-center px-4 pt-2 pointer-events-none transition-transform duration-300 ease-out ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div
        className={`pointer-events-auto w-full max-w-md rounded-2xl text-white px-5 py-3.5 flex items-center gap-4 bg-gradient-to-l ${shown.bg}`}
        style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.28)" }}
      >
        <span className="text-2xl leading-none flex-shrink-0">{shown.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">{shown.text}</p>
          <p className="text-[11px] opacity-70 mt-0.5">Pure Home</p>
        </div>
        <button
          onClick={hide}
          className="w-7 h-7 rounded-full bg-white/25 hover:bg-white/40 flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
