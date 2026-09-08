import React, { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Icon, IconName } from "../ui/icons";
import type { Tone } from "../ui/Badge";
import { cx } from "../ui/cx";

type Role = "ADMIN" | "SCHEDULING" | "TECHNICIAN";
interface Notif { id: string; text: string; icon: IconName; tone: Tone; }

// Each event carries a tone that means something: green for work completed,
// amber for work paused, red for something removed, neutral-blue for routine
// activity. Previously every event had its own two-stop gradient, which made
// eight different-coloured banners with no shared meaning between them.
const EVENTS: Record<string, { text: string; icon: IconName; tone: Tone; roles: Role[] }> = {
  "customer:created":      { text: "تم إضافة عميل جديد",     icon: "customers",    tone: "info",     roles: ["ADMIN", "SCHEDULING"] },
  "appointment:created":   { text: "تم جدولة موعد جديد",     icon: "appointments", tone: "info",     roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "appointment:deleted":   { text: "تم حذف موعد",            icon: "trash",        tone: "danger",   roles: ["ADMIN"] },
  "appointment:started":   { text: "بدأ الفني العمل",        icon: "technicians",  tone: "progress", roles: ["ADMIN", "SCHEDULING"] },
  "appointment:completed": { text: "تم إتمام الموعد بنجاح",  icon: "check",        tone: "success",  roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "appointment:postponed": { text: "تم تأجيل الموعد",        icon: "clock",        tone: "warning",  roles: ["ADMIN", "SCHEDULING", "TECHNICIAN"] },
  "call_report:new":       { text: "تم إرسال تقرير مكالمة",  icon: "callReports",  tone: "accent",   roles: ["ADMIN", "SCHEDULING"] },
  "expense:new":           { text: "تم إضافة مصروف جديد",    icon: "expenses",     tone: "pending",  roles: ["ADMIN"] },
};

const TONE_CLASSES: Record<Tone, string> = {
  neutral:  "bg-neutral-bg  border-neutral-border  text-neutral-fg",
  success:  "bg-success-bg  border-success-border  text-success-fg",
  warning:  "bg-warning-bg  border-warning-border  text-warning-fg",
  danger:   "bg-danger-bg   border-danger-border   text-danger-fg",
  info:     "bg-info-bg     border-info-border     text-info-fg",
  urgent:   "bg-urgent-bg   border-urgent-border   text-urgent-fg",
  pending:  "bg-pending-bg  border-pending-border  text-pending-fg",
  progress: "bg-progress-bg border-progress-border text-progress-fg",
  accent:   "bg-accent-subtle border-accent-border text-accent-subtlefg",
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
      let tone = def.tone;
      let icon = def.icon;
      // An urgent appointment is a different event to the eye, not just a
      // different sentence -- it gets the urgent tone and the alert glyph.
      if (ev === "appointment:created" && data?.isUrgent) {
        text = "تم إنشاء موعد عاجل";
        tone = "urgent";
        icon = "urgent";
      }
      queueRef.current.push({ id: `${ev}-${Date.now()}`, text, icon, tone });
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
      role="status"
      aria-live="polite"
      className={cx(
        "fixed inset-x-0 top-0 z-toast flex justify-center px-4 pt-2 pointer-events-none",
        "transition-transform duration-300 ease-out",
        visible ? "translate-y-0" : "-translate-y-full"
      )}
    >
      <div
        className={cx(
          "pointer-events-auto w-full max-w-md rounded-lg border px-4 py-3 flex items-center gap-3 shadow-lg",
          TONE_CLASSES[shown.tone]
        )}
      >
        <Icon name={shown.icon} className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[0.8125rem] font-semibold leading-tight">{shown.text}</p>
          <p className="text-2xs opacity-70 mt-0.5">Pure Home</p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="إغلاق"
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover transition-colors flex-shrink-0"
        >
          <Icon name="close" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
