import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import Header from "./Header";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import { getSocket } from "../hooks/useSocket";

const titles: Record<string, string> = {
  "/admin/dashboard":            "nav.dashboard",
  "/admin/customers/add":        "nav.customers",
  "/admin/customers":            "nav.customers",
  "/admin/appointments":         "nav.appointments",
  "/admin/urgent-appointments":  "nav.urgentAppointments",
  "/admin/tasks":                "nav.tasks",
  "/admin/technicians":          "nav.technicians",
  "/admin/expenses":             "nav.expenses",
  "/admin/messages":             "nav.messages",
  "/admin/notifications":        "nav.notifications",
  "/admin/messaging":            "nav.messaging",
  "/admin/reports":              "nav.reports",
  "/admin/access-codes":         "nav.accessCodes",
  "/admin/settings":             "nav.settings",
};

const helpKeys: Record<string, string> = {
  "/admin/dashboard":            "admin.dashboard",
  "/admin/customers/add":        "admin.addCustomer",
  "/admin/customers":            "admin.customers",
  "/admin/appointments":         "admin.appointments",
  "/admin/urgent-appointments":  "admin.urgentAppointments",
  "/admin/tasks":                "admin.tasks",
  "/admin/technicians":          "admin.technicians",
  "/admin/expenses":             "admin.expenses",
  "/admin/messages":             "admin.messages",
  "/admin/notifications":        "admin.notifications",
  "/admin/messaging":            "admin.messaging",
  "/admin/reports":              "admin.reports",
  "/admin/access-codes":         "admin.accessCodes",
  "/admin/settings":             "admin.settings",
};

export default function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const titleKey = Object.keys(titles).find(k => pathname.startsWith(k)) || "/admin/dashboard";
  const helpKey = Object.keys(helpKeys).find(k => pathname.startsWith(k));
  return (
    <div className="h-full flex bg-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={t(titles[titleKey])} helpKey={helpKey ? helpKeys[helpKey] : undefined} />
        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="ADMIN" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}