import { create } from "zustand";

/**
 * Pure-UI state that doesn't belong in the timeline domain (it's not
 * exported, it doesn't undo/redo, it doesn't render to ffmpeg). Things like
 * track row heights live here.
 *
 * Persisted in localStorage so resizing survives reloads.
 */

const KEY = "video-editor-ui";

interface PersistedUI {
  trackHeights: Record<string, number>;
}

function load(): PersistedUI {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { trackHeights: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.trackHeights === "object") return parsed;
    return { trackHeights: {} };
  } catch {
    return { trackHeights: {} };
  }
}

function save(s: PersistedUI) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

interface UIState {
  trackHeights: Record<string, number>;
  hydrate: () => void;
  setTrackHeight: (trackId: string, h: number) => void;
}

export const MIN_TRACK_HEIGHT = 36;
export const MAX_TRACK_HEIGHT = 220;

export const useUIStore = create<UIState>((set) => ({
  trackHeights: {},

  hydrate: () => set({ trackHeights: load().trackHeights }),

  setTrackHeight: (trackId, h) =>
    set((state) => {
      const clamped = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, h));
      const next = { ...state.trackHeights, [trackId]: clamped };
      save({ trackHeights: next });
      return { trackHeights: next };
    }),
}));
