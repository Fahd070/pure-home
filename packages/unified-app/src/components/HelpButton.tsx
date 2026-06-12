import React, { useState } from "react";

interface HelpDialogProps {
  titleAr: string;
  contentAr: string;
  onClose: () => void;
}

function HelpDialog({ titleAr, contentAr, onClose }: HelpDialogProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
              ؟
            </div>
            <h3 className="font-semibold text-base text-slate-800">{titleAr}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 flex-shrink-0 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="text-slate-600 leading-relaxed text-sm whitespace-pre-line">
          {contentAr}
        </div>
      </div>
    </div>
  );
}

interface HelpButtonProps {
  titleAr: string;
  contentAr: string;
  className?: string;
}

export default function HelpButton({ titleAr, contentAr, className = "" }: HelpButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`w-5 h-5 rounded-full bg-blue-100 hover:bg-blue-200 flex items-center justify-center text-blue-600 font-bold text-xs flex-shrink-0 transition-colors ${className}`}
        title="مساعدة"
        aria-label="مساعدة"
      >
        ؟
      </button>
      {open && (
        <HelpDialog titleAr={titleAr} contentAr={contentAr} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
