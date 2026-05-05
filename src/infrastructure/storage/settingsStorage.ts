/**
 * App-level settings (API credentials, defaults). Stored in localStorage —
 * acceptable for a desktop developer tool where the user controls the
 * machine. Do not surface these values to logs or telemetry.
 *
 * The LiteLLM proxy URL is hard-coded in the Rust backend — only the
 * master key is configurable from the UI. The proxy fans out to MiniMax /
 * Anthropic / etc. and injects the upstream provider keys, so this is the
 * single credential needed for captions, TTS, and music generation.
 */

export interface AppSettings {
  /** LiteLLM proxy master key. Used by ai_generate_captions,
   *  ai_generate_speech, and ai_generate_music. The proxy URL itself is
   *  baked into the backend; see `LITELLM_BASE_URL` in src-tauri/src/ai.rs. */
  litellmApiKey: string;
  /** User-chosen directory for cached TTS mp3 files. Empty = use the
   *  backend default (app-local-data dir). Useful when the user wants
   *  the cache on a specific volume, or wants to share it across
   *  installs. The backend creates the dir lazily on the first
   *  generation if it doesn't exist. */
  speechCacheDir: string;
}

const KEY = "video-editor-settings";

export const DEFAULT_SETTINGS: AppSettings = {
  litellmApiKey: "",
  speechCacheDir: "",
};

/** Pre-rebrand keys that carried credentials. We migrate the value of
 *  whichever was last set so users don't have to re-enter their key
 *  after upgrading. Drop-on-write (saveSettings only emits the new
 *  shape) so the migration is one-way. */
interface LegacyAppSettings {
  anthropicApiKey?: string;
  minimaxApiKey?: string;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings & LegacyAppSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // One-time migration from the old per-provider keys. Prefer the
    // anthropic field (it pointed at the same litellm proxy in practice);
    // fall back to the minimax field. If the user had both, anthropic wins.
    if (!merged.litellmApiKey) {
      const fallback =
        (parsed.anthropicApiKey ?? "").trim() ||
        (parsed.minimaxApiKey ?? "").trim();
      if (fallback) merged.litellmApiKey = fallback;
    }
    return {
      litellmApiKey: merged.litellmApiKey,
      speechCacheDir: merged.speechCacheDir,
    };
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
