import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import axios from "axios";

const DEPT_INFO: Record<string, { route: string; label_ar: string; label_en: string; color: string }> = {
  admin:      { route: "/admin/dashboard",      label_ar: "الإدارة",          label_en: "Administration",          color: "blue" },
  scheduling: { route: "/scheduling/customers", label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance", color: "green" },
  technician: { route: "/technician/queue",     label_ar: "الفنيون",          label_en: "Technicians",              color: "orange" },
};

export default function CodeEntry() {
  const { dept } = useParams<{ dept: string }>();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { serverUrl, setAdminAuth, setSchedulingAuth, setTechnicianAuth } = useAppStore();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isAr = i18n.language === "ar";

  const info = dept ? DEPT_INFO[dept] : null;
  if (!info) { navigate("/"); return null; }

  const accentMap: Record<string, string> = { blue: "focus:ring-blue-500 border-blue-300", green: "focus:ring-green-500 border-green-300", orange: "focus:ring-orange-500 border-orange-300" };
  const btnMap: Record<string, string> = { blue: "bg-blue-600 hover:bg-blue-700", green: "bg-green-600 hover:bg-green-700", orange: "bg-orange-600 hover:bg-orange-700" };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${serverUrl}/api/auth/code-login`, { code, dept }, { timeout: 30000 });
      const { token, user } = res.data.data;
      if (dept === "admin")      setAdminAuth(user, token);
      if (dept === "scheduling") setSchedulingAuth(user, token);
      if (dept === "technician") setTechnicianAuth(user, token);
      navigate(info.route);
    } catch (err: any) {
      if (err.response?.status === 401) {
        setError(isAr ? "رمز الدخول غير صحيح" : "Wrong access code");
      } else if (err.response?.status === 429) {
        setError(isAr ? "محاولات كثيرة، حاول لاحقاً" : "Too many attempts, try again later");
      } else if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        setError(isAr ? "الخادم يستيقظ — يرجى المحاولة مجدداً خلال لحظات" : "Server is waking up — please retry in a moment");
      } else if (!err.response) {
        setError(isAr ? "تعذر الاتصال — تحقق من اتصالك بالإنترنت" : "Cannot connect — check your internet connection");
      } else {
        setError(isAr ? `خطأ في الخادم: ${err.response.status}` : `Server error: ${err.response.status}`);
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <button onClick={() => navigate("/")} className="text-slate-400 hover:text-slate-600 text-sm mb-4 flex items-center gap-1">
          ← {isAr ? "رجوع" : "Back"}
        </button>
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold">{isAr ? info.label_ar : info.label_en}</h2>
          <p className="text-slate-500 text-sm mt-1">{isAr ? "أدخل رمز الدخول" : "Enter Access Code"}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
            value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0,4)); setError(""); }}
            placeholder="● ● ● ●"
            className={`w-full border-2 rounded-xl px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 ${accentMap[info.color]}`}
          />
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button type="submit" disabled={code.length !== 4 || loading}
            className={`w-full text-white py-3 rounded-xl font-semibold disabled:opacity-50 transition-colors ${btnMap[info.color]}`}>
            {loading ? (isAr ? "جاري التحميل..." : "Loading...") : (isAr ? "دخول" : "Enter")}
          </button>
        </form>
      </div>
    </div>
  );
}