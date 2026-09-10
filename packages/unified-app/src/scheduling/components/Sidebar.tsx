import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import { useNotificationSound } from "../../hooks/useNotificationSound";
import { NavRail, NavRailItem } from "../../ui/NavRail";
import { useUnreadCounts } from "../../hooks/useNotifications";
import type { IconName } from "../../ui/icons";

const links: { to: string; label: string; icon: IconName; badgeKey?: string }[] = [
  { to: "/scheduling/dashboard",     label: "nav.dashboard",     icon: "dashboard", badgeKey: "apptAlerts" },
  { to: "/scheduling/customers",     label: "nav.customers",     icon: "customers", badgeKey: "customers" },
  { to: "/scheduling/customers/add", label: "customers.add",     icon: "add" },
  { to: "/scheduling/call-reports",  label: "nav.callReports",   icon: "callReports" },
  { to: "/scheduling/messages",      label: "nav.messages",      icon: "messages", badgeKey: "messages" },
  { to: "/scheduling/notifications", label: "nav.notifications", icon: "notifications", badgeKey: "notifications" },
  { to: "/scheduling/messaging",     label: "nav.messaging",     icon: "messaging", badgeKey: "messaging" },
  { to: "/scheduling/settings",      label: "nav.settings",      icon: "settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { logout } = useAuthStore();
  const navigate = useNavigate();
  const socket = useSocket();
  useNotificationSound(socket);
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

  // Server-side COUNT via the shared hook -- see the technician/admin Sidebars.
  const { data: counts } = useUnreadCounts(api, "sched");
  const { data: dmCount } = useQuery({ queryKey: ["dm-unread-sched"], queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0), refetchInterval: 30000, initialData: 0 });
  const { data: activityData } = useQuery({ queryKey: ["activity-feed-sched"], queryFn: () => api.get("/messages").then(r => r.data.data || []), staleTime: 30000, initialData: [] });
  const lastSeenMessages = Number(localStorage.getItem("msg-last-seen-sched") || 0);
  const newMessages = (activityData as any[]).filter((log: any) => new Date(log.createdAt).getTime() > lastSeenMessages).length;

  /**
   * PHASE 2 badge mapping.
   *
   * `notifications` carries the TOTAL unread count -- that destination is
   * literally the list of all of them. The appointment alerts (postponements and
   * did-not-answer reports) are badged on the Dashboard instead, because that is
   * where Scheduling reviews appointment activity: this department has no
   * appointments route of its own, and Phase 2 does not invent one.
   */
  const apptAlerts =
    (counts.byType.APPOINTMENT_POSTPONED || 0) + (counts.byType.APPOINTMENT_NO_ANSWER || 0);

  const badges: Record<string, number> = {
    notifications: counts.total,
    apptAlerts,
    messaging: dmCount as number,
    messages: newMessages,
    customers: custBadge
  };

  const items: NavRailItem[] = links.map((l) => {
    const badge = l.badgeKey ? badges[l.badgeKey] || 0 : 0;
    return {
      to: l.to,
      label: l.label,
      icon: l.icon,
      badge,
      badgeLabel: badge
        ? t(l.badgeKey === "apptAlerts" ? "alerts.unreadAppointments" : "alerts.unreadCount", { count: badge })
        : undefined,
    };
  });

  return (
    <NavRail
      items={items}
      department={t("dept.schedulingFull")}
      onLogout={() => { logout(); navigate("/"); }}
    />
  );
}
