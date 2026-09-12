import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Icon } from "./icons";
import { cx } from "./cx";

/**
 * Page stepper for the server-paginated lists. Chevrons flip in RTL so
 * "previous" always points back the way the reader came.
 *
 * v4 Requirement #9 added the labelled variant used above the customer lists.
 * The bare count and the icon-only chevrons are still the default, because the
 * appointment lists that already use this component sit below their table where
 * a compact stepper is right; `labelled` opts into the fuller treatment --
 * "Previous / Page 3 of 17 / Next" plus a total -- for a list where reaching a
 * specific page is the whole point rather than an afterthought.
 */
export function Pagination({
  page, totalPages, total, onPage, className, labelled, totalLabel,
}: {
  page: number;
  totalPages: number;
  /** Total row count, shown alongside the stepper when known. */
  total?: number;
  onPage: (next: number) => void;
  className?: string;
  /** Render text labels and a "Page X of Y" readout instead of bare chevrons. */
  labelled?: boolean;
  /** What `total` counts, e.g. "Total customers". Only used when labelled. */
  totalLabel?: string;
}) {
  const { t } = useTranslation();
  const pages = totalPages || 1;
  const atStart = page <= 1;
  const atEnd = page >= pages;

  if (labelled) {
    return (
      // Wraps rather than overflows: at 390px the readout drops under the
      // buttons instead of pushing the page into a horizontal scroll.
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
          "bg-surface border border-line rounded-md px-3 py-2",
          className
        )}
      >
        <span className="text-2xs text-fg-muted tabular-nums">
          {typeof total === "number" && (
            <>
              {totalLabel ? `${totalLabel}: ` : ""}
              <span className="font-medium text-fg-secondary">{total}</span>
            </>
          )}
        </span>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={atStart} onClick={() => onPage(page - 1)}>
            <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
            {t("pagination.previous")}
          </Button>
          <span className="text-2xs text-fg-secondary tabular-nums px-1 whitespace-nowrap">
            {t("pagination.page")} <span className="font-medium text-fg">{page}</span> {t("pagination.of")}{" "}
            <span className="font-medium text-fg">{pages}</span>
          </span>
          <Button size="sm" variant="secondary" disabled={atEnd} onClick={() => onPage(page + 1)}>
            {t("pagination.next")}
            <Icon name="chevronEnd" className="w-3.5 h-3.5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <span className="text-2xs text-fg-muted tabular-nums">
        {typeof total === "number" ? total : ""}
      </span>
      <div className="flex items-center gap-2">
        <Button
          size="sm" variant="secondary" iconOnly
          disabled={atStart}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
        </Button>
        <span className="text-2xs text-fg-secondary tabular-nums px-1 min-w-[3.5rem] text-center">
          {page} / {pages}
        </span>
        <Button
          size="sm" variant="secondary" iconOnly
          disabled={atEnd}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <Icon name="chevronEnd" className="w-3.5 h-3.5 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
