import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { useAppStore } from "../store/appStore";

const logoUrl = new URL("../../assets/icon.png", import.meta.url).href;

const DEPT_COLORS = {
  admin:      "#0A0A2E",
  scheduling: "#2A533F",
  technician: "#014245",
} as const;

const depts = [
  { id: "admin"      as const, label_ar: "الإدارة",          label_en: "Administration" },
  { id: "scheduling" as const, label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance" },
  { id: "technician" as const, label_ar: "الفنيون",          label_en: "Technicians" },
];

type ServerStatus = "checking" | "online" | "offline";

function DeptCard({ dept, isAr, onClick }: { dept: typeof depts[number]; isAr: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // Focus/select readability fix: hover (mouse) and focus (keyboard Tab) both
  // switch the card into the same "active" look -- a SOLID fill of the
  // department's own color, matching how that exact color is already used as
  // a solid background elsewhere in the app (Admin/Scheduling/Technician
  // sidebars and headers), always paired with white text there. The previous
  // version only tinted the background ~9% opacity while leaving the label
  // text dark, which stayed readable at that faint tint but was never
  // readable against a more prominent highlight -- this makes the fill solid
  // and the text white together, so contrast is correct by construction
  // instead of tuned by eye.
  const active = hovered || focused;
  const color = DEPT_COLORS[dept.id];

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="rounded-2xl px-5 py-7 flex flex-col items-center justify-center gap-2 border-2 transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800"
      style={{
        backgroundColor: active ? color : "#ffffff",
        borderColor: color,
        boxShadow: active ? `0 4px 16px ${color}66` : "0 1px 3px rgba(0,0,0,0.08)",
        transform: active ? "translateY(-2px)" : "none",
      }}
    >
      <span className={`font-bold text-sm text-center ${active ? "text-white" : "text-slate-800"}`}>
        {isAr ? dept.label_ar : dept.label_en}
      </span>
      <span className={`text-xs text-center ${active ? "text-white/80" : "text-slate-400"}`}>
        {isAr ? dept.label_en : dept.label_ar}
      </span>
    </button>
  );
}

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
          <DeptCard key={d.id} dept={d} isAr={isAr} onClick={() => navigate(`/code-entry/${d.id}`)} />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-1.5 text-xs">
        {serverStatus === "checking" && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />}
        {serverStatus === "online"   && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        {serverStatus === "offline"  && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
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
    </div>
  );
}
