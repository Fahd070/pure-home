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
  const n = parseInt((hex || '#000080').replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + offset));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + offset));
  const b = Math.min(255, Math.max(0, (n & 0xff) + offset));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

const BADGE = "bg-red-500";

const links = [
  { to: "/admin/dashboard",             label: "nav.dashboard",            icon: "⊞" },
  { to: "/admin/customers",             label: "nav.customers",            icon: "👥", badgeKey: "customers" },
  { to: "/admin/reports",               label: "nav.reports",              icon: "📊", badgeKey: "reports" },
  { to: "/admin/appointments",          label: "nav.appointments",         icon: "📅" },
  { to: "/admin/urgent-appointments",   label: "nav.urgentAppointments",   icon: "🚨", badgeKey: "urgentAppts" },
  { to: "/admin/tasks",                 label: "nav.tasks",                icon: "✓",  badgeKey: "tasks" },
  { to: "/admin/technicians",           label: "nav.technicians",          icon: "🔧" },
  { to: "/admin/call-reports",          label: "nav.callReports",          icon: "📞", badgeKey: "callReports" },
  { to: "/admin/expenses",              label: "nav.expenses",             icon: "💰", badgeKey: "expenses" },
  { to: "/admin/messages",              label: "nav.messages",             icon: "📋", badgeKey: "messages" },
  { to: "/admin/notifications",         label: "nav.notifications",        icon: "🔔", badgeKey: "notifications" },
  { to: "/admin/messaging",             label: "nav.messaging",            icon: "💬", badgeKey: "messaging" },
  { to: "/admin/access-codes",          label: "nav.accessCodes",          icon: "🔑" },
  { to: "/admin/settings",              label: "nav.settings",             icon: "⚙️" },
];

export default function Sidebar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  useNotificationSound(socket);
  const { settings } = useSettingsStore();
  const BG = settings.primaryColor || "#000080";
  const BG_HOVER = colorAdjust(BG, -14);
  const BG_ACTIVE = colorAdjust(BG, 50);
  const BORDER = BG_HOVER;
  const [custBadge, setCustBadge] = useState(() => Number(localStorage.getItem("badge-cust-admin") || 0));
  const [reportsBadge, setReportsBadge] = useState(() => Number(localStorage.getItem("badge-reports-admin") || 0));
  const [urgentBadge, setUrgentBadge] = useState(() => Number(localStorage.getItem("badge-urgent-admin") || 0));
  const [expenseBadge, setExpenseBadge] = useState(() => Number(localStorage.getItem("badge-expenses-admin") || 0));
  const [callReportsBadge, setCallReportsBadge] = useState(() => Number(localStorage.getItem("badge-callreports-admin") || 0));

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
    const incUrgent = () => setUrgentBadge(c => { const v = c + 1; localStorage.setItem("badge-urgent-admin", String(v)); return v; });
    const incExpense = () => setExpenseBadge(c => { const v = c + 1; localStorage.setItem("badge-expenses-admin", String(v)); return v; });
    const incCallReports = () => setCallReportsBadge(c => { const v = c + 1; localStorage.setItem("badge-callreports-admin", String(v)); return v; });
    const onApptCreated = () => refetchPendingTasks();
    const onTaskApproved = () => refetchPendingTasks();
    socket.on("appointment:created", onApptCreated);
    socket.on("task:approved", onTaskApproved);
    socket.on("urgent_visit:submitted", incUrgent);
    socket.on("expense:new", incExpense);
    socket.on("call_report:new", incCallReports);
    return () => {
      socket.off("customer:created", incCust);
      socket.off("customer:updated", incCust);
      socket.off("customer:created", incReports);
      socket.off("customer:updated", incReports);
      socket.off("appointment:created", onApptCreated);
      socket.off("task:approved", onTaskApproved);
      socket.off("urgent_visit:submitted", incUrgent);
      socket.off("expense:new", incExpense);
      socket.off("call_report:new", incCallReports);
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

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-urgent-admin"); setUrgentBadge(0); };
    window.addEventListener("clear-badge-urgent-admin", clear);
    return () => window.removeEventListener("clear-badge-urgent-admin", clear);
  }, []);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-expenses-admin"); setExpenseBadge(0); };
    window.addEventListener("clear-badge-expenses-admin", clear);
    return () => window.removeEventListener("clear-badge-expenses-admin", clear);
  }, []);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-callreports-admin"); setCallReportsBadge(0); };
    window.addEventListener("clear-badge-callreports-admin", clear);
    return () => window.removeEventListener("clear-badge-callreports-admin", clear);
  }, []);

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
    urgentAppts: urgentBadge,
    expenses: expenseBadge,
    callReports: callReportsBadge,
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
        <a
          href="https://wa.me/966501698445"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-2.5 text-sm text-blue-100 transition-colors"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = BG_HOVER; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}>
          <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: "#25D366" }}>
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.556 4.122 1.527 5.853L0 24l6.335-1.652A11.93 11.93 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.806 9.806 0 01-5.003-1.374l-.36-.214-3.72.975.99-3.618-.234-.372A9.82 9.82 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
            </svg>
          </span>
          <span className="flex-1">{t("nav.reportIssue")}</span>
        </a>
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
