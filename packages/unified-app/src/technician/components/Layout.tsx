import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";

const titles: Record<string, string> = {
  "/technician/queue":               "nav.workQueue",
  "/technician/urgent-appointments": "nav.urgentAppointments",
  "/technician/expenses":            "nav.expenses",
  "/technician/messages":            "nav.messages",
  "/technician/notifications":       "nav.notifications",
  "/technician/messaging":           "nav.messaging",
  "/technician/settings":            "nav.settings",
};

const helpKeys: Record<string, string> = {
  "/technician/queue":               "technician.workQueue",
  "/technician/urgent-appointments": "technician.urgentAppointments",
  "/technician/expenses":            "technician.expenses",
  "/technician/messages":            "technician.messages",
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
    <div className="h-full flex bg-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-12 bg-white border-b flex items-center px-4 shadow-sm gap-2">
          <h2 className="font-semibold text-slate-700">{titleKey ? t(titles[titleKey]) : ""}</h2>
          {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
        </div>
        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="TECHNICIAN" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-4"><Outlet /></main>
      </div>
    </div>
  );
}