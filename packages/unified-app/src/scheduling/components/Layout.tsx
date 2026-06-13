import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k));
  const helpKey = titleKey ? helpKeys[titleKey] : undefined;
  const help = helpKey ? HELP[helpKey] : null;

  return (
    <div className="h-full flex bg-slate-100 overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile, static flex child on desktop */}
      <div
        className={[
          "fixed inset-y-0 start-0 z-50 transition-transform duration-300",
          "md:relative md:inset-auto md:z-auto md:translate-x-0 md:transition-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        ].join(" ")}
      >
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="h-12 bg-white border-b flex items-center px-3 md:px-4 shadow-sm gap-2 flex-shrink-0">
          <button
            className="md:hidden flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 active:bg-slate-200 touch-manipulation"
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="font-semibold text-slate-700 text-sm md:text-base">{titleKey ? t(titles[titleKey]) : ""}</h2>
          {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
        </div>

        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="SCHEDULING" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-2 md:p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
