import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { useAppStore } from "../store/appStore";

const logoUrl = new URL("../../assets/icon.png", import.meta.url).href;

const depts = [
  { id: "admin",      label_ar: "الإدارة",          label_en: "Administration",          color: "border-blue-500 hover:bg-blue-50",    badge: "bg-blue-600",   icon: "🔵" },
  { id: "scheduling", label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance", color: "border-green-500 hover:bg-green-50",  badge: "bg-green-600",  icon: "🟢" },
  { id: "technician", label_ar: "الفنيون",          label_en: "Technicians",              color: "border-orange-500 hover:bg-orange-50", badge: "bg-orange-600", icon: "🟠" },
];

type ServerStatus = "checking" | "online" | "offline";

export default function DepartmentSelector() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { serverUrl } = useAppStore();
  const isAr = i18n.language === "ar";

  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    setServerStatus("checking");
    const controller = new AbortController();
    axios
      .get(serverUrl + "/health", { signal: controller.signal, timeout: 10000 })
      .then(() => setServerStatus("online"))
      .catch(() => {
        if (!controller.signal.aborted) setServerStatus("offline");
      });
    return () => controller.abort();
  }, [serverUrl]);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 p-6">
      <div className="text-center mb-10">
        <img src={logoUrl} alt="Pure Home" className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-lg object-contain" />
        <h1 className="text-3xl font-bold text-white tracking-wide">Pure Home</h1>
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
        {serverStatus === "checking" && (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
        )}
        {serverStatus === "online" && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        )}
        {serverStatus === "offline" && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        )}
        <span className="text-slate-400">
          {serverStatus === "checking"
            ? (isAr ? "جاري الاتصال..." : "Connecting...")
            : serverStatus === "offline"
            ? (isAr ? "تعذر الاتصال — تحقق من الإنترنت" : "Cannot reach server — check your connection")
            : serverUrl}
        </span>
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

      <div className="mt-4">
        <a
          href="https://wa.me/966501698445"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 transition-colors text-green-400 hover:text-green-300 text-xs font-medium"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 flex-shrink-0">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          {isAr ? "دعم النظام / الإبلاغ عن مشكلة" : "System Support / Report an Issue"}
        </a>
      </div>
    </div>
  );
}