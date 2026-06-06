import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";

const BG = "#008000";
const BG_HOVER = "#006600";
const BG_ACTIVE = "#009a00";
const BORDER = "#006600";
const BADGE = "bg-red-500";

const links = [
  { to: "/scheduling/customers",    label: "nav.customers",    icon: "👥", badgeKey: "customers" },
  { to: "/scheduling/messages",     label: "nav.messages",     icon: "📋", badgeKey: "messages" },
  { to: "/scheduling/notifications",label: "nav.notifications",icon: "🔔", badgeKey: "notifications" },
  { to: "/scheduling/messaging",    label: "nav.messaging",    icon: "💬", badgeKey: "messaging" },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  const [custBadge, setCustBadge] = useState(() => Number(localStorage.getItem("badge-cust-sched") || 0));

  useEffect(() => {
    if (!socket) return;
    const inc = () => {
      setCustBadge(c => {
        const v = c + 1;
        localStorage.setItem("badge-cust-sched", String(v));
        return v;
      });
    };
    socket.on("customer:created", inc);
    return () => { socket.off("customer:created", inc); };
  }, [socket]);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-cust-sched"); setCustBadge(0); };
    window.addEventListener("clear-badge-customers-sched", clear);
    return () => window.removeEventListener("clear-badge-customers-sched", clear);
  }, []);

  const { data: notifData } = useQuery({ queryKey: ["notif-unread-sched"], queryFn: () => api.get("/notifications").then(r => (r.data.data || []).filter((n:any) => !n.isRead).length), refetchInterval: 30000, initialData: 0 });
  const { data: dmCount } = useQuery({ queryKey: ["dm-unread-sched"], queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0), refetchInterval: 30000, initialData: 0 });
  const { data: activityData } = useQuery({ queryKey: ["activity-feed-sched"], queryFn: () => api.get("/messages").then(r => r.data.data || []), staleTime: 30000, initialData: [] });
  const lastSeenMessages = Number(localStorage.getItem("msg-last-seen-sched") || 0);
  const newMessages = (activityData as any[]).filter((log: any) => new Date(log.createdAt).getTime() > lastSeenMessages).length;

  const badges: Record<string, number> = {
    notifications: notifData as number,
    messaging: dmCount as number,
    messages: newMessages,
    customers: custBadge
  };

  return (
    <aside style={{ backgroundColor: BG }} className="w-56 text-white flex flex-col h-full flex-shrink-0">
      <div style={{ borderColor: BORDER }} className="p-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <div style={{ backgroundColor: BG_ACTIVE }} className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold">PH</div>
          <span className="text-white font-bold text-sm">Pure Home</span>
        </div>
        <p className="text-green-100 text-xs truncate">{user?.name}</p>
      </div>
      <nav className="flex-1 py-2">
        {links.map(l => {
          const badge = l.badgeKey ? (badges[l.badgeKey] || 0) : 0;
          return (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? "font-medium border-e-2 border-green-200" : "text-green-100"}`}
              style={({ isActive }) => ({ backgroundColor: isActive ? BG_ACTIVE : undefined })}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = BG_HOVER; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}>
              <span className="flex-shrink-0">{l.icon}</span>
              <span className="flex-1">{t(l.label)}</span>
              {badge > 0 && <span className={`${BADGE} text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none`}>{badge > 99 ? "99+" : badge}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div style={{ borderColor: BORDER }} className="p-3 border-t space-y-1">
        <button onClick={() => i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")}
          style={{ backgroundColor: BG_HOVER }} className="w-full text-xs py-1.5 px-3 rounded text-green-100 hover:opacity-90">
          {i18n.language === "ar" ? "English" : "عربي"}
        </button>
        <button onClick={() => { logout(); navigate("/"); }} className="w-full text-xs py-1.5 px-3 rounded bg-red-700 hover:bg-red-600">{t("auth.logout")}</button>
      </div>
    </aside>
  );
}
