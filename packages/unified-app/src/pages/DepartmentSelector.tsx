import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { useAppStore } from "../store/appStore";
import { Icon } from "../ui/icons";
import { cx } from "../ui/cx";

const logoUrl = new URL("../../assets/icon.png", import.meta.url).href;

const depts: { id: "admin" | "scheduling" | "technician"; label_ar: string; label_en: string }[] = [
  { id: "admin",      label_ar: "الإدارة",          label_en: "Administration" },
  { id: "scheduling", label_ar: "الجدولة والصيانة", label_en: "Scheduling & Maintenance" },
  { id: "technician", label_ar: "الفنيون",          label_en: "Technicians" },
];

type ServerStatus = "checking" | "online" | "offline";

/**
 * Each department used to be identified by its own brand colour, and the card
 * flipped to a solid fill of that colour on hover so the label had to switch to
 * white to stay readable. The active fill is now the single product accent, so
 * the contrast is fixed by the tokens rather than balanced by hand per colour.
 *
 * Two deliberate earlier decisions are kept: the card renders NO icon (exactly
 * two label spans, no wrapper elements), and hover and keyboard focus drive the
 * SAME active state, so a keyboard user sees exactly what a mouse user sees.
 */
function DeptCard({
  dept, isAr, onClick,
}: { dept: typeof depts[number]; isAr: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = hovered || focused;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cx(
        "rounded-lg px-5 py-6 flex flex-col items-center justify-center gap-2 border transition-colors duration-100",
        "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        active ? "bg-accent border-accent" : "bg-surface border-line"
      )}
    >
      <span className={cx("font-semibold text-[0.8125rem] text-center", active ? "text-accent-fg" : "text-fg")}>
        {isAr ? dept.label_ar : dept.label_en}
      </span>
      <span className={cx("text-2xs text-center", active ? "text-accent-fg" : "text-fg-muted")}>
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

  const statusDot =
    serverStatus === "checking" ? "bg-warning-solid animate-pulse"
    : serverStatus === "online" ? "bg-success-solid"
    : "bg-danger-solid";

  return (
    <div className="h-full flex flex-col items-center justify-center bg-canvas p-6">
      <div className="text-center mb-9">
        <img src={logoUrl} alt="" className="w-16 h-16 mx-auto mb-3 rounded-lg object-contain" />
        <h1 className="text-xl font-semibold text-fg tracking-tight">Pure Home</h1>
        <p className="text-xs text-fg-muted mt-1">
          {isAr ? "اختر القسم" : "Choose your department"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 w-full max-w-2xl">
        {depts.map(d => (
          <DeptCard key={d.id} dept={d} isAr={isAr} onClick={() => navigate(`/code-entry/${d.id}`)} />
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2 text-2xs">
        <span className={cx("w-1.5 h-1.5 rounded-full flex-shrink-0", statusDot)} aria-hidden="true" />
        <span className="text-fg-muted">
          {serverStatus === "checking"
            ? (isAr ? "جاري الاتصال..." : "Connecting...")
            : serverStatus === "offline"
            ? (isAr ? "تعذر الاتصال — تحقق من الإنترنت" : "Cannot reach server — check your connection")
            : serverUrl}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => i18n.changeLanguage(isAr ? "en" : "ar")}
          className="text-fg-muted text-2xs hover:text-fg transition-colors inline-flex items-center gap-1.5"
        >
          <Icon name="language" className="w-3.5 h-3.5" />
          {isAr ? "English" : "عربي"}
        </button>
        <span className="text-line-strong text-2xs" aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => navigate("/setup")}
          className="text-fg-muted text-2xs hover:text-fg transition-colors inline-flex items-center gap-1.5"
        >
          <Icon name="settings" className="w-3.5 h-3.5" />
          {isAr ? "إعداد الخادم" : "Server Setup"}
        </button>
      </div>
    </div>
  );
}
