import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserSettings {
  theme:                "light" | "dark" | "system";
  fontSize:             "small" | "medium" | "large" | "xlarge";
  interfaceScale:       "compact" | "normal" | "comfortable";
  background:           "day" | "night";
  highContrast:         boolean;
  improvedReadability:  boolean;
  notificationsEnabled: boolean;
  soundEnabled:         boolean;
  soundVolume:          number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme:                "light",
  fontSize:             "medium",
  interfaceScale:       "normal",
  background:           "day",
  highContrast:         false,
  improvedReadability:  false,
  notificationsEnabled: true,
  soundEnabled:         true,
  soundVolume:          70,
};

export function applySettings(s: UserSettings) {
  const h = document.documentElement;
  h.setAttribute("data-theme",       s.theme);
  h.setAttribute("data-font",        s.fontSize);
  h.setAttribute("data-scale",       s.interfaceScale);
  h.setAttribute("data-bg",          s.background);
  h.setAttribute("data-contrast",    s.highContrast        ? "high" : "normal");
  h.setAttribute("data-readability", s.improvedReadability ? "on"   : "off");
}

interface SettingsStore {
  settings:   UserSettings;
  isLoaded:   boolean;
  setSettings:    (partial: Partial<UserSettings>) => void;
  loadFromServer: (s: UserSettings) => void;
  reset:          () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings:  DEFAULT_SETTINGS,
      isLoaded:  false,
      setSettings: (partial) => {
        const next = { ...get().settings, ...partial };
        set({ settings: next });
        applySettings(next);
      },
      loadFromServer: (s) => {
        set({ settings: s, isLoaded: true });
        applySettings(s);
      },
      reset: () => {
        set({ settings: DEFAULT_SETTINGS });
        applySettings(DEFAULT_SETTINGS);
      },
    }),
    {
      name: "wfm-settings",
      partialize: (s) => ({ settings: s.settings }),
      onRehydrateStorage: () => (state) => {
        if (state?.settings) applySettings(state.settings);
      },
    }
  )
);
