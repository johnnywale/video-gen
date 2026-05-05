import { useState, useRef } from "react";
import { Track as TrackModel } from "@/domain/timeline/models";
import { Clip } from "./Clip";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore, MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT } from "../../store/uiStore";
import styles from "./Timeline.module.css";

interface Props {
  track: TrackModel;
  pixelsPerSecond: number;
  totalWidth: number;
}

export function Track({ track, pixelsPerSecond, totalWidth }: Props) {
  const { removeTrack, selectClip, addClip, mediaFiles, toggleTrackMuted, toggleTrackLocked, toggleTrackHidden } = useEditorStore();
  const trackHeights = useUIStore((s) => s.trackHeights);
  const setTrackHeight = useUIStore((s) => s.setTrackHeight);
  const isLastOfType = useEditorStore(
    (s) => s.timeline.tracks.filter((t) => t.type === track.type).length <= 1
  );
  const [dragOver, setDragOver] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);

  // (#40) Custom height (from drag) wins; fall back to type defaults.
  const defaultHeight = track.type === "video" ? 80 : 60;
  const height = trackHeights[track.id] ?? defaultHeight;

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = { y: e.clientY, h: height };
    const onMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const dy = ev.clientY - resizeStartRef.current.y;
      const newH = Math.max(MIN_TRACK_HEIGHT, Math.min(MAX_TRACK_HEIGHT, resizeStartRef.current.h + dy));
      setTrackHeight(track.id, newH);
    };
    const onUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`${styles.track} ${track.type === "video" ? styles.trackVideo : styles.trackAudio} ${track.hidden ? styles.trackHidden : ""}`}
      style={{ height }}
    >
      <div className={styles.trackHeader}>
        <div className={styles.trackHeaderTop}>
          <span className={styles.trackType}>{track.type === "video" ? "视频" : "音频"}</span>
          <button
            className={styles.trackRemove}
            onClick={() => removeTrack(track.id)}
            title={isLastOfType ? "清空轨道（保留最后一条）" : "删除轨道"}
            aria-label={isLastOfType ? "清空轨道" : `删除${track.type === "video" ? "视频" : "音频"}轨道`}
          >
            −
          </button>
        </div>
        <div className={styles.trackControls}>
          <button
            className={`${styles.trackControlBtn} ${track.muted ? styles.trackControlActive : ""}`}
            onClick={() => toggleTrackMuted(track.id)}
            title={track.muted ? "取消静音" : "静音"}
            aria-label={track.muted ? "取消静音" : "静音"}
          >
            M
          </button>
          <button
            className={`${styles.trackControlBtn} ${track.locked ? styles.trackControlLocked : ""}`}
            onClick={() => toggleTrackLocked(track.id)}
            title={track.locked ? "解锁" : "锁定"}
            aria-label={track.locked ? "解锁" : "锁定"}
          >
            {track.locked ? "L" : "L"}
          </button>
          <button
            className={`${styles.trackControlBtn} ${track.hidden ? styles.trackControlActive : ""}`}
            onClick={() => toggleTrackHidden(track.id)}
            title={track.hidden ? "显示" : "隐藏"}
            aria-label={track.hidden ? "显示" : "隐藏"}
          >
            H
          </button>
        </div>
      </div>
      <div
        className={`${styles.trackBody} ${dragOver ? styles.trackBodyDragOver : ""} ${track.muted ? styles.trackBodyMuted : ""} ${track.locked ? styles.trackBodyLocked : ""}`}
        style={{ width: totalWidth }}
        onClick={() => selectClip(null)}
        onDragOver={(e) => {
          if (track.locked) return;
          if (e.dataTransfer.types.includes("application/x-media-id")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (track.locked) return;
          const mediaId = e.dataTransfer.getData("application/x-media-id");
          if (!mediaId) return;

          const media = mediaFiles.find((f) => f.id === mediaId);
          if (!media) return;

          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const timelinePos = Math.max(0, x / pixelsPerSecond);

          addClip(track.id, {
            src: media.src,
            start: 0,
            end: media.duration,
            timelineStart: timelinePos,
            name: media.name,
          });
        }}
      >
        {!track.hidden && track.clips.map((clip) => (
          <Clip
            key={clip.id}
            clip={clip}
            trackId={track.id}
            trackType={track.type}
            pixelsPerSecond={pixelsPerSecond}
          />
        ))}
      </div>

      {/* (#40) Vertical resize handle along the bottom edge. */}
      <div
        className={`${styles.trackResize} ${isResizing ? styles.trackResizing : ""}`}
        onMouseDown={handleResizeMouseDown}
        title="拖动以调整轨道高度"
        aria-label="调整轨道高度"
      />
    </div>
  );
}
