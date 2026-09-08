import React from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * The window title bar is application chrome, not department chrome. It used
 * to be repainted per department (navy / green / teal), which made one product
 * look like three; the department is now named in the title instead, and the
 * bar itself is a single neutral surface in every theme.
 */

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" className="w-2.5 h-2.5" aria-hidden="true">
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} className="w-2.5 h-2.5" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="0.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" className="w-2.5 h-2.5" aria-hidden="true">
      <line x1="3" y1="3" x2="13" y2="13" />
      <line x1="13" y1="3" x2="3" y2="13" />
    </svg>
  );
}

function WindowControlButton({
  onClick, title, icon, destructive,
}: { onClick: () => void; title: string; icon: React.ReactNode; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      // Windows convention: full-height, square-ish, no radius, close goes red.
      className={[
        "titlebar-no-drag h-titlebar w-[46px] flex items-center justify-center",
        "text-titlebar-fg transition-colors duration-75 focus-visible:outline-offset-[-2px]",
        destructive ? "hover:bg-danger-solid hover:text-white" : "hover:bg-titlebar-border",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}

export default function AppTitleBar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const dept = pathname.startsWith("/admin")
    ? t("dept.adminFull")
    : pathname.startsWith("/scheduling")
    ? t("dept.schedulingFull")
    : pathname.startsWith("/technician")
    ? t("dept.technicianFull")
    : null;

  const el = (window as any).electron;

  return (
    <div className="titlebar-drag h-titlebar flex items-center justify-between select-none bg-titlebar border-b border-titlebar-border flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0 ps-3">
        <span
          className="w-4 h-4 rounded-sm bg-accent text-accent-fg text-[0.5rem] font-bold flex items-center justify-center flex-shrink-0"
          aria-hidden="true"
        >
          PH
        </span>
        <span className="text-titlebar-fg text-2xs font-medium truncate">
          Pure Home
          {dept && <span className="text-fg-muted font-normal"> — {dept}</span>}
        </span>
      </div>

      <div className="titlebar-no-drag flex items-center flex-shrink-0">
        <WindowControlButton onClick={() => el?.minimize()} title={t("titlebar.minimize")} icon={<MinimizeIcon />} />
        <WindowControlButton onClick={() => el?.maximize()} title={t("titlebar.maximizeRestore")} icon={<MaximizeIcon />} />
        <WindowControlButton onClick={() => el?.close()} title={t("titlebar.close")} icon={<CloseIcon />} destructive />
      </div>
    </div>
  );
}
