import React from "react";
import { cx } from "./cx";

/**
 * An exclusive choice of two or three options, shown as one joined control.
 *
 * These used to be rows of separate rounded buttons that turned solid when
 * chosen, which read as three independent actions rather than one setting with
 * three states. Joining them into a single bordered group makes the mutual
 * exclusivity visible, and the roles below make it audible to a screen reader.
 */
export function Segmented<T extends string>({
  value, options, labels, onChange, disabled, className, ariaLabel, fullWidth = true,
}: {
  value: T | "";
  options: T[];
  labels: Record<string, string>;
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Set false where the control is a filter sitting in a toolbar rather than
   *  a form field that should fill its column. */
  fullWidth?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("inline-flex rounded-md border border-line overflow-hidden", fullWidth && "w-full", className)}
    >
      {options.map((opt, i) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={cx(
              "h-control px-3 text-xs font-medium transition-colors duration-100 whitespace-nowrap",
              fullWidth && "flex-1",
              "disabled:opacity-50 disabled:pointer-events-none",
              i > 0 && "border-s border-line",
              selected
                ? "bg-accent text-accent-fg"
                : "bg-surface text-fg-secondary hover:bg-surface-hover"
            )}
          >
            {labels[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}
