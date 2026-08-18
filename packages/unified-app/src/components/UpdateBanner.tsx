import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; percent: number }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

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
    // A failed check/download is never fatal to the app — this only ever
    // shows a short, dismissible, non-blocking notice. Normal app use
    // continues regardless of update state.
    const offError = updater.onError((data) =>
      setState({ phase: "error", message: data.message })
    );

    return () => {
      offAvailable();
      offProgress();
      offDownloaded();
      offError();
    };
  }, []);

  // A download only ever completes after the user has already seen (and may
  // have dismissed) an "available"/"downloading"/"error" banner earlier in
  // the same session. autoInstallOnAppQuit is false, so the "ready" banner's
  // "Restart & Update" button is the ONLY way to install — an earlier
  // dismissal must never carry over and hide it. This does not reopen a
  // dismissed "ready" banner itself (dismissing that one is respected for
  // the rest of the session, since there is no repeat update-downloaded
  // event to react to).
  useEffect(() => {
    if (state.phase === "ready") setDismissed(false);
  }, [state.phase]);

  if (state.phase === "idle" || dismissed) return null;

  if (state.phase === "available") {
    // Auto-download is enabled — transition immediately to downloading state
    // This "available" phase is only visible for a brief moment before progress events arrive
    return (
      <div className="bg-blue-600 text-white text-xs px-4 py-1.5 flex items-center justify-between select-none shrink-0 z-50">
        <span className="font-medium">
          {isAr
            ? `تحديث جديد (${state.version}) — جاري التنزيل تلقائيًا...`
            : `Update v${state.version} available — downloading automatically...`}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="opacity-60 hover:opacity-100 transition-opacity text-base leading-none px-1 ml-3"
          aria-label="Dismiss"
        >
          ×
        </button>
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

  if (state.phase === "error") {
    return (
      <div className="bg-amber-600 text-white text-xs px-4 py-1.5 flex items-center justify-between select-none shrink-0 z-50">
        <span className="font-medium">
          {isAr
            ? "تعذر التحقق من وجود تحديث. يمكنك الاستمرار في استخدام البرنامج بشكل طبيعي، وسيتم التحقق مرة أخرى عند تشغيل البرنامج لاحقًا."
            : "Couldn't check for an update. You can keep using the app normally; updates will be checked again the next time the app starts."}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="opacity-60 hover:opacity-100 transition-opacity text-base leading-none px-1 ml-3"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    );
  }

  if (state.phase === "ready") {
    return (
      <div className="bg-green-600 text-white text-xs px-4 py-1.5 flex items-center justify-between select-none shrink-0 z-50">
        <span className="font-medium">
          {isAr
            ? `الإصدار ${state.version} جاهز — اضغط "إعادة التشغيل والتحديث" لتثبيته`
            : `v${state.version} is ready — click "Restart & Update" to install`}
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
