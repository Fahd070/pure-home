import React from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

export default function Header({ title, helpKey }: { title?: string; helpKey?: string }) {
  const help = helpKey ? HELP[helpKey] : null;
  return (
    <div className="h-commandbar bg-surface border-b border-line flex items-center px-4 gap-2">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
    </div>
  );
}