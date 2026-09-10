import React, { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSocket } from "../hooks/useSocket";
import { api } from "../api/client";
import { formatGregorianDate } from "../../utils/dateTimeInput";
import { PageHeader } from "../../ui/Surface";
import { Button } from "../../ui/Button";
import { EmptyState, Loading } from "../../ui/Feedback";
import { Icon } from "../../ui/icons";
import { cx } from "../../ui/cx";
import { resolveNotificationText } from "../../utils/notificationText";

function cleanBody(body: string): string {
  return body.replace(/\s*\[[\w:.\\-]+\]\s*$/, "").trim();
}
function formatTime(d: string, lang: string): string {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const isAr = lang === "ar";
  if (diff < 60000) return isAr ? "الآن" : "Just now";
  const mins = Math.floor(diff / 60000);
  if (diff < 3600000) return isAr ? `${mins} د` : `${mins}m ago`;
  const hrs = Math.floor(diff / 3600000);
  if (diff < 86400000) return isAr ? `${hrs} س` : `${hrs}h ago`;
  return formatGregorianDate(date);
}

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const socket = useSocket();
  const { data, isLoading } = useQuery({ queryKey: ["notifications-sched"], queryFn: () => api.get("/notifications").then(r => r.data.data) });
  // Reused unchanged -- the existing manual "Mark all read" action (kept below
  // as a fallback for a failed auto-mark or a notification that arrives after
  // it). Also invalidates the sidebar's own unread-count query (notif-unread-sched)
  // so the red badge clears immediately, not just on its next 30s poll.
  const markAll = useMutation({
    mutationFn: () => api.patch("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-sched"] });
      qc.invalidateQueries({ queryKey: ["notif-unread-sched"] });
    },
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.patch("/notifications/" + id + "/read"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-sched"] });
      qc.invalidateQueries({ queryKey: ["notif-unread-sched"] });
    },
  });
  useEffect(() => {
    if (!socket) return;
    // The handler is named and removed BY REFERENCE. `socket.off(event)` with no
    // handler removes EVERY listener for that event, and this socket is a
    // module-level singleton shared with the application shell -- so the blanket
    // form also tore off CriticalAlerts' listener when this page unmounted,
    // silently downgrading every critical alert and nav badge in the session to
    // polling with no way to re-attach.
    const onNew = () => qc.invalidateQueries({ queryKey: ["notifications-sched"] });
    socket.on("notification:new", onNew);
    return () => { socket.off("notification:new", onNew); };
  }, [socket, qc]);
  // Read-on-open fix: "entering the section" = this page mounting (the user
  // actually navigated here). Reuses the exact same PATCH /notifications/read-all
  // endpoint the manual button already called -- no new backend logic, no new
  // read-state storage. Re-fires if a genuinely new unread notification arrives
  // (via the socket handler above) while the page is still open, which is the
  // desired behavior: the user can already see it on screen.
  useEffect(() => {
    if (data && data.some((n: any) => !n.isRead)) {
      markAll.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const unread = (data || []).filter((n: any) => !n.isRead).length;
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title={t("notifications.maintenanceReminders")}
        subtitle={t("notifications.upcomingNotice")}
        actions={
          unread > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => markAll.mutate()}>
              <Icon name="check" className="w-3.5 h-3.5" />
              {t("notifications.markAllRead")}
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <Loading label={t("common.loading")} />
      ) : !data?.length ? (
        <div className="bg-surface border border-line rounded-md">
          <EmptyState
            icon={<Icon name="notifications" className="w-5 h-5" />}
            title={t("notifications.noReminders")}
            description={t("notifications.remindersInfo")}
          />
        </div>
      ) : (
        <ul className="bg-surface border border-line rounded-md divide-y divide-line-subtle overflow-hidden">
          {(data || []).map((n: any) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => !n.isRead && markOne.mutate(n.id)}
                disabled={n.isRead}
                aria-label={resolveNotificationText(n, "title", i18n.language)}
                className={cx(
                  "relative w-full text-start ps-4 pe-3 py-3 flex items-start gap-3 transition-colors",
                  n.isRead ? "cursor-default" : "hover:bg-surface-hover active:bg-surface-active"
                )}
              >
                {/* Unread is marked by an accent rail rather than a coloured
                    card, so a long list stays scannable instead of striped. */}
                {!n.isRead && (
                  <span className="absolute inset-y-0 start-0 w-0.5 bg-accent" aria-hidden="true" />
                )}

                <span
                  className={cx(
                    "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5",
                    n.isRead
                      ? "bg-surface-subtle text-fg-muted"
                      : "bg-accent-subtle text-accent-subtlefg"
                  )}
                  aria-hidden="true"
                >
                  <Icon name="notifications" className="w-4 h-4" />
                </span>

                <div className="flex-1 min-w-0">
                  <p className={cx("text-[0.8125rem]", n.isRead ? "text-fg-secondary" : "font-semibold text-fg")}>
                    {resolveNotificationText(n, "title", i18n.language)}
                  </p>
                  <p className="text-xs text-fg-secondary mt-0.5">{cleanBody(resolveNotificationText(n, "body", i18n.language))}</p>
                  <p className="text-2xs text-fg-muted mt-1 tabular-nums">{formatTime(n.createdAt, i18n.language)}</p>
                </div>

                {!n.isRead && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 flex-shrink-0" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
