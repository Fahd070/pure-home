import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cx } from "./cx";
import { Icon } from "./icons";
import { PageTransition } from "./PageTransition";

/**
 * The frame every department screen sits in: navigation rail, command bar,
 * connection/notification banners, then content.
 *
 * The command bar used to be a solid slab of the department colour with white
 * text on it, which meant the loudest element on every screen was chrome that
 * never changed. It is now a quiet surface, so the eye lands on the data.
 */
export function AppFrame({
  dept, sidebar, title, actions, banners, overlays, children,
}: {
  /** Marks the subtree for department-specific selectors and debugging. */
  dept: string;
  sidebar: React.ReactNode;
  title: React.ReactNode;
  /** Help button and any page-level actions that belong in the command bar. */
  actions?: React.ReactNode;
  banners?: React.ReactNode;
  /**
   * Shell-level dialogs and alerts, rendered OUTSIDE the routed content.
   *
   * This slot exists specifically because `children` is wrapped in
   * `PageTransition`, whose enter animation holds a non-none `transform` for
   * its duration -- and a transformed ancestor becomes the containing block for
   * `position: fixed` descendants. A centred dialog mounted alongside the route
   * would therefore be positioned against the animating page wrapper instead of
   * the viewport, and would visibly sit off-centre for the length of every route
   * change. Anything full-screen and fixed belongs here, not in `children`.
   */
  overlays?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating always closes the drawer, so it never covers the page it opened.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="h-full flex bg-canvas overflow-hidden" data-dept={dept}>
      {drawerOpen && (
        <div
          className="ph-scrim-enter fixed inset-0 z-drawer lg:hidden"
          style={{ background: "var(--ph-overlay)" }}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer below lg, static column at lg and up. */}
      <div
        className={cx(
          "fixed inset-y-0 start-0 z-drawer transition-transform duration-200 ease-out",
          "lg:relative lg:inset-auto lg:z-auto lg:translate-x-0 lg:rtl:translate-x-0 lg:transition-none",
          drawerOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        )}
      >
        {sidebar}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-commandbar flex-shrink-0 flex items-center gap-2 px-3 lg:px-4 bg-surface border-b border-line">
          <button
            type="button"
            className="lg:hidden flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-fg-secondary hover:bg-surface-hover transition-colors"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menu"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" className="w-5 h-5" />
          </button>

          <h1 key={pathname} className="ph-view-enter text-sm font-semibold text-fg flex-1 min-w-0 truncate">
            {title}
          </h1>

          {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
        </header>

        {banners}

        {/* Keyed on the pathname so each routed screen replays the short enter
            animation -- otherwise content swaps inside the persistent shell with
            nothing to signal that the page changed. */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-5">
          <PageTransition transitionKey={pathname} className="max-w-[1400px] mx-auto">
            {children}
          </PageTransition>
        </main>
      </div>

      {overlays}
    </div>
  );
}
