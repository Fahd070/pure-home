import React from "react";
import { Icon, IconName } from "../ui/icons";

type RowActionVariant = "edit" | "delete" | "call";

interface RowActionButtonProps {
  variant: RowActionVariant;
  onClick: () => void;
  title: string;
  /**
   * @deprecated Edit actions used to be tinted per department (blue for admin,
   * green for scheduling). Departments no longer have their own palette, so the
   * value is ignored; the prop stays so existing callers keep compiling.
   */
  theme?: "blue" | "green";
}

// Neutral by default, semantic only where the action carries risk: an edit is
// ordinary, a delete is destructive, a call reaches a real person.
const VARIANTS: Record<RowActionVariant, { icon: IconName; cls: string }> = {
  edit:   { icon: "edit",  cls: "text-fg-muted hover:bg-surface-hover hover:text-fg" },
  delete: { icon: "trash", cls: "text-fg-muted hover:bg-danger-bg hover:text-danger-fg" },
  call:   { icon: "phone", cls: "text-fg-muted hover:bg-success-bg hover:text-success-fg" },
};

/**
 * Shared edit/delete/call row action. Sized to --ph-control-h so it matches the
 * height of every other control in a table row and grows with Interface Scale.
 */
export default function RowActionButton({ variant, onClick, title }: RowActionButtonProps) {
  const { icon, cls } = VARIANTS[variant];
  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); onClick(); }}
      title={title}
      aria-label={title}
      className={`w-control h-control flex items-center justify-center rounded-md transition-colors ${cls}`}
    >
      <Icon name={icon} className="w-4 h-4" />
    </button>
  );
}
