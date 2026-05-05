import { useState, useEffect, useCallback, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { useFontsStore } from "../store/fontsStore";
import { renderProject } from "../services/renderService";
import { onRenderProgress, onRenderComplete, onRenderError, onFileDrop } from "@/infrastructure/tauri/event";
import { openFilePicker, probeMedia, getMediaUrl, openPath } from "@/infrastructure/tauri/commands";
import { ensureCompatibleContainer, estimateExportDuration } from "@/domain/renderer/ffmpegGraph";
import { findInsertPosition } from "@/domain/timeline/track";

export interface RenderState {
  isRendering: boolean;
  progress: number;
  error: string | null;
  /** Path of the just-finished render — set on success, used by the
   *  toolbar success banner + the "open file" auto-launch. */
  lastOutputPath: string | null;
}

export function useEditor() {
  const store = useEditorStore();
  const [renderState, setRenderState] = useState<RenderState>({
    isRendering: false,
    progress: 0,
    error: null,
    lastOutputPath: null,
  });
  // Captured at render-start. ffmpeg's stderr emits the *output* timestamp
  // (post-xfade), so dividing by this gives a real 0→100 progress curve
  // instead of the previous 0-then-snap-to-100 jump.
  const renderTotalRef = useRef<number>(0);

  // Listen for render events
  useEffect(() => {
    const listeners = Promise.all([
      onRenderProgress((p) => setRenderState((s) => {
        const total = renderTotalRef.current;
        if (total <= 0) {
          // No reliable baseline (audio-only export, or render started
          // before total was captured). Leave progress where it is.
          return s;
        }
        const next = Math.min(99, Math.max(s.progress, (p.currentTime / total) * 100));
        return { ...s, progress: next };
      })),
      onRenderComplete(() => {
        // The actual saved path may differ from the user's outputPath if
        // we auto-corrected the extension (e.g. .mp4 → .webm for VP9).
        const state = useEditorStore.getState();
        const actualPath = ensureCompatibleContainer(state.outputPath, state.projectSettings.codec);
        setRenderState({ isRendering: false, progress: 100, error: null, lastOutputPath: actualPath });
        // Auto-open in the OS default player. Failure is non-fatal —
        // the success banner is the primary signal.
        openPath(actualPath).catch((e) => console.warn("[render] open_path failed:", e));
      }),
      onRenderError((err) => setRenderState({ isRendering: false, progress: 0, error: err, lastOutputPath: null })),
    ]);
    return () => { listeners.then((fns) => fns.forEach((fn) => fn())); };
  }, []);

  // Listen for Tauri drag-drop events (gives file paths directly)
  useEffect(() => {
    const unlisten = onFileDrop((paths) => {
      importPaths(paths);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Import files by their disk paths — async, non-blocking */
  const importPaths = useCallback(async (paths: string[]) => {
    for (const filePath of paths) {
      // Run probe async — doesn't block UI
      try {
        const info = await probeMedia(filePath);
        const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
        const src = await getMediaUrl(filePath);

        store.addMediaFile({
          name: fileName,
          src,
          filePath,
          duration: info.duration,
          width: info.width,
          height: info.height,
          hasVideo: info.hasVideo,
          hasAudio: info.hasAudio,
        });
      } catch (err) {
        console.error("Failed to probe media:", filePath, err);
      }
    }
  }, [store]);

  const render = async () => {
    if (!store.outputPath) {
      setRenderState((s) => ({ ...s, error: "No output path set" }));
      return;
    }
    setRenderState({ isRendering: true, progress: 0, error: null, lastOutputPath: null });
    // Capture the predicted output duration so the stderr ticks have a
    // baseline to divide by. Falls back to 0 (== no progress curve) for
    // audio-only timelines.
    renderTotalRef.current = estimateExportDuration(store.timeline, store.projectSettings);
    try {
      // Build the per-render font lookup from the cached system list. The
      // graph honours `clip.fontFamily` first, falling back to the
      // project default (best CJK-capable font we found at hydrate).
      const fontsState = useFontsStore.getState();
      const familyToPath: Record<string, string> = {};
      for (const f of fontsState.fonts) {
        // Multiple faces share the same family name (Regular, Bold, …);
        // first one wins so the default-weight face is used.
        if (!(f.family in familyToPath)) familyToPath[f.family] = f.path;
      }
      const defaultPath = fontsState.defaultCjkFamily
        ? familyToPath[fontsState.defaultCjkFamily]
        : undefined;
      await renderProject(
        store.timeline,
        store.outputPath,
        store.projectSettings,
        store.mediaFiles,
        { familyToPath, defaultPath }
      );
    } catch (err) {
      setRenderState({ isRendering: false, progress: 0, error: String(err), lastOutputPath: null });
    }
  };

  const importFile = useCallback(async () => {
    try {
      const paths = await openFilePicker(true);
      if (paths.length > 0) {
        await importPaths(paths);
      }
    } catch (err) {
      console.error("File picker error:", err);
    }
  }, [importPaths]);

  const addMediaToTimeline = useCallback((mediaFileId: string) => {
    const media = store.mediaFiles.find((f) => f.id === mediaFileId);
    if (!media) return;
    const track = store.timeline.tracks.find(
      (t) => t.type === (media.hasVideo ? "video" : "audio") && !t.locked
    );
    if (!track) return;

    // Place at playhead, push past any overlapping clip on this track.
    const timelineStart = findInsertPosition(track, store.playheadPosition, media.duration);

    store.addClip(track.id, {
      src: media.src,
      start: 0,
      end: media.duration,
      timelineStart,
      name: media.name,
    });
  }, [store]);

  return {
    timeline: store.timeline,
    mediaFiles: store.mediaFiles,
    selectedClipId: store.selectedClipId,
    playheadPosition: store.playheadPosition,
    isPlaying: store.isPlaying,
    renderState,
    render,
    importFile,
    importPaths,
    addMediaToTimeline,
    addTrack: store.addTrack,
    selectClip: store.selectClip,
    setPlayheadPosition: store.setPlayheadPosition,
    setIsPlaying: store.setIsPlaying,
    setOutputPath: store.setOutputPath,
    outputPath: store.outputPath,
  };
}
