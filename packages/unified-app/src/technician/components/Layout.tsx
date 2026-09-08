import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";
import { AppFrame } from "../../ui/AppFrame";

const titles: Record<string, string> = {
  "/technician/queue":               "nav.workQueue",
  "/technician/urgent-appointments": "nav.urgentAppointments",
  "/technician/expenses":            "nav.expenses",
  "/technician/notifications":       "nav.notifications",
  "/technician/messaging":           "nav.messaging",
  "/technician/settings":            "nav.settings",
};

const helpKeys: Record<string, string> = {
  "/technician/queue":               "technician.workQueue",
  "/technician/urgent-appointments": "technician.urgentAppointments",
  "/technician/expenses":            "technician.expenses",
  "/technician/notifications":       "technician.notifications",
  "/technician/messaging":           "technician.messaging",
  "/technician/settings":            "technician.settings",
};

export default function TechnicianLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k));
  const helpKey = titleKey ? helpKeys[titleKey] : undefined;
  const help = helpKey ? HELP[helpKey] : null;

  return (
    <AppFrame
      dept="technician"
      sidebar={<Sidebar />}
      title={titleKey ? t(titles[titleKey]) : ""}
      actions={help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
      banners={
        <>
          <ConnectionBanner getSocket={getSocket} />
          <NotificationBar role="TECHNICIAN" getSocket={getSocket} />
        </>
      }
    >
      <Outlet />
    </AppFrame>
  );
}
