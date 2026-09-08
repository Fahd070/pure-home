import React, { useEffect, useRef } from "react";
import { cx } from "./cx";
import { Button } from "./Button";

/**
 * One dialog for the whole product. Escape and backdrop close it, focus moves
 * in on open and returns to the trigger on close, and Tab is kept inside the
 * dialog so keyboard users cannot wander into the page behind it.
 */
export function Modal({
  open, onClose, title, description, children, footer, size = "md", className,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Set false for long data-entry forms, where a stray click outside would
   *  discard typed work. Escape and the explicit controls still close it. */
  closeOnBackdrop?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const SELECTOR =
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusablesIn = (root: HTMLElement | null) =>
      Array.from(root?.querySelectorAll<HTMLElement>(SELECTOR) ?? [])
        .filter((el) => el.offsetParent !== null);
    const focusables = () => focusablesIn(panelRef.current);

    // Focus the first control in the BODY, not the first in the panel: the
    // header can contain a help button, and landing there put a focus ring on
    // an icon next to the title instead of on the first field the user has to
    // fill in. Falls back to the panel (a dialog with no body controls).
    (focusablesIn(bodyRef.current)[0] ?? focusables()[0])?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };

  return (
    <div
      className="ph-scrim-enter fixed inset-0 z-dialog flex items-center justify-center p-4"
      style={{ background: "var(--ph-overlay)" }}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cx(
          "w-full bg-surface-raised border border-line rounded-lg shadow-lg",
          "flex flex-col max-h-[calc(100vh-6rem)] ph-dialog-enter",
          SIZES[size],
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line flex-shrink-0">
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-fg truncate">{title}</h2>}
              {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
            </div>
            <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="Close" title="Close">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </Button>
          </div>
        )}

        <div ref={bodyRef} className="px-4 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line bg-surface-subtle rounded-b-lg flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Destructive-action confirmation, so "are you sure?" looks the same everywhere. */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive, loading,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: React.ReactNode;
  message?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-[0.8125rem] text-fg-secondary leading-relaxed">{message}</p>}
    </Modal>
  );
}
