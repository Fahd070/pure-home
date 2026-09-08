import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/icons";

type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; percent: number }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };

/** One strip shape for every update phase; only the tone and content change. */
function Strip({
  tone, children, onDismiss, action,
}: {
  tone: "info" | "progress" | "warning" | "success";
  children: React.ReactNode;
  onDismiss?: () => void;
  action?: React.ReactNode;
}) {
  const TONES = {
    info:     "bg-info-bg     border-info-border     text-info-fg",
    progress: "bg-progress-bg border-progress-border text-progress-fg",
    warning:  "bg-warning-bg  border-warning-border  text-warning-fg",
    success:  "bg-success-bg  border-success-border  text-success-fg",
  };
  return (
    <div
      role="status"
      className={`${TONES[tone]} border-b text-2xs px-4 py-1.5 flex items-center gap-3 select-none flex-shrink-0`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-3">{children}</div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="w-5 h-5 rounded flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
          aria-label="Dismiss"
        >
          <Icon name="close" className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

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
      <Strip tone="info" onDismiss={() => setDismissed(true)}>
        <Icon name="download" className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium truncate">
          {isAr
            ? `تحديث جديد (${state.version}) — جاري التنزيل تلقائيًا...`
            : `Update v${state.version} available — downloading automatically...`}
        </span>
      </Strip>
    );
  }

  if (state.phase === "downloading") {
    return (
      <Strip tone="progress">
        <span className="flex-shrink-0 font-medium tabular-nums">
          {isAr
            ? `جاري تنزيل التحديث... ${state.percent}%`
            : `Downloading update... ${state.percent}%`}
        </span>
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden bg-progress-border"
          role="progressbar"
          aria-valuenow={Math.round(state.percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="bg-progress-solid h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${state.percent}%` }}
          />
        </div>
      </Strip>
    );
  }

  if (state.phase === "error") {
    return (
      <Strip tone="warning" onDismiss={() => setDismissed(true)}>
        <Icon name="info" className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium">
          {isAr
            ? "تعذر التحقق من وجود تحديث. يمكنك الاستمرار في استخدام البرنامج بشكل طبيعي، وسيتم التحقق مرة أخرى عند تشغيل البرنامج لاحقًا."
            : "Couldn't check for an update. You can keep using the app normally; updates will be checked again the next time the app starts."}
        </span>
      </Strip>
    );
  }

  if (state.phase === "ready") {
    return (
      <Strip
        tone="success"
        action={
          <button
            type="button"
            onClick={() => window.electron.updater.install()}
            className="bg-success-solid text-white font-semibold px-2.5 h-6 rounded text-2xs hover:brightness-110 transition-[filter] flex-shrink-0"
          >
            {isAr ? "إعادة التشغيل والتحديث" : "Restart & Update"}
          </button>
        }
      >
        <Icon name="check" className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium truncate">
          {isAr
            ? `الإصدار ${state.version} جاهز — اضغط "إعادة التشغيل والتحديث" لتثبيته`
            : `v${state.version} is ready — click "Restart & Update" to install`}
        </span>
      </Strip>
    );
  }

  return null;
}
