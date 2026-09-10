import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import { useNotificationSound } from "../../hooks/useNotificationSound";
import { NavRail, NavRailItem } from "../../ui/NavRail";
import type { IconName } from "../../ui/icons";

type Entry =
  | { to: string; label: string; icon: IconName; badgeKey?: string }
  | { kind: "external"; href: string; label: string };

const links: Entry[] = [
  { to: "/admin/dashboard",              label: "nav.dashboard",             icon: "dashboard" },
  { to: "/admin/customers",              label: "nav.customers",             icon: "customers",    badgeKey: "customers" },
  { to: "/admin/reports",                label: "nav.reports",               icon: "reports",      badgeKey: "reports" },
  { to: "/admin/appointments",           label: "nav.appointments",          icon: "appointments" },
  { to: "/admin/appointment-acceptance", label: "nav.appointmentAcceptance", icon: "acceptance" },
  { to: "/admin/urgent-appointments",    label: "nav.urgentAppointments",    icon: "urgent",       badgeKey: "urgentAppts" },
  { to: "/admin/technicians",            label: "nav.technicians",           icon: "technicians" },
  { to: "/admin/call-reports",           label: "nav.callReports",           icon: "callReports",  badgeKey: "callReports" },
  { to: "/admin/expenses",               label: "nav.expenses",              icon: "expenses",     badgeKey: "expenses" },
  { to: "/admin/messages",               label: "nav.messages",              icon: "messages",     badgeKey: "messages" },
  { to: "/admin/notifications",          label: "nav.notifications",         icon: "notifications", badgeKey: "notifications" },
  { kind: "external", href: "https://wa.me/966501698445", label: "nav.reportIssue" },
  { to: "/admin/messaging",              label: "nav.messaging",             icon: "messaging",    badgeKey: "messaging" },
  { to: "/admin/employees",              label: "nav.employees",             icon: "technicians" },
  { to: "/admin/access-codes",           label: "nav.accessCodes",           icon: "accessCodes" },
  { to: "/admin/settings",               label: "nav.settings",              icon: "settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  useNotificationSound(socket);
  const [custBadge, setCustBadge] = useState(() => Number(localStorage.getItem("badge-cust-admin") || 0));
  const [reportsBadge, setReportsBadge] = useState(() => Number(localStorage.getItem("badge-reports-admin") || 0));
  const [expenseBadge, setExpenseBadge] = useState(() => Number(localStorage.getItem("badge-expenses-admin") || 0));
  const [callReportsBadge, setCallReportsBadge] = useState(() => Number(localStorage.getItem("badge-callreports-admin") || 0));

  const { data: dmCount } = useQuery({
    queryKey: ["dm-unread-admin"],
    queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0),
    refetchInterval: 30000,
    initialData: 0,
  });

  // Urgent badge: derived from actual unresolved urgent work (isUrgent
  // appointments with no urgentVisitRecord submitted yet) -- NOT a localStorage
  // increment/clear counter, so it survives refresh/restart and never disappears
  // just because the page was opened. Same DB-derived pattern as notif/dm-unread
  // below. Refetched on the socket events that can change the count, with a
  // 30s poll as a fallback (matches the other DB-derived badges here).
  // Perf fix: previously fetched every urgent appointment's full relation
  // graph (customer+address, technician, postponements, urgentVisitRecord)
  // via GET /appointments?urgent=true just to compute this length client-side
  // -- now a single server-side COUNT with the identical unresolved/visibility
  // semantics (see routes/appointments.ts's urgent-unresolved-count).
  const { data: urgentBadge, refetch: refetchUrgentBadge } = useQuery({
    queryKey: ["urgent-unresolved-admin"],
    queryFn: () => api.get("/appointments/urgent-unresolved-count").then(r => Number(r.data.data) || 0),
    refetchInterval: 30000,
    initialData: 0,
  });

  useEffect(() => {
    if (!socket) return;
    const incCust = () => setCustBadge(c => { const v = c + 1; localStorage.setItem("badge-cust-admin", String(v)); return v; });
    const incReports = () => setReportsBadge(c => { const v = c + 1; localStorage.setItem("badge-reports-admin", String(v)); return v; });
    const incExpense = () => setExpenseBadge(c => { const v = c + 1; localStorage.setItem("badge-expenses-admin", String(v)); return v; });
    const incCallReports = () => setCallReportsBadge(c => { const v = c + 1; localStorage.setItem("badge-callreports-admin", String(v)); return v; });
    socket.on("customer:created", incCust);
    socket.on("customer:updated", incCust);
    socket.on("customer:created", incReports);
    socket.on("customer:updated", incReports);
    socket.on("expense:new", incExpense);
    socket.on("call_report:new", incCallReports);
    // Urgent count changes: a new urgent appointment (created) or a
    // Technician's completion (urgent_visit:submitted, which resolves one) --
    // refetch the real count rather than incrementing/decrementing a local
    // guess, so it always matches actual unresolved DB state.
    socket.on("appointment:created", refetchUrgentBadge);
    socket.on("appointment:deleted", refetchUrgentBadge);
    socket.on("urgent_visit:submitted", refetchUrgentBadge);
    return () => {
      socket.off("customer:created", incCust);
      socket.off("customer:updated", incCust);
      socket.off("customer:created", incReports);
      socket.off("customer:updated", incReports);
      socket.off("expense:new", incExpense);
      socket.off("call_report:new", incCallReports);
      socket.off("appointment:created", refetchUrgentBadge);
      socket.off("appointment:deleted", refetchUrgentBadge);
      socket.off("urgent_visit:submitted", refetchUrgentBadge);
    };
  }, [socket, refetchUrgentBadge]);

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
  // Shares the ["activity-feed"] cache entry with admin/pages/Messages.tsx (the
  // System Activity page), which also reads GET /messages under the same key --
  // both MUST resolve to the identical response shape ({ data, meta }), or
  // whichever one populates the cache first (this Sidebar mounts on every admin
  // route, so it usually wins) silently corrupts what the other reads. This
  // previously returned a bare array here while Messages.tsx expected
  // `{ data: [...], meta: { total } }` and read `.data`, so `.data` on this
  // array was `undefined` -- Messages.tsx rendered its "no activity" empty
  // state despite real audit log entries existing on the server.
  const { data: activityData } = useQuery({
    queryKey: ["activity-feed"],
    queryFn: () => api.get("/messages").then(r => r.data),
    staleTime: 30000,
    initialData: { data: [], meta: { total: 0 } },
  });
  const lastSeenMessages = Number(localStorage.getItem("msg-last-seen-admin") || 0);
  const newMessages = ((activityData?.data || []) as any[]).filter((log: any) => new Date(log.createdAt).getTime() > lastSeenMessages).length;

  const badges: Record<string, number> = {
    notifications: notifData as number,
    messaging: dmCount as number,
    messages: newMessages,
    customers: custBadge,
    reports: reportsBadge,
    urgentAppts: urgentBadge as number,
    expenses: expenseBadge,
    callReports: callReportsBadge,
  };

  const items: NavRailItem[] = links.map((l) =>
    "kind" in l
      ? { kind: "external", href: l.href, label: l.label }
      : { to: l.to, label: l.label, icon: l.icon, badge: l.badgeKey ? badges[l.badgeKey] || 0 : 0 }
  );

  return (
    <NavRail
      items={items}
      department={t("dept.adminFull")}
      onLogout={() => { logout(); navigate("/"); }}
    />
  );
}
