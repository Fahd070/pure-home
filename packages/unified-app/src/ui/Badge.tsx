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

/** Small numeric counter used on nav items and tabs. */
export function CountBadge({ value, tone = "danger", className }: { value: number; tone?: Tone; className?: string }) {
  if (!value) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-[1.125rem]",
        "text-2xs font-semibold leading-none text-white",
        DOTS[tone],
        className
      )}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}
