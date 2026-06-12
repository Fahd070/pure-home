import React from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../../components/HelpButton";
import { HELP } from "../../helpContent";

export default function Header({ title, helpKey }: { title?: string; helpKey?: string }) {
  const help = helpKey ? HELP[helpKey] : null;
  return (
    <div className="h-12 bg-white border-b flex items-center px-4 shadow-sm gap-2">
      <h2 className="font-semibold text-slate-700">{title}</h2>
      {help && <HelpButton titleAr={help.titleAr} contentAr={help.contentAr} />}
    </div>
  );
}