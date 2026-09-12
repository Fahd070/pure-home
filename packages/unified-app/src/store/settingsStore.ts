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
  primaryColor?:        string;
  secondaryColor?:      string;
  buttonColor?:         string;
  cardColor?:           string;
}

/**
 * What GET /api/settings returns: the settings themselves plus one additive
 * flag saying whether a stored row exists for this user. The flag is not a
 * setting and is never persisted here.
 */
export type ServerSettingsPayload = Partial<UserSettings> & { hasSavedSettings?: boolean };

export const DEFAULT_SETTINGS: UserSettings = {
  // Light is the first-launch experience, so it is the FALLBACK used when no
  // preference exists yet. This never overrides a saved choice: zustand's
  // persist middleware merges whatever is in localStorage on top of these
  // defaults, and loadFromServer() merges the server's SAVED keys on top of
  // that -- so a user who previously chose Dark keeps Dark, and one who chose
  // Light keeps Light.
  theme:                "light",
  fontSize:             "medium",
  // v4 Requirement #15: a device with no saved interface-scale preference
  // renders LARGE. "comfortable" is this product's name for the largest of the
  // three scales (compact / normal / comfortable -- see ui/tokens.css), so this
  // is that requirement's "large", not a fourth value.
  //
  // It is the STORE DEFAULT rather than something applied after a request, so
  // the first paint is already correct: zustand's persist storage is
  // synchronous, so a returning user's saved scale is merged over this before
  // the first render and a brand-new user never sees a normal-to-large flash.
  interfaceScale:       "comfortable",
  background:           "day",
  highContrast:         false,
  improvedReadability:  false,
  notificationsEnabled: true,
  soundEnabled:         true,
  soundVolume:          70,
  primaryColor:         undefined,
  secondaryColor:       "#f8fafc",
  buttonColor:          "#000080",
  cardColor:            "#ffffff",
};

export function applySettings(s: UserSettings) {
  const h = document.documentElement;
  h.setAttribute("data-theme",       s.theme);
  h.setAttribute("data-font",        s.fontSize);
  h.setAttribute("data-scale",       s.interfaceScale);
  h.setAttribute("data-bg",          s.background);
  h.setAttribute("data-contrast",    s.highContrast        ? "high" : "normal");
  h.setAttribute("data-readability", s.improvedReadability ? "on"   : "off");
  if (s.primaryColor)   h.style.setProperty("--color-primary",   s.primaryColor);
  if (s.secondaryColor) h.style.setProperty("--color-secondary", s.secondaryColor);
  if (s.buttonColor)    h.style.setProperty("--color-button",    s.buttonColor);
  if (s.cardColor)      h.style.setProperty("--color-card",      s.cardColor);
}

interface SettingsStore {
  settings:   UserSettings;
  isLoaded:   boolean;
  setSettings:    (partial: Partial<UserSettings>) => void;
  /**
   * Accepts the server settings payload, plus the additive `hasSavedSettings`
   * flag that says whether a stored row exists at all.
   */
  loadFromServer: (s: ServerSettingsPayload) => void;
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
      /**
       * Applies the settings the server has SAVED for this user.
       *
       * Merges rather than replaces, and skips any key the server omitted.
       * The server omits `interfaceScale` when the user has never saved
       * anything (see routes/settings.ts); replacing the whole object would
       * hand that user a synthesized value and silently overwrite this store's
       * own first-run default -- which is the v4 Requirement #15 defect.
       *
       * `undefined` is the only "absent" signal treated specially here; an
       * explicitly saved value, including the middle option, always wins.
       */
      /**
       * Applies the settings the server holds for this user.
       *
       * Merges rather than replaces, and restricts the merge to known setting
       * keys so response fields that are not settings (`hasSavedSettings`)
       * never end up in the object this store persists. Replacing the whole
       * object was the v4 Requirement #15 defect: it let the server's payload
       * overwrite preferences the server was not actually authoritative for.
       *
       * `interfaceScale` is the one field the server reports even when it has
       * nothing saved -- it always sends a legacy-valid value so Desktop v3.6.5
       * keeps working (see routes/settings.ts). That synthesized 'normal' must
       * NOT be treated as a preference, or every device with no saved row would
       * be dragged off this store's LARGE default the moment the Settings page
       * fetched. `hasSavedSettings === false` is exactly the signal that the
       * value is synthesized, so the scale is dropped from the merge and the
       * local/device value (or the LARGE default) stands.
       *
       * When a row DOES exist its stored scale wins, including an explicit
       * middle value -- deliberately conservative: nothing stored can prove a
       * historical 'normal' was accidental, so it is never second-guessed.
       */
      loadFromServer: (incoming) => {
        const { hasSavedSettings, ...fields } = incoming ?? {};
        const saved = Object.fromEntries(
          Object.entries(fields).filter(
            ([k, v]) => v !== undefined && k in DEFAULT_SETTINGS
          )
        ) as Partial<UserSettings>;

        if (hasSavedSettings === false) delete saved.interfaceScale;

        const next = { ...get().settings, ...saved };
        set({ settings: next, isLoaded: true });
        applySettings(next);
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
