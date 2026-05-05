/**
 * localStorage persistence for project state (timeline, media metadata, settings).
 * Blob URLs are NOT stored — they're recreated from IndexedDB on hydration.
 */

import { Timeline, MediaFile, ProjectSettings } from "@/domain/timeline/models";

const KEY = "video-editor-project";

export interface PersistedState {
  timeline: Timeline;
  mediaFiles: MediaFile[];
  projectSettings: ProjectSettings;
  outputPath: string;
}

export function saveProject(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    console.warn("Failed to save project to localStorage");
  }
}

export function loadProject(): PersistedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearProject(): void {
  localStorage.removeItem(KEY);
}
