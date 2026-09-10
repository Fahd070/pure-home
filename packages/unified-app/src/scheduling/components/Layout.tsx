import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";
import { api } from "../api/client";
import CriticalAlerts from "../../components/CriticalAlerts";
import { AppFrame } from "../../ui/AppFrame";

// Ordered longest-prefix-first: "/scheduling/customers/add" must match before
// "/scheduling/customers".
const titles: Record<string, string> = {
  "/scheduling/dashboard":     "nav.dashboard",
  "/scheduling/customers/add": "customers.add",
  "/scheduling/customers":     "nav.customers",
  "/scheduling/call-reports":  "nav.callReports",
  "/scheduling/messages":      "nav.messages",
  "/scheduling/notifications":  "nav.notifications",
  "/scheduling/messaging":     "nav.messaging",
  "/scheduling/settings":      "nav.settings",
};

const helpKeys: Record<string, string> = {
  "/scheduling/dashboard":     "scheduling.dashboard",
  "/scheduling/customers/add": "scheduling.addCustomer",
  "/scheduling/customers":     "scheduling.customers",
  "/scheduling/call-reports":  "scheduling.callReports",
  "/scheduling/messages":      "scheduling.messages",
  "/scheduling/notifications":  "scheduling.notifications",
  "/scheduling/messaging":     "scheduling.messaging",
  "/scheduling/settings":      "scheduling.settings",
};

export default function SchedulingLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k));
  const helpKey = titleKey ? helpKeys[titleKey] : undefined;
  const help = helpKey ? HELP[helpKey] : null;

  return (
    <AppFrame
      dept="scheduling"
      sidebar={<Sidebar />}
      title={titleKey ? t(titles[titleKey]) : ""}
      actions={help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
      banners={
        <>
          <ConnectionBanner getSocket={getSocket} />
          <NotificationBar role="SCHEDULING" getSocket={getSocket} />
        </>
      }
      /* LEVEL 3: the centred critical alert. Mounted in the shell -- not on any
         one page -- so an unread critical notification is surfaced on arrival,
         on login and on reload regardless of which screen is open. */
      overlays={<CriticalAlerts api={api} scope="sched" getSocket={getSocket} />}
    >
      <Outlet />
    </AppFrame>
  );
}
