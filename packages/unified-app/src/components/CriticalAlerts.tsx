import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AxiosInstance } from "axios";
import type { Socket } from "socket.io-client";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons";
import { cx } from "../ui/cx";
import { resolveNotificationText } from "../utils/notificationText";
import {
  NotificationRow, NotifScope, useMarkNotificationRead, useNotificationRealtime, useUnreadCritical,
} from "../hooks/useNotifications";

/**
 * LEVEL 3 of the Phase 2 alert model: the centred critical alert.
 *
 * Backed entirely by durable server state -- a notification row is shown while
 * it is unread, and stops being shown once the server confirms it read. Nothing
 * here is remembered in localStorage, because "have I dealt with this?" must
 * survive a different device and must not be answerable by clearing site data.
 */

/**
 * Where a notification's "View" action leads.
 *
 * Uses only routes that already exist (see App.tsx). Technicians get the actual
 * work item; Administration and Scheduling have list screens rather than a
 * per-appointment route, so they land on the screen that shows the appointment.
 *
 * Navigating here grants nothing: the destination re-authorizes on its own, so
 * an appointment the recipient may no longer open still fails there exactly as
 * it would if they had typed the URL. `entityId` is a pointer, never a
 * permission.
 */
export function notificationRoute(scope: NotifScope, n: NotificationRow): string {
  if (scope === "tech") {
    if (n.type === "URGENT_APPOINTMENT_ASSIGNED") return "/technician/urgent-appointments";
    return n.entityId ? `/technician/queue/${n.entityId}` : "/technician/queue";
  }
  if (scope === "admin") return "/admin/appointments";
  // Scheduling has no appointments screen of its own; its dashboard is where
  // appointment activity is reviewed.
  return "/scheduling/dashboard";
}

interface Props {
  api: AxiosInstance;
  scope: NotifScope;
  /** Accessor, not a socket -- see `useNotificationRealtime`. */
  getSocket: () => Socket | null;
}

export default function CriticalAlerts({ api, scope, getSocket }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: critical } = useUnreadCritical(api, scope);
  const markRead = useMarkNotificationRead(api, scope);
  useNotificationRealtime(getSocket, scope);

  /**
   * Notifications already dealt with in THIS session.
   *
   * Two different things put an id in here, and the distinction matters:
   *   - the server confirmed it read (acknowledged, or opened via View)
   *   - the operator closed the dialog without acknowledging
   *
   * Either way it must not immediately pop open again, which is what would
   * otherwise happen on the very next render: the row is still unread, so it is
   * still in the queue. A dismissed-but-unacknowledged alert deliberately stays
   * unread -- it keeps its badge and it returns on the next reload, because
   * closing a window is not the same as having handled the thing it warned
   * about.
   *
   * Nothing in here can ever hide an alert the server still considers unread
   * ACROSS sessions, and a failed acknowledgement never reaches this set.
   */
  const [handled, setHandled] = useState<string[]>([]);
  /**
   * Which notification the visible failure notice belongs to, or null.
   *
   * Deliberately the ID rather than a boolean: a failed acknowledgement followed
   * by "Later" advances the queue, and a bare flag would keep showing "could not
   * save your acknowledgement" against the NEXT alert -- one that was never even
   * submitted.
   */
  const [failedId, setFailedId] = useState<string | null>(null);

  const queue = useMemo(
    () => (critical || []).filter((n) => !n.isRead && !handled.includes(n.id)),
    [critical, handled]
  );
  // One at a time. The rest wait; acknowledging this one reveals the next.
  const current = queue[0];
  const remaining = queue.length - 1;

  if (!current) return null;

  const title = resolveNotificationText(current, "title", i18n.language);
  const body = resolveNotificationText(current, "body", i18n.language);

  const handle = (n: NotificationRow, thenNavigate: boolean) => {
    setFailedId(null);
    markRead.mutate(n.id, {
      onSuccess: () => {
        setHandled((prev) => [...prev, n.id]);
        if (thenNavigate) navigate(notificationRoute(scope, n));
      },
      // The alert deliberately stays on screen. Reporting success we did not
      // get would mean the operator believes this is handled while the server
      // still has it unread -- and it would silently return later.
      onError: () => setFailedId(n.id),
    });
  };

  return (
    <Modal
      open
      // Closing without acknowledging: allowed, and consistent with every other
      // dialog in the product, but it does not mark anything read.
      onClose={() => setHandled((prev) => [...prev, current.id])}
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-danger-solid text-white flex items-center justify-center flex-shrink-0" aria-hidden="true">
            <Icon name="urgent" className="w-3.5 h-3.5" />
          </span>
          <span className="text-danger-fg">{title}</span>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => setHandled((prev) => [...prev, current.id])}>
            {t("alerts.later")}
          </Button>
          <Button variant="secondary" onClick={() => handle(current, false)} loading={markRead.isPending}>
            {t("alerts.acknowledge")}
          </Button>
          <Button variant="danger" onClick={() => handle(current, true)} loading={markRead.isPending}>
            {t("alerts.viewAppointment")}
          </Button>
        </>
      }
    >
      <p className="text-[0.8125rem] text-fg-secondary leading-relaxed">{body}</p>

      {remaining > 0 && (
        <p className="text-2xs text-fg-muted mt-3">{t("alerts.moreWaiting", { count: remaining })}</p>
      )}

      {failedId === current.id && (
        <p role="alert" className={cx("text-2xs mt-3 rounded-md px-2.5 py-2", "bg-danger-bg text-danger-fg border border-danger-border")}>
          {t("alerts.ackFailed")}
        </p>
      )}
    </Modal>
  );
}
