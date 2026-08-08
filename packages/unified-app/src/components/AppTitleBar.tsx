import React from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

function WindowControlButton({
  onClick, title, icon, destructive,
}: { onClick: () => void; title: string; icon: React.ReactNode; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`titlebar-no-drag w-9 h-8 rounded flex items-center justify-center text-white transition-colors focus:outline-none focus:ring-1 focus:ring-white/50 ${
        destructive ? "hover:bg-red-500" : "hover:bg-white/20"
      }`}
    >
      {icon}
    </button>
  );
}

export default function AppTitleBar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { settings } = useSettingsStore();

  const bg = pathname.startsWith("/admin") ? (settings.primaryColor || "#0A0A2E")
    : pathname.startsWith("/scheduling") ? "#2A533F"
    : pathname.startsWith("/technician") ? "#014245"
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
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <WindowControlButton onClick={() => el?.minimize()} title={t("titlebar.minimize")} icon={<MinimizeIcon />} />
        <WindowControlButton onClick={() => el?.maximize()} title={t("titlebar.maximizeRestore")} icon={<MaximizeIcon />} />
        <WindowControlButton onClick={() => el?.close()} title={t("titlebar.close")} icon={<CloseIcon />} destructive />
      </div>
    </div>
  );
}
