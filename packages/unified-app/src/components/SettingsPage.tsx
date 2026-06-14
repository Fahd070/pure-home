import React, { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Socket } from "socket.io-client";
import { useSettingsStore, UserSettings } from "../store/settingsStore";
import { playChime } from "../hooks/useNotificationSound";

interface Props {
  api:    { get(p: string): Promise<any>; put(p: string, d: any): Promise<any> };
  socket: Socket | null | undefined;
  showSupport?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ icon, title, desc, children }: { icon: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">{title}</h3>
          <p className="text-xs text-slate-400">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SegControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-slate-100 rounded-lg p-1 gap-1 flex-wrap">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all min-w-fit ${
            value === o.value
              ? "bg-white shadow text-slate-800"
              : "text-slate-500 hover:text-slate-700"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange, label, desc }: { value: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {desc && <p className="text-xs text-slate-400">{desc}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors ${value ? "bg-blue-600" : "bg-slate-200"}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

// ── Theme Color Section ───────────────────────────────────────────────────────
function ThemeColorSection({ t, settings, change }: { t: any; settings: any; change: any }) {
  const defaults = { primaryColor: "#000080", secondaryColor: "#f8fafc", buttonColor: "#000080", cardColor: "#ffffff" };
  const [draft, setDraft] = React.useState({
    primaryColor: settings.primaryColor || defaults.primaryColor,
    secondaryColor: settings.secondaryColor || defaults.secondaryColor,
    buttonColor: settings.buttonColor || defaults.buttonColor,
    cardColor: settings.cardColor || defaults.cardColor,
  });

  const labelMap: Record<string, string> = {
    primaryColor:   t("settings.primaryColor"),
    secondaryColor: t("settings.secondaryColor"),
    buttonColor:    t("settings.buttonColor"),
    cardColor:      t("settings.cardColor"),
  };

  function handleApplyAndSave() {
    const h = document.documentElement;
    h.style.setProperty("--color-primary", draft.primaryColor);
    h.style.setProperty("--color-secondary", draft.secondaryColor);
    h.style.setProperty("--color-button", draft.buttonColor);
    h.style.setProperty("--color-card", draft.cardColor);
    Object.entries(draft).forEach(([k, v]) => change(k as any, v));
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">🖌️</span>
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">{t("settings.themeColors")}</h3>
          <p className="text-xs text-slate-400">{t("settings.themeColorsDesc")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        {(["primaryColor","secondaryColor","buttonColor","cardColor"] as const).map(key => (
          <div key={key} className="flex items-center gap-3">
            <input type="color" value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
              className="w-10 h-10 rounded-lg cursor-pointer border border-slate-200 p-0.5" />
            <div>
              <p className="text-xs font-medium text-slate-700">{labelMap[key]}</p>
              <p className="text-xs text-slate-400 font-mono">{draft[key]}</p>
            </div>
          </div>
        ))}
      </div>
      {/* Live Preview */}
      <div className="border rounded-xl p-4 mb-4 space-y-2" style={{ backgroundColor: draft.cardColor }}>
        <p className="text-xs font-semibold text-slate-500 mb-2">
          {t("settings.livePreview") || "Live Preview"}
        </p>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: draft.primaryColor }}>PH</div>
          <span className="text-sm font-semibold" style={{ color: draft.primaryColor }}>Pure Home</span>
        </div>
        <button className="text-xs text-white px-3 py-1.5 rounded-lg font-medium" style={{ backgroundColor: draft.buttonColor }}>
          {t("common.save")}
        </button>
      </div>
      <div className="flex gap-2">
        <button onClick={handleApplyAndSave}
          className="flex-1 text-white text-sm py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
          style={{ backgroundColor: draft.primaryColor }}>
          ✓ {t("settings.applyColors") || "Apply & Save"}
        </button>
        <button onClick={() => setDraft({ ...defaults })}
          className="text-xs text-slate-500 hover:text-slate-700 border px-3 py-2 rounded-lg hover:bg-slate-50">
          ↺ {t("settings.resetColors")}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SettingsPage({ api, socket, showSupport }: Props) {
  const { t } = useTranslation();
  const { settings, setSettings, loadFromServer } = useSettingsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncMsg   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncStatus, setSyncStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");

  // Load from server on mount
  useEffect(() => {
    api.get("/settings").then((r: any) => {
      if (r.data?.success) loadFromServer(r.data.data);
    }).catch(() => {});
  }, []);

  // Socket: reload if another device updated settings
  useEffect(() => {
    if (!socket) return;
    const onUpdated = (data: UserSettings) => {
      loadFromServer(data);
      setSyncStatus("saved");
      if (syncMsg.current) clearTimeout(syncMsg.current);
      syncMsg.current = setTimeout(() => setSyncStatus("idle"), 2500);
    };
    socket.on("settings:updated", onUpdated);
    return () => socket.off("settings:updated", onUpdated);
  }, [socket, loadFromServer]);

  const save = useCallback((patch: Partial<UserSettings>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSyncStatus("saving");
    saveTimer.current = setTimeout(() => {
      api.put("/settings", patch)
        .then(() => {
          setSyncStatus("saved");
          if (syncMsg.current) clearTimeout(syncMsg.current);
          syncMsg.current = setTimeout(() => setSyncStatus("idle"), 2000);
        })
        .catch(() => setSyncStatus("error"));
    }, 600);
  }, [api]);

  const change = useCallback(<K extends keyof UserSettings>(key: K, val: UserSettings[K]) => {
    setSettings({ [key]: val } as Partial<UserSettings>);
    save({ [key]: val } as Partial<UserSettings>);
  }, [setSettings, save]);

  const themeOpts  = [{ value: "light", label: t("settings.themeLight") }, { value: "dark", label: t("settings.themeDark") }, { value: "system", label: t("settings.themeSystem") }] as const;
  const fontOpts   = [{ value: "small", label: t("settings.fontSmall") }, { value: "medium", label: t("settings.fontMedium") }, { value: "large", label: t("settings.fontLarge") }, { value: "xlarge", label: t("settings.fontXLarge") }] as const;
  const scaleOpts  = [{ value: "compact", label: t("settings.scaleCompact") }, { value: "normal", label: t("settings.scaleNormal") }, { value: "comfortable", label: t("settings.scaleComfortable") }] as const;
  const bgOpts     = [{ value: "day", label: t("settings.bgDay") }, { value: "night", label: t("settings.bgNight") }] as const;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("settings.title")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("settings.subtitle")}</p>
        </div>
        <div className="text-xs px-3 py-1.5 rounded-full font-medium transition-all">
          {syncStatus === "saving" && <span className="text-blue-500 animate-pulse">{t("common.loading")}</span>}
          {syncStatus === "saved"  && <span className="text-green-600 bg-green-50 px-3 py-1.5 rounded-full">✓ {t("settings.saved")}</span>}
          {syncStatus === "error"  && <span className="text-red-500">{t("common.error")}</span>}
        </div>
      </div>

      {/* Theme */}
      <Section icon="🎨" title={t("settings.theme")} desc={t("settings.themeDesc")}>
        <SegControl options={themeOpts as any} value={settings.theme} onChange={(v) => change("theme", v)} />
      </Section>

      {/* Font Size */}
      <Section icon="🔤" title={t("settings.fontSize")} desc={t("settings.fontSizeDesc")}>
        <SegControl options={fontOpts as any} value={settings.fontSize} onChange={(v) => change("fontSize", v)} />
        <p className="mt-3 text-slate-500 text-sm">{t("settings.fontPreview")}: <span className="font-medium text-slate-700">Pure Home</span></p>
      </Section>

      {/* Interface Scale */}
      <Section icon="📐" title={t("settings.scale")} desc={t("settings.scaleDesc")}>
        <SegControl options={scaleOpts as any} value={settings.interfaceScale} onChange={(v) => change("interfaceScale", v)} />
      </Section>

      {/* Background */}
      <Section icon="🌅" title={t("settings.background")} desc={t("settings.backgroundDesc")}>
        <SegControl options={bgOpts as any} value={settings.background} onChange={(v) => change("background", v)} />
      </Section>

      {/* Accessibility */}
      <Section icon="♿" title={t("settings.accessibility")} desc={t("settings.accessibilityDesc")}>
        <Toggle value={settings.highContrast}        onChange={(v) => change("highContrast",        v)} label={t("settings.highContrast")}  desc={t("settings.highContrastDesc")} />
        <div className="border-t border-slate-100 my-1" />
        <Toggle value={settings.improvedReadability} onChange={(v) => change("improvedReadability", v)} label={t("settings.readability")}    desc={t("settings.readabilityDesc")} />
      </Section>

      {/* Notifications */}
      <Section icon="🔔" title={t("settings.notifications")} desc={t("settings.notificationsDesc")}>
        <Toggle value={settings.notificationsEnabled} onChange={(v) => change("notificationsEnabled", v)} label={t("settings.notifEnabled")} desc={t("settings.notifEnabledDesc")} />
      </Section>

      {/* Sound */}
      <Section icon="🔊" title={t("settings.sound")} desc={t("settings.soundDesc")}>
        <Toggle value={settings.soundEnabled} onChange={(v) => change("soundEnabled", v)} label={t("settings.soundEnabled")} />

        <div className={`mt-3 space-y-3 transition-opacity ${settings.soundEnabled ? "" : "opacity-40 pointer-events-none"}`}>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 w-20">{t("settings.soundVolume")}</span>
            <input type="range" min={0} max={100} value={settings.soundVolume}
              onChange={(e) => change("soundVolume", Number(e.target.value))}
              className="flex-1 accent-blue-600" />
            <span className="text-xs font-mono text-slate-600 w-8 text-right">{settings.soundVolume}%</span>
          </div>
          <button onClick={() => playChime(settings.soundVolume / 100)}
            className="flex items-center gap-2 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded-lg font-medium transition-colors border border-blue-200">
            <span>▶</span> {t("settings.soundTest")}
          </button>
        </div>
      </Section>

      {/* Theme Colors */}
      <ThemeColorSection t={t} settings={settings} change={change} />

      {/* Support / Report Problem */}
      {showSupport && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">🛟</span>
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">{t("settings.supportTitle") || "الدعم الفني"}</h3>
              <p className="text-xs text-slate-400">{t("settings.supportDesc") || "تواصل معنا عبر واتساب للإبلاغ عن أي مشكلة"}</p>
            </div>
          </div>
          <a
            href="https://wa.me/966501698445"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-green-500/40 bg-green-500/10 hover:bg-green-500/20 transition-colors text-green-700 font-medium text-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0 text-green-600">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            الإبلاغ عن مشكلة
          </a>
        </div>
      )}
    </div>
  );
}
