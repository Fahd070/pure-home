import React from "react";
import { useTranslation } from "react-i18next";

export default function Header({ title }: { title?: string }) {
  return (
    <div className="h-12 bg-white border-b flex items-center px-4 shadow-sm">
      <h2 className="font-semibold text-slate-700">{title}</h2>
    </div>
  );
}