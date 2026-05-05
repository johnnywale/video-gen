import { useRef, useCallback, useEffect, useState } from "react";
import { Clip as ClipModel, TrackType } from "@/domain/timeline/models";
import { clipDuration } from "@/domain/timeline/clip";
import { useEditorStore } from "../../store/editorStore";
import { computeSnap } from "../../utils/snap";
import { SNAP_THRESHOLD_PX, THUMBNAIL_HEIGHT } from "@/shared/constants";
import { FilmstripOverlay } from "./FilmstripOverlay";
import { WaveformOverlay } from "./WaveformOverlay";
import styles from "./Timeline.module.css";

interface Props {
  clip: ClipModel;
  trackId: string;
  trackType: TrackType;
  pixelsPerSecond: number;
}

function formatShortDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(0);
  return `${m}:${s.padStart(2, "0")}`;
}

export function Clip({ clip, trackId, trackType, pixelsPerSecond }: Props) {
  const { selectClip, selectedClipId, removeClip, moveClip, setSnapLine } = useEditorStore();
  const isSelected = selectedClipId === clip.id;
  const duration = clipDuration(clip);
  const width = duration * pixelsPerSecond;
  const left = clip.timelineStart * pixelsPerSecond;

  const isLocked = useEditorStore((s) => s.timeline.tracks.find((t) => t.id === trackId)?.locked ?? false);
  const mediaFile = useEditorStore((s) => s.mediaFiles.find((m) => m.src === clip.src));
  const filePath = mediaFile?.filePath;
  const mediaId = mediaFile?.id;
  const mediaDuration = mediaFile?.duration;

  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartTimeline = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectClip(clip.id);
    if (isLocked) return;
    dragStartX.current = e.clientX;
    dragStartTimeline.current = clip.timelineStart;
    setDragging(true);
  }, [clip.id, clip.timelineStart, selectClip, isLocked]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartX.current;
      const dt = dx / pixelsPerSecond;
      const rawStart = Math.max(0, dragStartTimeline.current + dt);

      const state = useEditorStore.getState();
      const { snappedPosition, snapLine } = computeSnap(
        clip.id,
        rawStart,
        duration,
        state.timeline,
        state.playheadPosition,
        pixelsPerSecond,
        SNAP_THRESHOLD_PX
      );

      moveClip(trackId, clip.id, snappedPosition);
      setSnapLine(snapLine);
    };

    const handleMouseUp = () => {
      setDragging(false);
      setSnapLine(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, pixelsPerSecond, trackId, clip.id, duration, moveClip, setSnapLine]);

  const clipHeight = trackType === "video" ? 68 : 48;

  return (
    <div
      className={`${styles.clip} ${isSelected ? styles.clipSelected : ""} ${dragging ? styles.clipDragging : ""} ${isLocked ? styles.clipLocked : ""}`}
      style={{ width, left }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      title={clip.name}
    >
      {/* Visual overlays */}
      {trackType === "video" && width > 0 && (
        <FilmstripOverlay
          src={clip.src}
          mediaId={mediaId}
          filePath={filePath}
          mediaDuration={mediaDuration}
          clipStart={clip.start}
          clipEnd={clip.end}
          widthPx={Math.round(width)}
          heightPx={THUMBNAIL_HEIGHT}
        />
      )}
      {trackType === "audio" && width > 0 && (
        <WaveformOverlay
          src={clip.src}
          mediaId={mediaId}
          filePath={filePath}
          mediaDuration={mediaDuration}
          clipStart={clip.start}
          clipEnd={clip.end}
          widthPx={Math.round(width)}
          heightPx={clipHeight}
        />
      )}

      <span className={styles.clipDuration}>{formatShortDuration(duration)}</span>
      {!isLocked && (
        <button
          className={styles.clipRemove}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removeClip(trackId, clip.id);
          }}
          title="删除片段"
          aria-label={`删除片段 ${clip.name}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
