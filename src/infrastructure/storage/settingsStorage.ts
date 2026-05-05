/**
 * App-level settings (API credentials, defaults). Stored in localStorage —
 * acceptable for a desktop developer tool where the user controls the
 * machine. Do not surface these values to logs or telemetry.
 */

export interface AppSettings {
  /** OpenAI-compat endpoint base for Claude/MiniMax-M proxy. */
  anthropicBaseUrl: string;
  anthropicApiKey: string;
  /** MiniMax direct API key for music generation (and TTS in future).
   *  Different regions need different keys — see `minimaxBaseUrl`. */
  minimaxApiKey: string;
  /** Where the MiniMax keys are valid. International users: api.minimax.io.
   *  China users: api.minimaxi.com. (海螺/SVID accounts are usually .com.) */
  minimaxBaseUrl: string;
  /** User-chosen directory for cached TTS mp3 files. Empty = use the
   *  backend default (app-local-data dir). Useful when the user wants
   *  the cache on a specific volume, or wants to share it across
   *  installs. The backend creates the dir lazily on the first
   *  generation if it doesn't exist. */
  speechCacheDir: string;
}

const KEY = "video-editor-settings";

export const DEFAULT_SETTINGS: AppSettings = {
  anthropicBaseUrl: "http://localhost:4001",
  anthropicApiKey: "",
  minimaxApiKey: "",
  minimaxBaseUrl: "https://api.minimax.io",
  speechCacheDir: "",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    console.warn("Failed to save settings to localStorage");
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
