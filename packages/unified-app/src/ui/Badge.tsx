import React from "react";
import { cx } from "./cx";

/**
 * Status colour is meaning, not decoration: every tone here maps to a semantic
 * token family, so the same status reads the same way on every screen and
 * survives dark mode and high contrast without a second set of literals.
 */
export type Tone =
  | "neutral" | "success" | "warning" | "danger"
  | "info" | "urgent" | "pending" | "progress" | "accent";

const TONES: Record<Tone, string> = {
  neutral:  "bg-neutral-bg  text-neutral-fg  border-neutral-border",
  success:  "bg-success-bg  text-success-fg  border-success-border",
  warning:  "bg-warning-bg  text-warning-fg  border-warning-border",
  danger:   "bg-danger-bg   text-danger-fg   border-danger-border",
  info:     "bg-info-bg     text-info-fg     border-info-border",
  urgent:   "bg-urgent-bg   text-urgent-fg   border-urgent-border",
  pending:  "bg-pending-bg  text-pending-fg  border-pending-border",
  progress: "bg-progress-bg text-progress-fg border-progress-border",
  accent:   "bg-accent-subtle text-accent-subtlefg border-accent-border",
};

const DOTS: Record<Tone, string> = {
  neutral:  "bg-neutral-solid",
  success:  "bg-success-solid",
  warning:  "bg-warning-solid",
  danger:   "bg-danger-solid",
  info:     "bg-info-solid",
  urgent:   "bg-urgent-solid",
  pending:  "bg-pending-solid",
  progress: "bg-progress-solid",
  accent:   "bg-accent",
};

export function Badge({
  tone = "neutral", dot, children, className,
}: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-2xs font-medium leading-5 whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {dot && <span className={cx("w-1.5 h-1.5 rounded-full flex-shrink-0", DOTS[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Small numeric counter used on nav items and tabs.
 *
 * Counting rules, which the navigation badges depend on:
 *   0        -> nothing renders at all (no empty circle, no layout shift)
 *   1..99    -> the exact number
 *   100+     -> "99+", so a large count can never widen the nav item
 *
 * The pill is fixed-height with a minimum width, so going from "9" to "99+"
 * grows it horizontally without moving the row it sits in. It is placed by the
 * flex order of its parent rather than by a left/right offset, which is what
 * makes it land on the correct side in both RTL and LTR with no mirroring code.
 *
 * `label` supplies the accessible name ("3 unread notifications"). Without it
 * the badge is a bare numeral next to a link, and its meaning is carried only by
 * being small and red -- which is exactly the colour-only signal that a
 * screen-reader user, or anyone who cannot distinguish it, does not receive.
 */
export function CountBadge({
  value, tone = "danger", className, label,
}: { value: number; tone?: Tone; className?: string; label?: string }) {
  if (!value) return null;
  const display = value > 99 ? "99+" : String(value);
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-[1.125rem]",
        "text-2xs font-semibold leading-none text-white",
        DOTS[tone],
        className
      )}
      // The visible glyph is clamped to "99+", so the accessible name carries
      // the real number rather than repeating the abbreviation.
      //
      // `role="img"`, NOT `role="status"`: status makes this a polite live
      // region, and several of these sit in one sidebar refreshing on a 30s poll
      // plus every socket invalidation -- which would read unrelated counts aloud
      // to a screen-reader user over and over. img gives the element its
      // accessible name without announcing itself.
      aria-label={label}
      role={label ? "img" : undefined}
    >
      <span aria-hidden={label ? "true" : undefined}>{display}</span>
    </span>
  );
}
