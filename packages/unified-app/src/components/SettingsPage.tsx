import React, { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Socket } from "socket.io-client";
import { useSettingsStore, UserSettings } from "../store/settingsStore";
import { playChime } from "../hooks/useNotificationSound";

interface Props {
  api:    { get(p: string): Promise<any>; put(p: string, d: any): Promise<any> };
  socket: Socket | null | undefined;
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function SettingsPage({ api, socket }: Props) {
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
    </div>
  );
}
