import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { useLogout } from "../../hooks/useLogout";
import { api } from "../api/client";
import { useSocket } from "../hooks/useSocket";
import { useNotificationSound } from "../../hooks/useNotificationSound";
import { NavRail, NavRailItem } from "../../ui/NavRail";
import { useUnreadCounts } from "../../hooks/useNotifications";
import type { IconName } from "../../ui/icons";

const links: { to: string; label: string; icon: IconName; badgeKey?: string }[] = [
  { to: "/technician/queue",               label: "nav.workQueue",          icon: "queue",         badgeKey: "queue" },
  { to: "/technician/urgent-appointments", label: "nav.urgentAppointments", icon: "urgent",        badgeKey: "urgentAppts" },
  { to: "/technician/expenses",            label: "nav.expenses",           icon: "expenses" },
  { to: "/technician/notifications",       label: "nav.notifications",      icon: "notifications", badgeKey: "notifications" },
  { to: "/technician/messaging",           label: "nav.messaging",          icon: "messaging",     badgeKey: "messaging" },
  { to: "/technician/settings",            label: "nav.settings",           icon: "settings" },
];

export default function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const logout = useLogout();
  const navigate = useNavigate();
  const socket = useSocket();
  useNotificationSound(socket);
  const [queueBadge, setQueueBadge] = useState(() => Number(localStorage.getItem("badge-queue-tech") || 0));

  // Urgent badge: derived from actual unresolved urgent work (isUrgent
  // appointments with no urgentVisitRecord submitted yet) -- NOT a localStorage
  // increment/clear counter, so it survives refresh/restart and never disappears
  // just because the page was opened.
  // Perf fix: previously fetched every urgent appointment's full relation
  // graph (customer+address, technician, postponements, urgentVisitRecord)
  // via GET /appointments?urgent=true just to compute this length client-side
  // -- now a single server-side COUNT with the identical unresolved/visibility
  // semantics (see routes/appointments.ts's urgent-unresolved-count).
  const { data: urgentBadge, refetch: refetchUrgentBadge } = useQuery({
    queryKey: ["urgent-unresolved-tech"],
    queryFn: () => api.get("/appointments/urgent-unresolved-count").then(r => Number(r.data.data) || 0),
    refetchInterval: 30000,
    initialData: 0,
  });

  useEffect(() => {
    if (!socket) return;
    const incQueue = () => setQueueBadge(c => { const v = c + 1; localStorage.setItem("badge-queue-tech", String(v)); return v; });
    const onApptCreated = (a: any) => { if (!a?.isUrgent) incQueue(); };
    socket.on("appointment:created", onApptCreated);
    // Urgent count changes: a new urgent appointment (created) or this
    // technician's own completion (urgent_visit:submitted, which resolves
    // one) -- refetch the real count rather than incrementing/decrementing a
    // local guess.
    socket.on("appointment:created", refetchUrgentBadge);
    socket.on("appointment:deleted", refetchUrgentBadge);
    socket.on("urgent_visit:submitted", refetchUrgentBadge);
    return () => {
      socket.off("appointment:created", onApptCreated);
      socket.off("appointment:created", refetchUrgentBadge);
      socket.off("appointment:deleted", refetchUrgentBadge);
      socket.off("urgent_visit:submitted", refetchUrgentBadge);
    };
  }, [socket, refetchUrgentBadge]);

  useEffect(() => {
    const clear = () => { localStorage.removeItem("badge-queue-tech"); setQueueBadge(0); };
    window.addEventListener("clear-badge-queue-tech", clear);
    return () => window.removeEventListener("clear-badge-queue-tech", clear);
  }, []);

  // Unread counts now come from the server's COUNT endpoint through the shared
  // hook, instead of downloading up to 50 notification rows on a 30s timer only
  // to measure the length of a filtered array in the browser.
  const { data: counts } = useUnreadCounts(api, "tech");
  const { data: dmCount } = useQuery({ queryKey: ["dm-unread-tech"], queryFn: () => api.get("/direct-messages/unread-count").then(r => Number(r.data.data) || 0), refetchInterval: 30000, initialData: 0 });

  const badges: Record<string, number> = {
    notifications: counts.total,
    messaging: dmCount as number,
    queue: queueBadge,
    urgentAppts: urgentBadge as number,
  };

  const items: NavRailItem[] = links.map((l) => {
    const badge = l.badgeKey ? badges[l.badgeKey] || 0 : 0;
    return {
      to: l.to,
      label: l.label,
      icon: l.icon,
      badge,
      // The accessible name says what the number counts. "urgentAppts" is
      // outstanding urgent WORK (Phase 1), not unread notifications, so it gets
      // its own wording rather than the notification one.
      badgeLabel: badge
        ? t(l.badgeKey === "urgentAppts" ? "alerts.unreadUrgent" : "alerts.unreadCount", { count: badge })
        : undefined,
    };
  });

  return (
    <NavRail
      items={items}
      department={t("dept.technicianFull")}
      // Requirement #12: the technician's real, current name -- never
      // "Technician 1". It comes from the authenticated session, so renaming the
      // employee in Administration changes it here on their next sign-in.
      employeeName={user?.name}
      onLogout={logout}
    />
  );
}
