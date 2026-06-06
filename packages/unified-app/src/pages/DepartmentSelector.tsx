import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";

const logoUrl = new URL("../../assets/icon.png", import.meta.url).href;

const depts = [
  { id: "admin",      label_ar: "الإدارة",          label_en: "Administration",          color: "border-blue-500 hover:bg-blue-50",    badge: "bg-blue-600",   icon: "🔵" },
  { id: "scheduling", label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance", color: "border-green-500 hover:bg-green-50",  badge: "bg-green-600",  icon: "🟢" },
  { id: "technician", label_ar: "الفنيون",          label_en: "Technicians",              color: "border-orange-500 hover:bg-orange-50", badge: "bg-orange-600", icon: "🟠" },
];

export default function DepartmentSelector() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { serverUrl } = useAppStore();
  const isAr = i18n.language === "ar";
  const isLocalhost = serverUrl.includes("localhost") || serverUrl.includes("127.0.0.1");

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-6">
      <div className="text-center mb-10">
        <img src={logoUrl} alt="Pure Home" className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg object-contain" />
        <h1 className="text-3xl font-bold text-white tracking-wide">Pure Home</h1>
        <p className="text-slate-400 text-sm mt-1">نظام صيانة فلاتر المياه</p>
      </div>

      <div className="grid grid-cols-3 gap-4 w-full max-w-2xl">
        {depts.map(d => (
          <button key={d.id} onClick={() => navigate(`/code-entry/${d.id}`)}
            className={`bg-white rounded-2xl p-6 flex flex-col items-center gap-3 border-2 transition-all shadow-sm hover:shadow-md ${d.color}`}>
            <span className="text-4xl">{d.icon}</span>
            <span className="font-bold text-slate-800 text-sm text-center">{isAr ? d.label_ar : d.label_en}</span>
            <span className="text-slate-500 text-xs text-center">{isAr ? d.label_en : d.label_ar}</span>
          </button>
        ))}
      </div>

      {/* Server status indicator */}
      <div className="mt-6 flex items-center gap-1.5 text-xs">
        <span className={`w-1.5 h-1.5 rounded-full ${isLocalhost ? "bg-yellow-400" : "bg-green-400"}`} />
        <span className="text-slate-400">{serverUrl}</span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <button onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")} className="text-slate-400 text-xs hover:text-slate-200 transition-colors">
          {isAr ? "English" : "عربي"}
        </button>
        <span className="text-slate-600 text-xs">·</span>
        <button onClick={() => navigate("/setup")} className="text-slate-400 text-xs hover:text-slate-200 transition-colors flex items-center gap-1">
          ⚙ {isAr ? "إعداد الخادم" : "Server Setup"}
        </button>
      </div>
    </div>
  );
}