import { useState, useEffect, useCallback } from "react";
import { useEditorStore } from "../store/editorStore";
import { renderProject } from "../services/renderService";
import { onRenderProgress, onRenderComplete, onRenderError, onFileDrop } from "@/infrastructure/tauri/event";
import { openFilePicker, probeMedia, getMediaUrl, openPath } from "@/infrastructure/tauri/commands";
import { ensureCompatibleContainer } from "@/domain/renderer/ffmpegGraph";
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

  // Listen for render events
  useEffect(() => {
    const listeners = Promise.all([
      onRenderProgress((p) => setRenderState((s) => ({ ...s, progress: p.percent }))),
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
    try {
      await renderProject(store.timeline, store.outputPath, store.projectSettings, store.mediaFiles);
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
