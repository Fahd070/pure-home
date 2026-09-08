import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store/appStore";
import axios from "axios";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Feedback";
import { Icon } from "../ui/icons";
import { AppLoadingScreen } from "../ui/AppLoadingScreen";

// The per-department accent colour that used to tint this form is gone -- the
// department is stated in the heading instead, and the form uses the one
// product accent, so a fourth palette does not appear at the login step.
const DEPT_INFO: Record<string, { route: string; label_ar: string; label_en: string }> = {
  admin:      { route: "/admin/dashboard",      label_ar: "الإدارة",          label_en: "Administration" },
  scheduling: { route: "/scheduling/customers", label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance" },
  technician: { route: "/technician/queue",     label_ar: "الفنيون",          label_en: "Technicians" },
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
  // Captured here (where `info` is narrowed non-null) rather than read from
  // `info.route` inside handleSubmit below -- TS control-flow narrowing does
  // not persist into nested closures, so a fresh, already-non-null binding
  // sidesteps that without a non-null assertion.
  const targetRoute = info.route;

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
      navigate(targetRoute);
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

  // Presentation of the EXISTING `loading` state -- the same boolean the submit
  // button already used. No auth logic, timing or navigation is changed here;
  // the department session is established exactly as before, this just gives
  // that moment a proper full-surface transition instead of a button spinner.
  if (loading) {
    return (
      <AppLoadingScreen
        label={isAr ? "جاري التحميل" : "Loading"}
        sublabel={isAr ? info.label_ar : info.label_en}
      />
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-canvas p-6">
      <div className="bg-surface border border-line rounded-lg shadow-md p-7 w-full max-w-sm">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-fg-muted hover:text-fg text-2xs mb-5 inline-flex items-center gap-1.5 transition-colors"
        >
          <Icon name="chevronStart" className="w-3.5 h-3.5 rtl:rotate-180" />
          {isAr ? "رجوع" : "Back"}
        </button>

        <div className="text-center mb-6">
          <h2 className="text-base font-semibold text-fg">{isAr ? info.label_ar : info.label_en}</h2>
          <p className="text-xs text-fg-muted mt-1">{isAr ? "أدخل رمز الدخول" : "Enter Access Code"}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password" inputMode="numeric" pattern="\d{4}" maxLength={4}
            value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0,4)); setError(""); }}
            placeholder="● ● ● ●"
            autoFocus
            aria-label={isAr ? "رمز الدخول" : "Access code"}
            aria-invalid={!!error}
            className={[
              "w-full rounded-md border bg-surface text-fg placeholder:text-fg-muted",
              "px-4 py-3 text-center text-xl tracking-[0.5em] font-medium",
              "transition-colors hover:border-line-strong focus:border-accent",
              error ? "border-danger-solid" : "border-line",
            ].join(" ")}
          />

          {error && <Callout tone="danger">{error}</Callout>}

          <Button type="submit" variant="primary" block disabled={code.length !== 4} loading={loading} className="h-11">
            {loading ? (isAr ? "جاري التحميل..." : "Loading...") : (isAr ? "دخول" : "Enter")}
          </Button>
        </form>
      </div>
    </div>
  );
}
