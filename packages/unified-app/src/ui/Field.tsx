import React from "react";
import { cx } from "./cx";

/**
 * Form controls. All three share one shape so a row of mixed inputs lines up,
 * and all three take their height from --ph-control-h like Button does.
 */
const CONTROL_BASE_NO_WIDTH =
  "rounded border bg-surface text-fg placeholder:text-fg-muted " +
  "border-line transition-colors duration-100 " +
  "hover:border-line-strong focus:border-accent " +
  "disabled:bg-surface-subtle disabled:text-fg-muted disabled:cursor-not-allowed " +
  "read-only:bg-surface-subtle";

const CONTROL_BASE = "w-full " + CONTROL_BASE_NO_WIDTH;

const CONTROL_SIZED = "h-control px-2.5 text-[0.8125rem]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL_BASE, CONTROL_SIZED, invalid && "border-danger-solid", className)}
        {...rest}
      />
    );
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL_BASE, "py-2 px-2.5 text-[0.8125rem] leading-relaxed resize-y", invalid && "border-danger-solid", className)}
        {...rest}
      />
    );
  }
);

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; fullWidth?: boolean }
>(
  function Select({ className, invalid, fullWidth = true, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        // fullWidth is a prop rather than a className override because the base
        // `w-full` would otherwise win the cascade over a `w-32` passed in.
        className={cx(
          CONTROL_BASE_NO_WIDTH,
          fullWidth && "w-full",
          CONTROL_SIZED,
          "cursor-pointer",
          invalid && "border-danger-solid",
          className
        )}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

export function Label({
  children, htmlFor, required, className,
}: { children: React.ReactNode; htmlFor?: string; required?: boolean; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx("block text-xs font-medium text-fg-secondary mb-1.5", className)}>
      {children}
      {required && <span className="text-danger-fg ms-0.5">*</span>}
    </label>
  );
}

/** Label + control + hint/error, so field spacing is identical on every form. */
export function Field({
  label, htmlFor, required, hint, error, children, className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      {label && <Label htmlFor={htmlFor} required={required}>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1 text-2xs text-danger-fg">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-2xs text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Checkbox/radio with a hit target big enough for a touch screen. */
export function Checkbox({
  label, className, ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cx("inline-flex items-center gap-2 text-[0.8125rem] text-fg cursor-pointer select-none", className)}>
      <input
        type="checkbox"
        className="w-4 h-4 rounded-sm border border-line-strong accent-[var(--ph-accent)] cursor-pointer"
        {...rest}
      />
      {label}
    </label>
  );
}
