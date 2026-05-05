import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { formatTimecode } from "@/shared/utils/timecode";
import { useEditorStore } from "../../store/editorStore";
import { useAudioTrackPlayback } from "../../hooks/useAudioTrackPlayback";
import { clipDuration } from "@/domain/timeline/clip";
import { Timeline, Clip } from "@/domain/timeline/models";
import { CaptionOverlay } from "./CaptionOverlay";
import styles from "./Preview.module.css";

type AspectRatio = "fit" | "16:9" | "9:16" | "1:1" | "4:3";

const ASPECT_RATIOS: { id: AspectRatio; label: string; value?: string }[] = [
  { id: "fit", label: "适配" },
  { id: "16:9", label: "16:9", value: "16/9" },
  { id: "9:16", label: "9:16", value: "9/16" },
  { id: "1:1", label: "1:1", value: "1/1" },
  { id: "4:3", label: "4:3", value: "4/3" },
];

interface ActiveClip {
  clip: Clip;
  sourceTime: number;
  muted: boolean;
}

function findActiveVideo(timeline: Timeline, playhead: number): ActiveClip | null {
  const tracks = timeline.tracks.filter((t) => t.type === "video" && !t.hidden);
  for (let i = tracks.length - 1; i >= 0; i--) {
    for (const clip of tracks[i].clips) {
      const dur = clipDuration(clip);
      if (playhead >= clip.timelineStart && playhead < clip.timelineStart + dur) {
        const speed = clip.speed ?? 1;
        return {
          clip,
          // Map elapsed-on-timeline → elapsed-in-source via the playback
          // speed. With speed=0.5, 2 s on the timeline = 1 s of source.
          sourceTime: clip.start + (playhead - clip.timelineStart) * speed,
          muted: tracks[i].muted || clip.audioEnabled === false,
        };
      }
    }
  }
  return null;
}

interface Props {
  isPlaying: boolean;
  playheadPosition: number;
  totalDuration: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
}

export function VideoPlayer({
  isPlaying,
  playheadPosition,
  totalDuration,
  onTogglePlay,
  onStop,
  onStepForward,
  onStepBackward,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const playStartRef = useRef({ wallTime: 0, playhead: 0 });
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("fit");
  const [previewVolume, setPreviewVolume] = useState(1);
  const [previewMuted, setPreviewMuted] = useState(false);
  const lastSrcRef = useRef<string | undefined>(undefined);
  // Track the active clip's ID, not just its src. Two stages on the timeline
  // can share the same source mp4 — when we cross from one to the next, we
  // must seek to the new clip's sourceTime even though src didn't change.
  const lastClipIdRef = useRef<string | undefined>(undefined);

  // Audio-track clips are played through a separate <audio> element pool.
  // Video-track audio comes from the <video> element below — perfect sync,
  // no drift correction needed.
  useAudioTrackPlayback();

  // Subscribe to timeline reactively so the caption overlay re-renders
  // when clips change (e.g. user edits a stage's text).
  const timeline = useEditorStore((s) => s.timeline);
  const transitionType = useEditorStore((s) => s.projectSettings.transitionType);
  const transitionDuration = useEditorStore((s) => s.projectSettings.transitionDuration);
  const activeCaption = useMemo(() => {
    const active = findActiveVideo(timeline, playheadPosition);
    if (!active || !active.clip.text) return null;
    return { text: active.clip.text, style: active.clip.textStyle ?? 0 };
  }, [timeline, playheadPosition]);

  // Cross-fade preview canvas: when a clip transition fires we snapshot
  // the outgoing frame onto this canvas, then animate its opacity from 1
  // to 0 over the transition duration. The <video> element underneath
  // is already swapped to the new clip's source, so as the canvas fades
  // out the new clip appears.
  const fadeCanvasRef = useRef<HTMLCanvasElement>(null);
  const triggerFadeFromCurrentFrame = useCallback(() => {
    if (transitionType === "none") return;
    const video = videoRef.current;
    const canvas = fadeCanvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      // CORS-tainted canvas etc. — silently skip.
      return;
    }

    // Reset the transition, set opacity to 1, force a reflow, then start
    // the fade so the browser actually animates the change.
    canvas.style.transition = "none";
    canvas.style.opacity = "1";
    void canvas.offsetHeight;
    const dur = Math.max(0.1, Math.min(2, transitionDuration));
    canvas.style.transition = `opacity ${dur}s linear`;
    canvas.style.opacity = "0";
  }, [transitionType, transitionDuration]);

  // Apply preview-level volume / mute to the video element. Note: per-clip
  // muted (from audioEnabled) still wins via active.muted in the playback
  // logic — this is a master volume on top.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = previewMuted ? 0 : previewVolume;
  }, [previewVolume, previewMuted]);

  const handleFullscreen = () => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const syncVideo = useCallback((playhead: number, shouldPlay: boolean) => {
    const video = videoRef.current;
    if (!video) return;

    const { timeline } = useEditorStore.getState();
    const active = findActiveVideo(timeline, playhead);

    if (!active) {
      video.pause();
      if (lastSrcRef.current) {
        video.removeAttribute("src");
        video.load();
        lastSrcRef.current = undefined;
        lastClipIdRef.current = undefined;
      }
      return;
    }

    const clipChanged = active.clip.id !== lastClipIdRef.current;

    // Snapshot the outgoing frame BEFORE we swap src or seek — the canvas
    // gets the last visible frame of the previous clip, then fades out
    // while the video plays the new clip beneath.
    if (clipChanged && lastClipIdRef.current !== undefined && shouldPlay) {
      triggerFadeFromCurrentFrame();
    }
    lastClipIdRef.current = active.clip.id;

    if (active.clip.src !== lastSrcRef.current) {
      lastSrcRef.current = active.clip.src;
      video.src = active.clip.src;
      video.load();
    }

    video.muted = active.muted;
    video.playbackRate = active.clip.speed ?? 1;

    if (shouldPlay) {
      if (video.paused) {
        video.currentTime = active.sourceTime;
        video.play().catch(() => {});
      } else if (clipChanged) {
        // Same source, different clip on the timeline — seek to the new
        // clip's source position so we don't continue through the source.
        video.currentTime = active.sourceTime;
      }
    } else {
      video.pause();
      if (Math.abs(video.currentTime - active.sourceTime) > 0.05) {
        video.currentTime = active.sourceTime;
      }
    }
  }, [triggerFadeFromCurrentFrame]);

  // Playback loop — drives the timeline playhead while video plays natively.
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      syncVideo(playheadPosition, false);
      return;
    }

    playStartRef.current = { wallTime: performance.now(), playhead: playheadPosition };
    syncVideo(playheadPosition, true);

    const loop = () => {
      const store = useEditorStore.getState();
      if (!store.isPlaying) return;

      const elapsed = (performance.now() - playStartRef.current.wallTime) / 1000;
      const newPlayhead = playStartRef.current.playhead + elapsed;

      if (newPlayhead >= store.timeline.duration) {
        store.setPlayheadPosition(store.timeline.duration);
        store.setIsPlaying(false);
        return;
      }

      store.setPlayheadPosition(newPlayhead);

      // Detect clip-boundary crossing → swap source / seek.
      const video = videoRef.current;
      const active = findActiveVideo(store.timeline, newPlayhead);
      if (video) {
        if (!active) {
          if (lastSrcRef.current) {
            video.pause();
            video.removeAttribute("src");
            video.load();
            lastSrcRef.current = undefined;
            lastClipIdRef.current = undefined;
          }
        } else {
          const clipChanged = active.clip.id !== lastClipIdRef.current;

          // Snapshot the outgoing frame for cross-fade BEFORE the swap.
          if (clipChanged && lastClipIdRef.current !== undefined) {
            triggerFadeFromCurrentFrame();
          }
          lastClipIdRef.current = active.clip.id;

          if (active.clip.src !== lastSrcRef.current) {
            lastSrcRef.current = active.clip.src;
            video.src = active.clip.src;
            video.currentTime = active.sourceTime;
            video.muted = active.muted;
            video.playbackRate = active.clip.speed ?? 1;
            video.play().catch(() => {});
          } else if (clipChanged) {
            // Same source file but a different clip is now active (e.g. the
            // next stage). Seek the element to the new clip's sourceTime —
            // otherwise the element keeps rolling through the source and
            // the user just sees the original video continue.
            video.currentTime = active.sourceTime;
            video.muted = active.muted;
            video.playbackRate = active.clip.speed ?? 1;
          } else {
            video.muted = active.muted;
            video.playbackRate = active.clip.speed ?? 1;
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrub when paused and playhead changes
  useEffect(() => {
    if (!isPlaying) {
      syncVideo(playheadPosition, false);
    }
  }, [playheadPosition, isPlaying, syncVideo]);

  // Reflect timeline edits into the live <video> element without waiting
  // for the next play/pause/scrub event. Concretely: when the user toggles
  // a clip's audio, mutes a track, or hides a track, we recompute the
  // active clip and update muted (and seek if the active clip changed —
  // e.g. hiding the top track makes a lower one active).
  useEffect(() => {
    return useEditorStore.subscribe((state, prev) => {
      if (state.timeline === prev.timeline) return;
      const video = videoRef.current;
      if (!video) return;

      const active = findActiveVideo(state.timeline, state.playheadPosition);
      if (!active) {
        video.muted = true;
        return;
      }
      video.muted = active.muted;
      video.playbackRate = active.clip.speed ?? 1;
      console.log("[VideoPlayer] timeline changed → muted:", active.muted, "clip:", active.clip.id, "audioEnabled:", active.clip.audioEnabled, "speed:", active.clip.speed ?? 1);

      // If the active clip identity changed (e.g. a track was hidden and
      // a different one is now top), seek to the new clip's sourceTime.
      if (active.clip.id !== lastClipIdRef.current) {
        lastClipIdRef.current = active.clip.id;
        if (active.clip.src !== lastSrcRef.current) {
          lastSrcRef.current = active.clip.src;
          video.src = active.clip.src;
        }
        video.currentTime = active.sourceTime;
      }
    });
  }, []);

  const arStyle = ASPECT_RATIOS.find((a) => a.id === aspectRatio)?.value
    ? { aspectRatio: ASPECT_RATIOS.find((a) => a.id === aspectRatio)!.value, width: "auto" as const, maxWidth: "100%" as const, maxHeight: "100%" as const }
    : {};

  return (
    <div className={styles.previewContainer}>
      <div className={styles.canvasArea}>
        <video
          ref={videoRef}
          className={styles.video}
          style={arStyle}
          playsInline
          preload="auto"
          onError={(e) => {
            const v = e.currentTarget;
            console.error("[VideoPlayer] video error:", {
              code: v.error?.code,
              message: v.error?.message,
              src: v.currentSrc || v.src,
            });
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            console.log("[VideoPlayer] loadedmetadata:", {
              src: v.currentSrc,
              duration: v.duration,
              width: v.videoWidth,
              height: v.videoHeight,
            });
          }}
          onCanPlay={() => console.log("[VideoPlayer] canplay")}
        />
        {activeCaption && (
          <CaptionOverlay text={activeCaption.text} style={activeCaption.style} />
        )}
        {transitionType !== "none" && (
          <canvas ref={fadeCanvasRef} className={styles.fadeCanvas} aria-hidden />
        )}
        {transitionType !== "none" && (
          <span className={styles.previewBadge} title="预览仅近似显示淡入淡出；擦除/滑动等其他类型仍以淡出方式呈现，但导出时由 ffmpeg 准确渲染">
            预览近似 · 导出准确渲染 ({transitionType})
          </span>
        )}
      </div>
      <div className={styles.controls}>
        <div className={styles.transportGroup}>
          <button className={styles.stepBtn} onClick={onStepBackward} aria-label="上一帧" title="上一帧 (J / ←)">
            |&lt;
          </button>
          <button className={styles.playBtn} onClick={onTogglePlay} aria-label={isPlaying ? "暂停" : "播放"} title="播放 / 暂停 (空格)">
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button className={styles.stepBtn} onClick={onStop} aria-label="停止" title="停止（回到起点）">
            ■
          </button>
          <button className={styles.stepBtn} onClick={onStepForward} aria-label="下一帧" title="下一帧 (L / →)">
            &gt;|
          </button>
        </div>

        <span className={styles.timecode}>
          {formatTimecode(playheadPosition)} / {formatTimecode(totalDuration)}
        </span>

        <div className={styles.volumeGroup} title="预览音量">
          <button
            className={styles.volumeBtn}
            onClick={() => setPreviewMuted((m) => !m)}
            aria-label={previewMuted ? "取消静音" : "静音"}
          >
            {previewMuted || previewVolume === 0 ? "🔇" : previewVolume < 0.5 ? "🔉" : "🔊"}
          </button>
          <input
            type="range"
            className={styles.volumeSlider}
            min={0}
            max={1}
            step={0.01}
            value={previewMuted ? 0 : previewVolume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPreviewVolume(v);
              setPreviewMuted(v === 0);
            }}
            aria-label="预览音量"
          />
        </div>

        <div className={styles.aspectGroup}>
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.id}
              className={`${styles.aspectBtn} ${aspectRatio === ar.id ? styles.aspectBtnActive : ""}`}
              onClick={() => setAspectRatio(ar.id)}
              title={ar.label}
            >
              {ar.label}
            </button>
          ))}
        </div>

        <button
          className={styles.stepBtn}
          onClick={handleFullscreen}
          aria-label="全屏"
          title="全屏预览 (F)"
          style={{ marginLeft: 6 }}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
