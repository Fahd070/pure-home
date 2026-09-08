import React from "react";
import { cx } from "./cx";

/**
 * Desktop data table. Row height comes from --ph-row-h so the Interface Scale
 * setting changes real density instead of zooming pixels, the header sticks
 * while the body scrolls, and the whole thing scrolls horizontally inside its
 * own box so the page itself never does.
 */
export function TableShell({
  children, className, scrollClassName,
}: { children: React.ReactNode; className?: string; scrollClassName?: string }) {
  return (
    <div className={cx("bg-surface border border-line rounded-md overflow-hidden", className)}>
      <div className={cx("overflow-auto", scrollClassName)}>{children}</div>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return <table className={cx("w-full border-collapse text-[0.8125rem]", className)}>{children}</table>;
}

export function THead({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <thead className={cx("sticky top-0 z-10 bg-surface-subtle", className)}>
      {children}
    </thead>
  );
}

export function TH({
  children, className, align = "start", width, sortable, sorted, onSort, scope = "col",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  width?: string | number;
  sortable?: boolean;
  sorted?: "asc" | "desc" | false;
  onSort?: () => void;
  scope?: "col" | "row";
}) {
  return (
    <th
      scope={scope}
      style={width ? { width } : undefined}
      aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
      className={cx(
        "border-b border-line px-3 py-2 font-semibold text-2xs uppercase tracking-wide text-fg-muted whitespace-nowrap",
        align === "center" ? "text-center" : align === "end" ? "text-end" : "text-start",
        sortable && "cursor-pointer select-none hover:text-fg",
        className
      )}
      onClick={sortable ? onSort : undefined}
    >
      <span className={cx("inline-flex items-center gap-1", align === "center" && "justify-center")}>
        {children}
        {sortable && (
          <span className={cx("text-[0.6rem]", sorted ? "text-accent" : "opacity-40")} aria-hidden="true">
            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
          </span>
        )}
      </span>
    </th>
  );
}

export function TBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tbody className={className}>{children}</tbody>;
}

export function TR({
  children, className, onClick, selected,
}: { children: React.ReactNode; className?: string; onClick?: () => void; selected?: boolean }) {
  return (
    <tr
      onClick={onClick}
      aria-selected={selected || undefined}
      className={cx(
        "border-b border-line-subtle last:border-b-0 transition-colors",
        selected ? "bg-accent-subtle" : "hover:bg-surface-hover",
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children, className, align = "start", colSpan, title,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  colSpan?: number;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={cx(
        "h-row px-3 py-1.5 text-fg align-middle",
        align === "center" ? "text-center" : align === "end" ? "text-end" : "text-start",
        className
      )}
    >
      {children}
    </td>
  );
}
