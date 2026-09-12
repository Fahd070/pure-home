import React from "react";
import { cx } from "./cx";

/**
 * Adds or removes one option. Exported so the OWNER of the state does the
 * toggling inside a functional state update.
 *
 * That split is deliberate. If this component computed the next array from its
 * own `value` prop and handed the result back, every toggle would be derived
 * from whatever was rendered last -- so two toggles processed in one React batch
 * would both start from the same stale array and the second would discard the
 * first. Passing the option up instead means the reducer always sees the
 * current selection.
 */
export function toggleIn<T>(list: T[], option: T): T[] {
  return list.includes(option) ? list.filter((v) => v !== option) : [...list, option];
}

/**
 * A non-exclusive choice of several options (v4 Requirement #10B/#10C).
 *
 * Segmented is the exclusive sibling of this control and looks deliberately
 * similar, because they are the same kind of thing -- a set of states you pick
 * from, not a row of independent actions. The difference is expressed where it
 * matters: separate toggle buttons rather than one joined bar, so the eye reads
 * "several of these" rather than "one of these", and `aria-pressed` instead of
 * `radio`, so a screen reader reads it the same way.
 *
 * Wraps rather than scrolls, so seven statuses stack to two or three rows at
 * 390px instead of pushing the form into a horizontal scroll.
 */
export function CheckGroup<T extends string>({
  value, options, labels, onToggle, disabled, className, ariaLabel,
}: {
  value: T[];
  options: readonly T[];
  labels: Record<string, string>;
  /** Receives the option that was pressed, never a pre-computed array. */
  onToggle: (option: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cx("flex flex-wrap gap-1.5", className)}>
      {options.map((opt) => {
        const selected = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(opt)}
            className={cx(
              "h-control px-3 rounded-md border text-xs font-medium transition-colors duration-100 whitespace-nowrap",
              "disabled:opacity-50 disabled:pointer-events-none",
              selected
                ? "bg-accent text-accent-fg border-accent"
                : "bg-surface text-fg-secondary border-line hover:bg-surface-hover"
            )}
          >
            {labels[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}
