import React from "react";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import { Icon } from "./icons";
import { useGlobalRefresh } from "../hooks/useGlobalRefresh";

/**
 * v4 Requirement #14: the global "sync now" control.
 *
 * Rendered by AppFrame, so every department gets the same control in the same
 * place rather than each page growing its own refresh affordance.
 *
 * The label is text, not just the icon -- the icon is decorative here
 * (`aria-hidden`) and the visible word carries the meaning, so the control is
 * announced properly and stays understandable at a glance. It collapses to
 * icon-only below `sm` purely to keep the command bar from crowding the page
 * title on a phone; the accessible name comes from `aria-label` in that state,
 * so it never becomes an unlabelled button.
 *
 * `animate-spin` on the icon is the same busy treatment ConnectionBanner
 * already uses, so "working" looks the same everywhere in the app.
 */
export function RefreshButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { refresh, isRefreshing } = useGlobalRefresh();

  return (
    <button
      type="button"
      onClick={() => { void refresh(); }}
      disabled={isRefreshing}
      aria-label={t("common.refresh")}
      aria-busy={isRefreshing}
      title={t("common.refresh")}
      className={cx(
        "h-control inline-flex items-center gap-1.5 rounded-md border border-line px-2.5",
        "text-2xs font-medium text-fg-secondary bg-surface",
        "hover:bg-surface-hover hover:text-fg transition-colors duration-100",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:opacity-60 disabled:pointer-events-none",
        className
      )}
    >
      <Icon
        name="refresh"
        className={cx("w-3.5 h-3.5 flex-shrink-0", isRefreshing && "animate-spin")}
        aria-hidden="true"
      />
      <span className="hidden sm:inline">{t("common.refresh")}</span>
    </button>
  );
}
