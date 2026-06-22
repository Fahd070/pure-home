import React, { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";
import { getSocket } from "../hooks/useSocket";
import { useSettingsStore } from "../../store/settingsStore";

const titles: Record<string, string> = {
  "/admin/dashboard":            "nav.dashboard",
  "/admin/customers/add":        "nav.customers",
  "/admin/customers":            "nav.customers",
  "/admin/appointments":         "nav.appointments",
  "/admin/urgent-appointments":  "nav.urgentAppointments",
  "/admin/technicians":          "nav.technicians",
  "/admin/expenses":             "nav.expenses",
  "/admin/messages":             "nav.messages",
  "/admin/notifications":        "nav.notifications",
  "/admin/messaging":            "nav.messaging",
  "/admin/reports":              "nav.reports",
  "/admin/call-reports":         "nav.callReports",
  "/admin/access-codes":         "nav.accessCodes",
  "/admin/settings":             "nav.settings",
};

const helpKeys: Record<string, string> = {
  "/admin/dashboard":            "admin.dashboard",
  "/admin/customers/add":        "admin.addCustomer",
  "/admin/customers":            "admin.customers",
  "/admin/appointments":         "admin.appointments",
  "/admin/urgent-appointments":  "admin.urgentAppointments",
  "/admin/technicians":          "admin.technicians",
  "/admin/expenses":             "admin.expenses",
  "/admin/messages":             "admin.messages",
  "/admin/notifications":        "admin.notifications",
  "/admin/messaging":            "admin.messaging",
  "/admin/reports":              "admin.reports",
  "/admin/call-reports":         "admin.callReports",
  "/admin/access-codes":         "admin.accessCodes",
  "/admin/settings":             "admin.settings",
};

export default function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { settings } = useSettingsStore();
  const headerColor = settings.primaryColor || "#0A0A2E";

  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    document.documentElement.style.setProperty("--color-primary", headerColor);
  }, [headerColor]);

  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k)) || "/admin/dashboard";
  const helpKey = Object.keys(helpKeys).find(k => pathname.startsWith(k));
  const help = helpKey ? HELP[helpKeys[helpKey]] : null;

  return (
    <div className="h-full flex bg-slate-100 overflow-hidden" data-dept="admin">
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
          style={{ backgroundColor: headerColor, borderBottomColor: "rgba(255,255,255,0.15)" }}
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
          <h2 className="font-semibold text-white text-sm lg:text-base flex-1 min-w-0 truncate">{t(titles[titleKey])}</h2>
          {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
        </div>

        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="ADMIN" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-3 lg:p-5">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
