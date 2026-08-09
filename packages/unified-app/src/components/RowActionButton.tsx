import React from "react";

type RowActionVariant = "edit" | "delete" | "call";
type EditTheme = "blue" | "green";

interface RowActionButtonProps {
  variant: RowActionVariant;
  onClick: () => void;
  title: string;
  /** Edit-button accent color, matched to each department's existing theme (delete is always red, call is always emerald). */
  theme?: EditTheme;
}

const EDIT_THEME_CLASSES: Record<EditTheme, string> = {
  blue: "text-blue-600 hover:bg-blue-100 focus:ring-blue-500",
  green: "text-green-600 hover:bg-green-100 focus:ring-green-500",
};

const DELETE_CLASSES = "text-red-500 hover:bg-red-100 focus:ring-red-500";
const CALL_CLASSES = "text-emerald-600 hover:bg-emerald-100 focus:ring-emerald-500";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/**
 * Shared edit/delete row-action button for Dashboard drill-down tables
 * (admin + scheduling). Larger, clearer touch target than a bare emoji
 * glyph, reusing the app's existing rounded-lg + focus:ring conventions.
 */
export default function RowActionButton({ variant, onClick, title, theme = "blue" }: RowActionButtonProps) {
  const colorClasses = variant === "delete" ? DELETE_CLASSES : variant === "call" ? CALL_CLASSES : EDIT_THEME_CLASSES[theme];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 ${colorClasses}`}
    >
      {variant === "edit" ? <EditIcon /> : variant === "call" ? <CallIcon /> : <DeleteIcon />}
    </button>
  );
}
