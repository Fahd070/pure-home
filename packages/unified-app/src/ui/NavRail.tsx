import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import { Icon, IconName, WhatsAppIcon } from "./icons";
import { CountBadge } from "./Badge";

/**
 * The navigation rail, shared by all three departments.
 *
 * Each department used to render its own rail painted in its own brand colour
 * (navy / green / teal), with hover and active states derived at runtime by
 * doing hex arithmetic on that colour. That produced three different-looking
 * products, unpredictable contrast, and states that no theme or high-contrast
 * setting could reach. There is now one rail on the neutral chrome tokens, and
 * the accent marks the active route.
 *
 * Departments still differ in what they link to -- that stays in each
 * department Sidebar, which owns its own badge counts and passes them here.
 */

export interface NavRailLink {
  kind?: "link";
  to: string;
  /** i18n key. */
  label: string;
  icon: IconName;
  badge?: number;
  /** Draws the count in a tone other than danger, e.g. informational counts. */
  badgeTone?: "danger" | "accent" | "info";
}

export interface NavRailExternal {
  kind: "external";
  href: string;
  /** i18n key. */
  label: string;
}

export type NavRailItem = NavRailLink | NavRailExternal;

export function NavRail({
  items, department, onLogout,
}: {
  items: NavRailItem[];
  /**
   * The workspace this shell is currently operating as -- Administration,
   * Scheduling & Maintenance, or Technicians.
   *
   * The rail deliberately shows the DEPARTMENT and never the signed-in
   * employee. These are shared department workstations, so a personal name in
   * the chrome told the operator nothing useful about which workspace they
   * were in, and put an individual's name on every screenshot and shoulder-
   * surfed screen. The authenticated user is unchanged underneath: auth,
   * permissions and audit logging still record the real person.
   */
  department?: string;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language === "ar";

  return (
    <aside className="w-56 h-full flex-shrink-0 flex flex-col bg-nav border-e border-line">
      {/* Brand + which workspace this is (never who is signed in) */}
      <div className="px-3 py-3 border-b border-line-subtle">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-7 h-7 rounded-md bg-accent text-accent-fg text-2xs font-bold flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            PH
          </span>
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-semibold text-nav-activefg leading-tight truncate">Pure Home</p>
            {department && <p className="text-2xs text-nav-muted truncate">{department}</p>}
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5" aria-label={t("nav.dashboard")}>
        {items.map((item) => {
          if (item.kind === "external") {
            return (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cx(
                  "group flex items-center gap-2.5 rounded-md px-2.5 h-9 text-[0.8125rem]",
                  "text-nav-fg hover:bg-nav-hover hover:text-nav-activefg transition-colors duration-100"
                )}
              >
                <span className="text-[#25D366] flex-shrink-0"><WhatsAppIcon className="w-4 h-4" /></span>
                <span className="flex-1 truncate">{t(item.label)}</span>
                <Icon name="external" className="w-3 h-3 text-nav-muted" />
              </a>
            );
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  "relative flex items-center gap-2.5 rounded-md px-2.5 h-9 text-[0.8125rem] transition-colors duration-100",
                  isActive
                    ? "bg-nav-active text-nav-activefg font-medium shadow-sm"
                    : "text-nav-fg hover:bg-nav-hover hover:text-nav-activefg"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The active marker is a rail, not a colour swap, so it stays
                      legible in high contrast where backgrounds flatten out. */}
                  <span
                    className={cx(
                      "absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-accent transition-opacity",
                      isActive ? "opacity-100" : "opacity-0"
                    )}
                    aria-hidden="true"
                  />
                  <Icon name={item.icon} className={cx("w-4 h-4 flex-shrink-0", isActive ? "text-accent" : "text-nav-muted")} />
                  <span className="flex-1 truncate">{t(item.label)}</span>
                  <CountBadge value={item.badge ?? 0} tone={item.badgeTone ?? "danger"} />
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-2 py-2 border-t border-line-subtle flex items-center gap-1">
        <button
          type="button"
          onClick={() => i18n.changeLanguage(isArabic ? "en" : "ar")}
          className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-md text-2xs font-medium text-nav-fg hover:bg-nav-hover hover:text-nav-activefg transition-colors"
          title={isArabic ? "English" : "العربية"}
        >
          <Icon name="language" className="w-3.5 h-3.5" />
          {isArabic ? "English" : "عربي"}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="h-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-md text-2xs font-medium text-nav-fg hover:bg-danger-bg hover:text-danger-fg transition-colors"
          title={t("auth.logout")}
        >
          <Icon name="logout" className="w-3.5 h-3.5" />
          {t("auth.logout")}
        </button>
      </div>
    </aside>
  );
}
