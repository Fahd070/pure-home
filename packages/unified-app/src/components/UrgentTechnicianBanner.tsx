import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AxiosInstance } from "axios";
import { Icon } from "../ui/icons";
import { resolveNotificationText } from "../utils/notificationText";
import { useMarkNotificationRead, useUnreadCritical } from "../hooks/useNotifications";
import { notificationRoute } from "./CriticalAlerts";

/**
 * LEVEL 2 of the Phase 2 alert model: the technician urgent banner.
 *
 * Technician-only, and driven by the same durable notification rows as the
 * badge and the centred alert -- so acknowledging an urgent visit in any one of
 * those three places clears it in the other two, with no third copy of "has
 * this been seen?" to fall out of sync.
 *
 * It renders inside AppFrame's `banners` slot, which sits BELOW the command bar
 * and above the scrolling content, so it can never cover the menu button or the
 * navigation rail on a phone. It is part of the normal document flow rather than
 * an overlay, so it also cannot introduce horizontal overflow.
 *
 * Distinct from `NotificationBar`, which is a transient 4-second toast for live
 * socket activity. This one persists until it is actually dealt with.
 */
export default function UrgentTechnicianBanner({ api }: { api: AxiosInstance }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: critical } = useUnreadCritical(api, "tech");
  const markRead = useMarkNotificationRead(api, "tech");

  const urgent = (critical || []).filter((n) => !n.isRead && n.type === "URGENT_APPOINTMENT_ASSIGNED");
  // Only ONE banner, never a stack: the newest unread urgent assignment, with a
  // plain "+N more" count for the rest. The others remain reachable through the
  // centred alert queue and the Urgent Appointments screen, so nothing is lost
  // by not painting them all here.
  const current = urgent[0];
  if (!current) return null;
  const extra = urgent.length - 1;

  const open = () => {
    const to = notificationRoute("tech", current);
    // Acknowledge and go. Navigation is not made to wait on the PATCH -- the
    // technician should reach urgent work immediately -- and if the write fails
    // the row simply stays unread, so the banner returns rather than the alert
    // being silently lost.
    markRead.mutate(current.id);
    navigate(to);
  };

  return (
    <div
      // `role="alert"` so it is announced when it appears, not only when focused.
      role="alert"
      className="flex-shrink-0 border-b border-danger-border bg-danger-bg px-3 lg:px-4 py-2"
    >
      <div className="max-w-[1400px] mx-auto flex items-center gap-2.5 min-w-0">
        <span
          className="w-6 h-6 rounded-full bg-danger-solid text-white flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          <Icon name="urgent" className="w-3.5 h-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-semibold text-danger-fg leading-tight truncate">
            {resolveNotificationText(current, "title", i18n.language)}
          </p>
          <p className="text-2xs text-danger-fg/80 leading-tight truncate">
            {resolveNotificationText(current, "body", i18n.language)}
            {extra > 0 && <span className="ms-1.5 font-medium">{t("alerts.plusMore", { count: extra })}</span>}
          </p>
        </div>

        <button
          type="button"
          onClick={open}
          className="flex-shrink-0 h-7 px-2.5 rounded-md text-2xs font-semibold bg-danger-solid text-white hover:brightness-110 active:brightness-95 transition-[filter]"
        >
          {t("alerts.viewAppointment")}
        </button>
      </div>
    </div>
  );
}
