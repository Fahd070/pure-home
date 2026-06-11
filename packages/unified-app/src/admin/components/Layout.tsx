import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "./Sidebar";
import Header from "./Header";
import ConnectionBanner from "../../components/ConnectionBanner";
import NotificationBar from "../../components/NotificationBar";
import { getSocket } from "../hooks/useSocket";

const titles: Record<string, string> = {
  "/admin/dashboard":      "nav.dashboard",
  "/admin/customers":      "nav.customers",
  "/admin/appointments":   "nav.appointments",
  "/admin/tasks":          "nav.tasks",
  "/admin/technicians":    "nav.technicians",
  "/admin/messages":       "nav.messages",
  "/admin/notifications":  "nav.notifications",
  "/admin/messaging":      "nav.messaging",
};

export default function AdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const key = Object.keys(titles).find(k => pathname.startsWith(k)) || "/admin/dashboard";
  return (
    <div className="h-full flex bg-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={t(titles[key])} />
        <ConnectionBanner getSocket={getSocket} />
        <NotificationBar role="ADMIN" getSocket={getSocket} />
        <main className="flex-1 overflow-y-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}