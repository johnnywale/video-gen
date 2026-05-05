import { create } from "zustand";
import { AppSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/infrastructure/storage/settingsStorage";

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;
  hydrate: () => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: { ...DEFAULT_SETTINGS },
  hydrated: false,

  hydrate: () => set({ settings: loadSettings(), hydrated: true }),

  setSettings: (patch) =>
    set((state) => {
      const next = { ...state.settings, ...patch };
      saveSettings(next);
      return { settings: next };
    }),

  resetSettings: () =>
    set(() => {
      saveSettings(DEFAULT_SETTINGS);
      return { settings: { ...DEFAULT_SETTINGS } };
    }),
}));
