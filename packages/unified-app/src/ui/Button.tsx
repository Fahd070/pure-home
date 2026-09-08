import React from "react";
import { cx } from "./cx";

/**
 * The one button in Pure Home. Height comes from --ph-control-h, so the
 * Interface Scale setting resizes every button at once; color comes from the
 * accent/semantic tokens, so themes and high contrast follow automatically.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border border-accent hover:bg-accent-hover active:bg-accent-pressed",
  secondary:
    "bg-surface text-fg border border-line hover:bg-surface-hover active:bg-surface-active",
  ghost:
    "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-hover hover:text-fg active:bg-surface-active",
  danger:
    "bg-danger-solid text-white border border-danger-solid hover:brightness-110 active:brightness-95",
  subtle:
    "bg-accent-subtle text-accent-subtlefg border border-accent-border hover:brightness-[0.97] active:brightness-95",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square button sized for a single glyph — toolbar and row actions. */
  iconOnly?: boolean;
  /** Renders a spinner and blocks input while an action is in flight. */
  loading?: boolean;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", iconOnly, loading, block, className, disabled, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium",
        "transition-colors duration-100 select-none",
        "disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-[var(--ph-control-h-sm)] text-xs" : "h-control text-[0.8125rem]",
        iconOnly
          ? size === "sm"
            ? "w-[var(--ph-control-h-sm)] px-0"
            : "w-control px-0"
          : size === "sm"
          ? "px-2.5"
          : "px-3",
        block && "w-full",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Groups related buttons into one segmented control with shared borders. */
export function ButtonGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "inline-flex items-center [&>*]:rounded-none",
        "[&>*:first-child]:rounded-s [&>*:last-child]:rounded-e",
        "[&>*+*]:-ms-px",
        className
      )}
    >
      {children}
    </div>
  );
}
