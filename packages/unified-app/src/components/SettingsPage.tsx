import React, { useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Socket } from "socket.io-client";
import { useSettingsStore, UserSettings } from "../store/settingsStore";
import { playChime } from "../hooks/useNotificationSound";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { Badge } from "../ui/Badge";
import { Icon, IconName } from "../ui/icons";
import { cx } from "../ui/cx";

interface Props {
  api:    { get(p: string): Promise<any>; put(p: string, d: any): Promise<any> };
  socket: Socket | null | undefined;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Section({ icon, title, desc, children }: { icon: IconName; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-md">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-line">
        <span className="w-7 h-7 rounded-md bg-surface-subtle border border-line-subtle flex items-center justify-center text-fg-muted flex-shrink-0" aria-hidden="true">
          <Icon name={icon} className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="text-2xs text-fg-muted mt-0.5">{desc}</p>
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Adapts the {value,label} option shape this page uses to the shared control. */
function OptionRow<T extends string>({ options, value, onChange, ariaLabel }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const labels: Record<string, string> = {};
  options.forEach(o => { labels[o.value] = o.label; });
  return (
    <Segmented<T>
      value={value}
      options={options.map(o => o.value)}
      labels={labels}
      onChange={onChange}
      ariaLabel={ariaLabel}
    />
  );
}

function Toggle({ value, onChange, label, desc }: { value: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-medium text-fg">{label}</p>
        {desc && <p className="text-2xs text-fg-muted mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={cx(
          "relative w-9 h-5 rounded-full transition-colors flex-shrink-0 border",
          value ? "bg-accent border-accent" : "bg-surface-active border-line-strong"
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 w-3.5 h-3.5 bg-surface rounded-full shadow-sm transition-all",
            // Offset from the inline start so the knob travels the correct way in RTL.
            value ? "start-[1.125rem]" : "start-0.5"
          )}
        />
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
    return () => { socket.off("settings:updated", onUpdated); };
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
    <div className="space-y-3 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-fg">{t("settings.title")}</h1>
          <p className="text-xs text-fg-muted mt-0.5">{t("settings.subtitle")}</p>
        </div>
        <div className="flex-shrink-0" role="status" aria-live="polite">
          {syncStatus === "saving" && <span className="text-2xs text-fg-muted animate-pulse">{t("common.loading")}</span>}
          {syncStatus === "saved"  && <Badge tone="success" dot>{t("settings.saved")}</Badge>}
          {syncStatus === "error"  && <Badge tone="danger" dot>{t("common.error")}</Badge>}
        </div>
      </div>

      {/* Theme */}
      <Section icon="settings" title={t("settings.theme")} desc={t("settings.themeDesc")}>
        <OptionRow options={themeOpts} value={settings.theme} onChange={(v) => change("theme", v)} ariaLabel={t("settings.theme")} />
      </Section>

      {/* Font Size */}
      <Section icon="edit" title={t("settings.fontSize")} desc={t("settings.fontSizeDesc")}>
        <OptionRow options={fontOpts} value={settings.fontSize} onChange={(v) => change("fontSize", v)} ariaLabel={t("settings.fontSize")} />
        <p className="mt-3 text-[0.8125rem] text-fg-secondary">
          {t("settings.fontPreview")}: <span className="font-medium text-fg">Pure Home</span>
        </p>
      </Section>

      {/* Interface Scale */}
      <Section icon="dashboard" title={t("settings.scale")} desc={t("settings.scaleDesc")}>
        <OptionRow options={scaleOpts} value={settings.interfaceScale} onChange={(v) => change("interfaceScale", v)} ariaLabel={t("settings.scale")} />
      </Section>

      {/* Background */}
      <Section icon="info" title={t("settings.background")} desc={t("settings.backgroundDesc")}>
        <OptionRow options={bgOpts} value={settings.background} onChange={(v) => change("background", v)} ariaLabel={t("settings.background")} />
      </Section>

      {/* Accessibility */}
      <Section icon="help" title={t("settings.accessibility")} desc={t("settings.accessibilityDesc")}>
        <Toggle value={settings.highContrast}        onChange={(v) => change("highContrast",        v)} label={t("settings.highContrast")}  desc={t("settings.highContrastDesc")} />
        <div className="border-t border-line-subtle my-1" />
        <Toggle value={settings.improvedReadability} onChange={(v) => change("improvedReadability", v)} label={t("settings.readability")}    desc={t("settings.readabilityDesc")} />
      </Section>

      {/* Notifications */}
      <Section icon="notifications" title={t("settings.notifications")} desc={t("settings.notificationsDesc")}>
        <Toggle value={settings.notificationsEnabled} onChange={(v) => change("notificationsEnabled", v)} label={t("settings.notifEnabled")} desc={t("settings.notifEnabledDesc")} />
      </Section>

      {/* Sound */}
      <Section icon="messaging" title={t("settings.sound")} desc={t("settings.soundDesc")}>
        <Toggle value={settings.soundEnabled} onChange={(v) => change("soundEnabled", v)} label={t("settings.soundEnabled")} />

        <div className={cx("mt-3 space-y-3 transition-opacity", !settings.soundEnabled && "opacity-40 pointer-events-none")}>
          <div className="flex items-center gap-3">
            <label htmlFor="sound-volume" className="text-xs text-fg-secondary w-20 flex-shrink-0">{t("settings.soundVolume")}</label>
            <input
              id="sound-volume"
              type="range" min={0} max={100} value={settings.soundVolume}
              onChange={(e) => change("soundVolume", Number(e.target.value))}
              className="flex-1 accent-[var(--ph-accent)]"
            />
            <span className="text-2xs font-mono text-fg-secondary w-9 text-end tabular-nums">{settings.soundVolume}%</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => playChime(settings.soundVolume / 100)}>
            {t("settings.soundTest")}
          </Button>
        </div>
      </Section>

      {/* The "Interface Colors" section used to live here. It edited
          primaryColor / secondaryColor / buttonColor / cardColor, which only
          ever drove the per-department chrome the redesign replaced with one
          token-based identity -- so the controls had no visible effect any
          more. The settings themselves are untouched: still typed, still
          defaulted, still loaded from and saved to the server, and still
          applied as CSS custom properties by applySettings(). Only the editor
          is gone, so any value a user stored previously survives. */}
    </div>
  );
}
