import React from "react";
import { cx } from "./cx";

/**
 * Replays a short enter animation whenever its `transitionKey` changes.
 *
 * Route changes in this app swap content inside a persistent shell, so there is
 * nothing to tell the eye that the page actually changed -- the new screen just
 * appears. Re-keying the wrapper remounts the subtree, which restarts the CSS
 * animation and gives that swap a brief, consistent arrival.
 *
 * Deliberately CSS-only: no animation library, no exit transition. An exit
 * animation would delay the next screen, and on operational software the cost
 * of feeling slower is far higher than the benefit of a fancier handoff.
 *
 * `prefers-reduced-motion` is handled globally in globals.css, so this needs no
 * branch of its own -- the animation collapses to its end state.
 */
export function PageTransition({
  transitionKey, variant = "view", className, children,
}: {
  /** Change this to replay the animation -- normally the route pathname. */
  transitionKey: React.Key;
  /** `view` for routed pages, `panel` for a detail pane inside a page. */
  variant?: "view" | "panel";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      key={transitionKey}
      className={cx(variant === "panel" ? "ph-panel-enter" : "ph-view-enter", className)}
    >
      {children}
    </div>
  );
}
