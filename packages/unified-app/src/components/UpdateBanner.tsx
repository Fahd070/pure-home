import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; percent: number }
  | { phase: "ready"; version: string };

export default function UpdateBanner() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electron?.updater) return;
    const { updater } = window.electron;

    const offAvailable = updater.onAvailable((info) =>
      setState({ phase: "available", version: info.version })
    );
    const offProgress = updater.onProgress((data) =>
      setState((s) =>
        s.phase === "available" || s.phase === "downloading"
          ? { phase: "downloading", percent: data.percent }
          : s
      )
    );
    const offDownloaded = updater.onDownloaded((info) =>
      setState({ phase: "ready", version: info.version })
    );

    return () => {
      offAvailable();
      offProgress();
      offDownloaded();
    };
  }, []);

  if (state.phase === "idle" || dismissed) return null;

  if (state.phase === "available") {
    return (
      <div className="bg-blue-600 text-white text-xs px-4 py-1.5 flex items-center justify-between select-none shrink-0 z-50">
        <span className="font-medium">
          {isAr
            ? `تحديث جديد متاح — الإصدار ${state.version}`
            : `New update available — v${state.version}`}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setState({ phase: "downloading", percent: 0 });
              window.electron.updater.download().catch(() => setState({ phase: "idle" }));
            }}
            className="bg-white text-blue-700 font-semibold px-3 py-0.5 rounded text-xs hover:bg-blue-50 transition-colors"
          >
            {isAr ? "تنزيل الآن" : "Download Now"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="opacity-60 hover:opacity-100 transition-opacity text-base leading-none px-1"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "downloading") {
    return (
      <div className="bg-blue-700 text-white text-xs px-4 py-1.5 flex items-center gap-3 select-none shrink-0 z-50">
        <span className="shrink-0 font-medium">
          {isAr
            ? `جاري تنزيل التحديث... ${state.percent}%`
            : `Downloading update... ${state.percent}%`}
        </span>
        <div className="flex-1 bg-blue-900 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-white h-1.5 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${state.percent}%` }}
          />
        </div>
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="bg-green-600 text-white text-xs px-4 py-1.5 flex items-center justify-between select-none shrink-0 z-50">
        <span className="font-medium">
          {isAr
            ? `الإصدار ${state.version} جاهز — سيتم التثبيت عند إعادة التشغيل`
            : `v${state.version} downloaded — will install on restart`}
        </span>
        <button
          onClick={() => window.electron.updater.install()}
          className="bg-white text-green-700 font-semibold px-3 py-0.5 rounded text-xs hover:bg-green-50 transition-colors"
        >
          {isAr ? "إعادة التشغيل والتحديث" : "Restart & Update"}
        </button>
      </div>
    );
  }

  return null;
}
