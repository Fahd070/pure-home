import React from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function AppTitleBar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const bg = pathname.startsWith("/admin") ? "#000080"
    : pathname.startsWith("/scheduling") ? "#008000"
    : pathname.startsWith("/technician") ? "#8B4513"
    : "#1e293b";

  const title = pathname.startsWith("/admin")
    ? `Pure Home — ${t("dept.adminFull")}`
    : pathname.startsWith("/scheduling")
    ? `Pure Home — ${t("dept.schedulingFull")}`
    : pathname.startsWith("/technician")
    ? `Pure Home — ${t("dept.technicianFull")}`
    : "Pure Home";

  const el = (window as any).electron;
  return (
    <div style={{ backgroundColor: bg }} className="titlebar-drag h-8 flex items-center justify-between px-3 select-none">
      <span className="text-white text-xs font-medium titlebar-no-drag">{title}</span>
      <div className="titlebar-no-drag flex gap-1">
        <button onClick={() => el?.minimize()} className="w-5 h-5 rounded hover:bg-white/20 text-white text-xs flex items-center justify-center">─</button>
        <button onClick={() => el?.maximize()} className="w-5 h-5 rounded hover:bg-white/20 text-white text-xs flex items-center justify-center">□</button>
        <button onClick={() => el?.close()} className="w-5 h-5 rounded hover:bg-red-500 text-white text-xs flex items-center justify-center">✕</button>
      </div>
    </div>
  );
}