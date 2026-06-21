import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";

const DEPT_COLOR = "#014245";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    document.documentElement.style.setProperty("--color-primary", DEPT_COLOR);
  }, []);

  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k));
  const helpKey = titleKey ? helpKeys[titleKey] : undefined;
  const help = helpKey ? HELP[helpKey] : null;

  return (
    <div className="h-full flex bg-slate-100 overflow-hidden" data-dept="technician">
      {/* Mobile/tablet backdrop — hidden on desktop (lg+) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fixed drawer on mobile/tablet, static flex child on desktop (lg+) */}
      <div
        className={[
          "fixed inset-y-0 start-0 z-50 transition-transform duration-300",
          "lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 lg:rtl:translate-x-0 lg:transition-none",
          sidebarOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
        ].join(" ")}
      >
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div
          className="h-12 border-b flex items-center px-3 lg:px-4 shadow-sm gap-2 flex-shrink-0"
          style={{ backgroundColor: DEPT_COLOR, borderBottomColor: "rgba(255,255,255,0.15)" }}
        >
          <button
            className="lg:hidden flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg touch-manipulation"
            style={{ color: "rgba(255,255,255,0.9)" }}
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.15)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="font-semibold text-white text-sm lg:text-base flex-1 min-w-0 truncate">{titleKey ? t(titles[titleKey]) : ""}</h2>
          {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
        </div>

        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="TECHNICIAN" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-3 lg:p-5">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
