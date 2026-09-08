import React, { useState } from "react";
import { Modal } from "../ui/Modal";
import { Icon } from "../ui/icons";

interface HelpButtonProps {
  titleAr: string;
  contentAr: string;
  className?: string;
}

/**
 * Contextual help for the current screen. The panel is the shared Modal, so it
 * gets the same escape/backdrop/focus behaviour as every other dialog -- the
 * previous hand-rolled overlay trapped no focus and could not be closed from
 * the keyboard.
 */
export default function HelpButton({ titleAr, contentAr, className = "" }: HelpButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`w-8 h-8 rounded-md flex items-center justify-center text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors flex-shrink-0 ${className}`}
        title="مساعدة"
        aria-label="مساعدة"
      >
        <Icon name="help" className="w-4 h-4" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={titleAr} size="md">
        <div dir="rtl" className="text-[0.8125rem] text-fg-secondary leading-relaxed whitespace-pre-line">
          {contentAr}
        </div>
      </Modal>
    </>
  );
}
