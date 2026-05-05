import { useMemo, useState, useCallback } from "react";
import { Toolbar } from "./Controls/Toolbar";
import { VideoPlayer } from "./Preview/VideoPlayer";
import { Timeline } from "./Timeline/Timeline";
import { MediaBin } from "./MediaBin/MediaBin";
import { PropertyInspector } from "./Inspector/PropertyInspector";
import { ResizeHandle } from "./ResizeHandle/ResizeHandle";
import { AutoStagePanel } from "./AutoStage/AutoStagePanel";
import { SettingsPanel } from "./Settings/SettingsPanel";
import { useEditor } from "../hooks/useEditor";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useEditorStore } from "../store/editorStore";
import { FRAME_DURATION } from "@/shared/constants";
import styles from "./EditorPage.module.css";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function EditorPage() {
  const {
    timeline,
    mediaFiles,
    isPlaying,
    playheadPosition,
    selectedClipId,
    renderState,
    outputPath,
    render,
    importFile,
    addMediaToTimeline,
    setIsPlaying,
    setOutputPath,
  } = useEditor();

  const { trimClip, moveClip, toggleClipAudio, setPlayheadPosition, projectSettings, updateProjectSettings, timeRanges, updateTimeRange, removeTimeRange } = useEditorStore();

  useKeyboardShortcuts();

  const [mediaBinWidth, setMediaBinWidth] = useState(220);
  const [inspectorWidth, setInspectorWidth] = useState(220);
  const [timelineHeight, setTimelineHeight] = useState(260);
  const [autoStageOpen, setAutoStageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { selectedClip, selectedTrack } = useMemo(() => {
    if (!selectedClipId) return { selectedClip: null, selectedTrack: null };
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) return { selectedClip: clip, selectedTrack: track };
    }
    return { selectedClip: null, selectedTrack: null };
  }, [timeline, selectedClipId]);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    setPlayheadPosition(playheadPosition + FRAME_DURATION);
  }, [playheadPosition, setIsPlaying, setPlayheadPosition]);

  const handleStepBackward = useCallback(() => {
    setIsPlaying(false);
    setPlayheadPosition(Math.max(0, playheadPosition - FRAME_DURATION));
  }, [playheadPosition, setIsPlaying, setPlayheadPosition]);

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    // If we're parked at (or past) the end, rewind before playing — otherwise
    // play does nothing because no clip is active at the very end.
    if (playheadPosition >= timeline.duration - 0.001) {
      setPlayheadPosition(0);
    }
    setIsPlaying(true);
  }, [isPlaying, playheadPosition, timeline.duration, setIsPlaying, setPlayheadPosition]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    setPlayheadPosition(0);
  }, [setIsPlaying, setPlayheadPosition]);

  return (
    <div className={styles.editor}>
      <Toolbar
        onRender={render}
        onOpenAutoStage={() => setAutoStageOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        renderState={renderState}
        outputPath={outputPath}
        onSetOutputPath={setOutputPath}
      />

      {autoStageOpen && <AutoStagePanel onClose={() => setAutoStageOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <div className={styles.main}>
        <MediaBin
          mediaFiles={mediaFiles}
          onAddToTimeline={addMediaToTimeline}
          onImport={importFile}
          style={{ width: mediaBinWidth }}
        />
        <ResizeHandle
          direction="horizontal"
          onResize={(d) => setMediaBinWidth((w) => clamp(w + d, 150, 400))}
        />
        <div className={styles.preview}>
          <VideoPlayer
            isPlaying={isPlaying}
            playheadPosition={playheadPosition}
            totalDuration={timeline.duration}
            onTogglePlay={handleTogglePlay}
            onStop={handleStop}
            onStepForward={handleStepForward}
            onStepBackward={handleStepBackward}
          />
        </div>
        <ResizeHandle
          direction="horizontal"
          onResize={(d) => setInspectorWidth((w) => clamp(w - d, 150, 400))}
        />
        <PropertyInspector
          clip={selectedClip}
          track={selectedTrack}
          projectSettings={projectSettings}
          timeRanges={timeRanges}
          onTrimClip={trimClip}
          onMoveClip={moveClip}
          onToggleClipAudio={toggleClipAudio}
          onUpdateProjectSettings={updateProjectSettings}
          onUpdateTimeRange={updateTimeRange}
          onRemoveTimeRange={removeTimeRange}
          style={{ width: inspectorWidth }}
        />
      </div>

      <ResizeHandle
        direction="vertical"
        onResize={(d) => setTimelineHeight((h) => clamp(h - d, 150, 500))}
      />

      <div className={styles.timelineSection} style={{ height: timelineHeight }}>
        <Timeline />
      </div>
    </div>
  );
}
