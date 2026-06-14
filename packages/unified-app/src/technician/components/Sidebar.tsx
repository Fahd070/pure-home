import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import { useNotificationSound } from "../../hooks/useNotificationSound";
import { useSettingsStore } from "../../store/settingsStore";

function colorAdjust(hex: string, offset: number): string {
  const n = parseInt((hex || '#8B4513').replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + offset));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + offset));
  const b = Math.min(255, Math.max(0, (n & 0xff) + offset));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

const BADGE = "bg-red-500";

const links = [
  { to: "/technician/queue",              label: "nav.workQueue",          icon: "📋", badgeKey: "queue" },
  { to: "/technician/urgent-appointments",label: "nav.urgentAppointments", icon: "🚨", badgeKey: "urgentAppts" },
  { to: "/technician/expenses",           label: "nav.expenses",           icon: "💰" },
  { to: "/technician/messages",           label: "nav.messages",           icon: "🗒️",  badgeKey: "messages" },
  { to: "/technician/notifications",      label: "nav.notifications",      icon: "🔔", badgeKey: "notifications" },
  { to: "/technician/messaging",          label: "nav.messaging",          icon: "💬", badgeKey: "messaging" },
  { to: "/technician/settings",           label: "nav.settings",           icon: "⚙️" },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  useNotificationSound(socket);
  const { settings } = useSettingsStore();
  const BG = settings.primaryColor || "#8B4513";
  const BG_HOVER = colorAdjust(BG, -14);
  const BG_ACTIVE = colorAdjust(BG, 50);
  const BORDER = BG_HOVER;
  const [queueBadge, setQueueBadge] = useState(() => Number(localStorage.getItem("badge-queue-tech") || 0));
  const [urgentBadge, setUrgentBadge] = useState(() => Number(localStorage.getItem("badge-urgent-tech") || 0));

  useEffect(() => {
    if (!socket) return;
    const incQueue = () => setQueueBadge(c => { const v = c + 1; localStorage.setItem("badge-queue-tech", String(v)); return v; });
    const incUrgent = () => setUrgentBadge(c => { const v = c + 1; localStorage.setItem("badge-urgent-tech", String(v)); return v; });
    socket.on("task:approved", incQueue);
    socket.on("appointment:created", (a: any) => { if (a?.isUrgent) incUrgent(); });
    return () => {
      socket.off("task:approved", incQueue);
      socket.off("appointment:created", incUrgent);
    };
  }, [socket]);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-queue-tech"); setQueueBadge(0); };
    window.addEventListener("clear-badge-queue-tech", clear);
    return () => window.removeEventListener("clear-badge-queue-tech", clear);
  }, []);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-urgent-tech"); setUrgentBadge(0); };
    window.addEventListener("clear-badge-urgent-tech", clear);
    return () => window.removeEventListener("clear-badge-urgent-tech", clear);
  }, []);

  const { data: notifData } = useQuery({ queryKey: ["notif-unread-tech"], queryFn: () => api.get("/notifications").then(r => (r.data.data || []).filter((n:any) => !n.isRead).length), refetchInterval: 30000, initialData: 0 });
  const { data: dmCount } = useQuery({ queryKey: ["dm-unread-tech"], queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0), refetchInterval: 30000, initialData: 0 });
  const { data: activityData } = useQuery({ queryKey: ["activity-feed-tech"], queryFn: () => api.get("/messages").then(r => r.data.data || []), staleTime: 30000, initialData: [] });
  const lastSeenMessages = Number(localStorage.getItem("msg-last-seen-tech") || 0);
  const newMessages = (activityData as any[]).filter((log: any) => new Date(log.createdAt).getTime() > lastSeenMessages).length;

  const badges: Record<string, number> = {
    notifications: notifData as number,
    messaging: dmCount as number,
    messages: newMessages,
    queue: queueBadge,
    urgentAppts: urgentBadge,
  };

  return (
    <aside style={{ backgroundColor: BG }} className="w-56 text-white flex flex-col h-full flex-shrink-0">
      <div style={{ borderColor: BORDER }} className="p-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <div style={{ backgroundColor: BG_ACTIVE }} className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold">PH</div>
          <span className="text-white font-bold text-sm">Pure Home</span>
        </div>
        <p className="text-orange-100 text-xs truncate">{user?.name}</p>
      </div>
      <nav className="flex-1 py-2">
        {links.map(l => {
          const badge = l.badgeKey ? (badges[l.badgeKey] || 0) : 0;
          return (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? "font-medium border-e-2 border-orange-200" : "text-orange-100"}`}
              style={({ isActive }) => ({ backgroundColor: isActive ? BG_ACTIVE : undefined })}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = BG_HOVER; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}>
              <span className="flex-shrink-0">{l.icon}</span>
              <span className="flex-1">{t(l.label)}</span>
              {badge > 0 && <span className={`${BADGE} text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none`}>{badge > 99 ? "99+" : badge}</span>}
            </NavLink>
          );
        })}
        <a
          href="https://wa.me/966501698445"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-2.5 text-sm text-orange-100 transition-colors"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = BG_HOVER; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}>
          <span className="flex-shrink-0">💬</span>
          <span className="flex-1">{t("nav.reportIssue")}</span>
        </a>
      </nav>
      <div style={{ borderColor: BORDER }} className="p-3 border-t space-y-1">
        <button onClick={() => i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")}
          style={{ backgroundColor: BG_HOVER }} className="w-full text-xs py-1.5 px-3 rounded text-orange-100 hover:opacity-90">
          {i18n.language === "ar" ? "English" : "عربي"}
        </button>
        <button onClick={() => { logout(); navigate("/"); }} className="w-full text-xs py-1.5 px-3 rounded bg-red-700 hover:bg-red-600">{t("auth.logout")}</button>
      </div>
    </aside>
  );
}
