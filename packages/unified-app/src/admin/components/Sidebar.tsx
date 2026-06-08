import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";

const BG = "#000080";
const BG_HOVER = "#00006e";
const BG_ACTIVE = "#0000b0";
const BORDER = "#00006e";
const BADGE = "bg-red-500";

const links = [
  { to: "/admin/dashboard",      label: "nav.dashboard",     icon: "⊞" },
  { to: "/admin/customers",      label: "nav.customers",     icon: "👥", badgeKey: "customers" },
  { to: "/admin/reports",        label: "nav.reports",       icon: "📊", badgeKey: "reports" },
  { to: "/admin/appointments",   label: "nav.appointments",  icon: "📅" },
  { to: "/admin/tasks",          label: "nav.tasks",         icon: "✓",  badgeKey: "tasks" },
  { to: "/admin/technicians",    label: "nav.technicians",   icon: "🔧" },
  { to: "/admin/messages",       label: "nav.messages",      icon: "📋", badgeKey: "messages" },
  { to: "/admin/notifications",  label: "nav.notifications", icon: "🔔", badgeKey: "notifications" },
  { to: "/admin/messaging",      label: "nav.messaging",     icon: "💬", badgeKey: "messaging" },
  { to: "/admin/access-codes",   label: "nav.accessCodes",   icon: "🔑" },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  const [custBadge, setCustBadge] = useState(() => Number(localStorage.getItem("badge-cust-admin") || 0));
  const [reportsBadge, setReportsBadge] = useState(() => Number(localStorage.getItem("badge-reports-admin") || 0));

  const { data: pendingTaskCount, refetch: refetchPendingTasks } = useQuery({
    queryKey: ["tasks-pending-count"],
    queryFn: () => api.get("/tasks/pending-count").then(r => Number(r.data.data.count) || 0),
    refetchInterval: 30000,
    initialData: 0,
  });

  useEffect(() => {
    if (!socket) return;
    const incCust = () => {
      setCustBadge(c => {
        const v = c + 1;
        localStorage.setItem("badge-cust-admin", String(v));
        return v;
      });
    };
    const incReports = () => {
      setReportsBadge(c => {
        const v = c + 1;
        localStorage.setItem("badge-reports-admin", String(v));
        return v;
      });
    };
    socket.on("customer:created", incCust);
    socket.on("customer:updated", incCust);
    socket.on("customer:created", incReports);
    socket.on("customer:updated", incReports);
    const onApptCreated = () => refetchPendingTasks();
    const onTaskApproved = () => refetchPendingTasks();
    socket.on("appointment:created", onApptCreated);
    socket.on("task:approved", onTaskApproved);
    return () => {
      socket.off("customer:created", incCust);
      socket.off("customer:updated", incCust);
      socket.off("customer:created", incReports);
      socket.off("customer:updated", incReports);
      socket.off("appointment:created", onApptCreated);
      socket.off("task:approved", onTaskApproved);
    };
  }, [socket, refetchPendingTasks]);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-cust-admin"); setCustBadge(0); };
    window.addEventListener("clear-badge-customers-admin", clear);
    return () => window.removeEventListener("clear-badge-customers-admin", clear);
  }, []);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-reports-admin"); setReportsBadge(0); };
    window.addEventListener("clear-badge-reports-admin", clear);
    return () => window.removeEventListener("clear-badge-reports-admin", clear);
  }, []);

  useEffect(() => {
    const clear = () => { refetchPendingTasks(); };
    window.addEventListener("clear-badge-tasks-admin", clear);
    return () => window.removeEventListener("clear-badge-tasks-admin", clear);
  }, [refetchPendingTasks]);

  const { data: notifData } = useQuery({ queryKey: ["notif-unread-admin"], queryFn: () => api.get("/notifications").then(r => (r.data.data || []).filter((n:any) => !n.isRead).length), refetchInterval: 30000, initialData: 0 });
  const { data: dmCount } = useQuery({ queryKey: ["dm-unread-admin"], queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0), refetchInterval: 30000, initialData: 0 });
  const { data: activityData } = useQuery({ queryKey: ["activity-feed"], queryFn: () => api.get("/messages").then(r => r.data.data || []), staleTime: 30000, initialData: [] });
  const lastSeenMessages = Number(localStorage.getItem("msg-last-seen-admin") || 0);
  const newMessages = (activityData as any[]).filter((log: any) => new Date(log.createdAt).getTime() > lastSeenMessages).length;

  const badges: Record<string, number> = {
    notifications: notifData as number,
    messaging: dmCount as number,
    messages: newMessages,
    customers: custBadge,
    reports: reportsBadge,
    tasks: pendingTaskCount as number,
  };

  return (
    <aside style={{ backgroundColor: BG }} className="w-56 text-white flex flex-col h-full flex-shrink-0">
      <div style={{ borderColor: BORDER }} className="p-4 border-b">
        <div className="flex items-center gap-2 mb-1">
          <div style={{ backgroundColor: BG_ACTIVE }} className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold">PH</div>
          <span className="text-white font-bold text-sm">Pure Home</span>
        </div>
        <p className="text-blue-200 text-xs truncate">{user?.name}</p>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {links.map(l => {
          const badge = l.badgeKey ? (badges[l.badgeKey] || 0) : 0;
          return (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? "font-medium border-e-2 border-blue-300" : "text-blue-100"}`}
              style={({ isActive }) => ({ backgroundColor: isActive ? BG_ACTIVE : undefined })}
              onMouseEnter={e => { if (!(e.currentTarget as any)._active) (e.currentTarget as HTMLElement).style.backgroundColor = BG_HOVER; }}
              onMouseLeave={e => { if (!(e.currentTarget as any)._active) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}>
              <span className="text-base flex-shrink-0">{l.icon}</span>
              <span className="flex-1">{t(l.label)}</span>
              {badge > 0 && <span className={`${BADGE} text-white text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-none`}>{badge > 99 ? "99+" : badge}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div style={{ borderColor: BORDER }} className="p-3 border-t space-y-1">
        <button onClick={() => i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")}
          style={{ backgroundColor: BG_HOVER }} className="w-full text-xs py-1.5 px-3 rounded-lg text-blue-200 hover:opacity-90">
          {i18n.language === "ar" ? "English" : "عربي"}
        </button>
        <button onClick={() => { logout(); navigate("/"); }}
          className="w-full text-xs py-1.5 px-3 rounded-lg bg-red-900/60 hover:bg-red-700 text-red-200">
          {t("auth.logout")}
        </button>
      </div>
    </aside>
  );
}
