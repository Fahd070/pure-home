import React from "react";
import { cx } from "./cx";
import type { Tone } from "./Badge";

/** Shown wherever a list has nothing in it — never a bare blank panel. */
export function EmptyState({
  icon = "—", title, description, action, className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center text-center py-12 px-6", className)}>
      <div className="w-11 h-11 rounded-full bg-surface-subtle border border-line-subtle flex items-center justify-center text-lg text-fg-muted mb-3" aria-hidden="true">
        {icon}
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="text-xs text-fg-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Placeholder block used while data loads, sized like the content it replaces. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-surface-active", className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3 space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cx("h-4", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Inline message band — errors, warnings, and contextual notes. */
export function Callout({
  tone = "info", title, children, actions, className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const TONES: Record<Tone, string> = {
    neutral:  "bg-neutral-bg  border-neutral-border  text-neutral-fg",
    success:  "bg-success-bg  border-success-border  text-success-fg",
    warning:  "bg-warning-bg  border-warning-border  text-warning-fg",
    danger:   "bg-danger-bg   border-danger-border   text-danger-fg",
    info:     "bg-info-bg     border-info-border     text-info-fg",
    urgent:   "bg-urgent-bg   border-urgent-border   text-urgent-fg",
    pending:  "bg-pending-bg  border-pending-border  text-pending-fg",
    progress: "bg-progress-bg border-progress-border text-progress-fg",
    accent:   "bg-accent-subtle border-accent-border text-accent-subtlefg",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx("flex items-start gap-3 rounded-md border px-3 py-2.5 text-[0.8125rem]", TONES[tone], className)}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

/** Centered spinner for a whole panel or page region. */
export function Loading({ label, className }: { label?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center py-12 gap-3 text-fg-muted", className)} aria-busy="true">
      <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <path d="M22 12A10 10 0 0 0 12 2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label && <p className="text-xs">{label}</p>}
    </div>
  );
}
