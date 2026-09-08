import React from "react";
import { Button } from "./Button";
import { Icon } from "./icons";
import { cx } from "./cx";

/**
 * Page stepper for the server-paginated lists. Chevrons flip in RTL so
 * "previous" always points back the way the reader came.
 */
export function Pagination({
  page, totalPages, total, onPage, className,
}: {
  page: number;
  totalPages: number;
  /** Total row count, shown alongside the stepper when known. */
  total?: number;
  onPage: (next: number) => void;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <span className="text-2xs text-fg-muted tabular-nums">
        {typeof total === "number" ? total : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm" variant="secondary" iconOnly
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
        </Button>
        <span className="text-2xs text-fg-secondary tabular-nums px-1 min-w-[3.5rem] text-center">
          {page} / {totalPages || 1}
        </span>
        <Button
          size="sm" variant="secondary" iconOnly
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <Icon name="chevronEnd" className="w-3.5 h-3.5 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
