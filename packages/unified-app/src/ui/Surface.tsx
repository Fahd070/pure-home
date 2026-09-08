import React from "react";
import { cx } from "./cx";
import type { Tone } from "./Badge";

/** A bordered panel. Borders do the separating here; elevation stays reserved
 *  for things that actually float (menus, dialogs, toasts). */
export function Card({
  children, className, padded = true,
}: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <div className={cx("bg-surface border border-line rounded-md", padded && "p-4", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title, subtitle, actions, className,
}: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 mb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>
        {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

/** The band above page content: title on one side, actions on the other. */
export function PageHeader({
  title, subtitle, actions, className,
}: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 mb-4", className)}>
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-fg truncate">{title}</h1>
        {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

/** Filter/search strip that sits directly above a table. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2 mb-3", className)}>{children}</div>
  );
}

/** A single number with its label — the dashboard's basic unit. */
export function StatTile({
  label, value, hint, tone = "neutral", icon, onClick, className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const RAIL: Record<Tone, string> = {
    neutral: "bg-neutral-solid", success: "bg-success-solid", warning: "bg-warning-solid",
    danger: "bg-danger-solid", info: "bg-info-solid", urgent: "bg-urgent-solid",
    pending: "bg-pending-solid", progress: "bg-progress-solid", accent: "bg-accent",
  };
  const Tag: any = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx(
        "relative overflow-hidden bg-surface border border-line rounded-md p-3.5 text-start",
        onClick && "hover:bg-surface-hover active:bg-surface-active transition-colors cursor-pointer",
        className
      )}
    >
      <span className={cx("absolute inset-y-0 start-0 w-0.5", RAIL[tone])} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        {icon && <span className="text-fg-muted flex-shrink-0" aria-hidden="true">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold text-fg mt-1.5 tabular-nums leading-none">{value}</p>
      {hint && <p className="text-2xs text-fg-muted mt-1.5">{hint}</p>}
    </Tag>
  );
}

/** Divider that carries an optional caption. */
export function Divider({ label, className }: { label?: React.ReactNode; className?: string }) {
  if (!label) return <hr className={cx("border-0 border-t border-line-subtle my-4", className)} />;
  return (
    <div className={cx("flex items-center gap-3 my-4", className)}>
      <span className="text-2xs font-semibold uppercase tracking-wide text-fg-muted whitespace-nowrap">{label}</span>
      <hr className="flex-1 border-0 border-t border-line-subtle" />
    </div>
  );
}
