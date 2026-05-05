import { useEffect, useState } from "react";
import { EditorPage } from "@/features/editor/components/EditorPage";
import { loadProject } from "@/infrastructure/storage/projectStorage";
import { useEditorStore } from "@/features/editor/store/editorStore";
import { useSettingsStore } from "@/features/editor/store/settingsStore";
import { useTopicsStore } from "@/features/editor/store/topicsStore";
import { useUIStore } from "@/features/editor/store/uiStore";
import { DEFAULT_PROJECT_SETTINGS } from "@/domain/timeline/models";
import { getMediaUrl } from "@/infrastructure/tauri/commands";
import "./App.css";

/**
 * Hydrate the editor store from localStorage on app start. Two things matter:
 *  - The persisted MediaFile.src URLs point to a previous run's HTTP server
 *    port (random per launch), so we re-resolve them via the current port
 *    using getMediaUrl(filePath) before handing the state to the store.
 *  - Without hydration, the store's debounced auto-save still runs but
 *    nothing is restored — the UI looks like every reload wiped the project.
 */
export default function App() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Settings + topics hydrate synchronously — they're tiny localStorage
    // blobs and don't depend on any async backend round-trip.
    useSettingsStore.getState().hydrate();
    useTopicsStore.getState().hydrate();
    useUIStore.getState().hydrate();
    (async () => {
      const persisted = loadProject();
      if (!persisted) {
        setHydrated(true);
        return;
      }

      // Refresh src URLs for each media file using the current run's port.
      // Files without a filePath (legacy / blob-only) keep their stored src.
      const refreshed = await Promise.all(
        persisted.mediaFiles.map(async (m) => {
          if (!m.filePath) return m;
          try {
            const src = await getMediaUrl(m.filePath);
            return { ...m, src };
          } catch {
            return m;
          }
        })
      );

      // Likewise refresh src on each clip (their src came from MediaFile.src
      // at the time of import, so they'd still point at an old port).
      const refreshedSrcMap = new Map<string, string>();
      persisted.mediaFiles.forEach((m, i) => {
        refreshedSrcMap.set(m.src, refreshed[i].src);
      });
      const newTimeline = {
        ...persisted.timeline,
        tracks: persisted.timeline.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            src: refreshedSrcMap.get(c.src) ?? c.src,
          })),
        })),
      };

      // Guarantee the editor always has at least one of each track type at
      // start. A previously-persisted state may have removed one (especially
      // before the toolbar lost its add-track buttons), and that's confusing
      // when you reopen the app.
      const hasVideo = newTimeline.tracks.some((t) => t.type === "video");
      const hasAudio = newTimeline.tracks.some((t) => t.type === "audio");
      if (!hasVideo) {
        newTimeline.tracks.unshift({
          id: crypto.randomUUID(),
          type: "video",
          clips: [],
          muted: false,
          locked: false,
          hidden: false,
        });
      }
      if (!hasAudio) {
        newTimeline.tracks.push({
          id: crypto.randomUUID(),
          type: "audio",
          clips: [],
          muted: false,
          locked: false,
          hidden: false,
        });
      }

      if (cancelled) return;
      // Merge persisted settings on top of defaults so any newly-added
      // fields (e.g. transitionType/transitionDuration) get sane values
      // when loading an older project state.
      const mergedProjectSettings = {
        ...DEFAULT_PROJECT_SETTINGS,
        ...(persisted.projectSettings ?? {}),
      };
      useEditorStore.getState().hydrateState({
        timeline: newTimeline,
        mediaFiles: refreshed,
        projectSettings: mergedProjectSettings,
        outputPath: persisted.outputPath,
      });
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!hydrated) return null;
  return <EditorPage />;
}
