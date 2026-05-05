import { useEffect, useRef } from "react";
import { useEditorStore } from "../store/editorStore";
import { Timeline } from "@/domain/timeline/models";
import { clipDuration } from "@/domain/timeline/clip";

interface ActiveAudio {
  clipId: string;
  src: string;
  sourceTime: number;
  muted: boolean;
  /** Clip volume clamped to [0, 1] for the preview element. The export
   *  path supports >1 (gain), but HTMLAudioElement.volume can't exceed 1
   *  — the user is told this in the inspector help tooltip. */
  volume: number;
}

const SYNC_INTERVAL_MS = 250;
const DRIFT_THRESHOLD_S = 0.3;

/** Audio-only clips on audio tracks, with mute resolved. Video-track audio
 *  is intentionally excluded — that's handled by the `<video>` element. */
function findActiveAudioOnlyClips(timeline: Timeline, playhead: number): ActiveAudio[] {
  const out: ActiveAudio[] = [];
  for (const track of timeline.tracks) {
    if (track.type !== "audio" || track.hidden) continue;
    for (const clip of track.clips) {
      const dur = clipDuration(clip);
      if (playhead < clip.timelineStart || playhead >= clip.timelineStart + dur) continue;
      const rawVol = clip.volume ?? 1;
      out.push({
        clipId: clip.id,
        src: clip.src,
        sourceTime: clip.start + (playhead - clip.timelineStart),
        muted: track.muted || clip.audioEnabled === false,
        volume: Math.max(0, Math.min(1, rawVol)),
      });
    }
  }
  return out;
}

/**
 * Drives an `<audio>` element pool for clips on audio tracks during preview.
 *
 * Lifecycle:
 *   - Play start  → seek + play active clips, kick off a 250 ms sync interval.
 *   - Boundary    → diff active set; pause clips that left, start new clips.
 *   - Drift > 0.3s → re-seek the element to the expected sourceTime.
 *   - Pause       → stop interval, pause all elements; on scrub, snap to playhead.
 *
 * Why a 250 ms interval instead of subscribing to every playhead update:
 * setting `audio.currentTime` is expensive and can cause stutter if done
 * every RAF. We let the element play freely and only correct on boundary or
 * meaningful drift.
 */
export function useAudioTrackPlayback() {
  const pool = useRef<Map<string, HTMLAudioElement>>(new Map());
  // Maps clipId → src so we can pause an element when a clip leaves the
  // active set without scanning the whole timeline again.
  const activeClips = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const getEl = (src: string): HTMLAudioElement => {
      let el = pool.current.get(src);
      if (!el) {
        el = document.createElement("audio");
        el.preload = "auto";
        el.src = src;
        pool.current.set(src, el);
      }
      return el;
    };

    const sync = () => {
      const { timeline, playheadPosition, isPlaying } = useEditorStore.getState();
      const active = findActiveAudioOnlyClips(timeline, playheadPosition);
      const activeIds = new Set(active.map((a) => a.clipId));

      // Pause clips that left the active set.
      for (const [clipId, src] of activeClips.current) {
        if (!activeIds.has(clipId)) {
          const el = pool.current.get(src);
          if (el) {
            el.pause();
            el.muted = true;
          }
        }
      }

      // Start or correct currently-active clips.
      for (const a of active) {
        const el = getEl(a.src);
        el.muted = a.muted;
        el.volume = a.volume;

        const wasActive = activeClips.current.has(a.clipId);
        if (!wasActive) {
          // First time this clip is active — seek and play.
          el.currentTime = a.sourceTime;
          if (isPlaying && !a.muted) el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - a.sourceTime) > DRIFT_THRESHOLD_S) {
          el.currentTime = a.sourceTime;
        }

        if (isPlaying && !a.muted && el.paused) {
          el.play().catch(() => {});
        } else if (!isPlaying && !el.paused) {
          el.pause();
        }
      }

      // Update activeClips map.
      activeClips.current = new Map(active.map((a) => [a.clipId, a.src]));
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startInterval = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(sync, SYNC_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const unsub = useEditorStore.subscribe((state, prev) => {
      const playChanged = state.isPlaying !== prev.isPlaying;

      if (playChanged && state.isPlaying) {
        sync();
        startInterval();
        return;
      }
      if (playChanged && !state.isPlaying) {
        stopInterval();
        // Pause everything, then re-sync once at the rest position so the
        // user can hear scrub feedback if they later move the playhead.
        for (const el of pool.current.values()) el.pause();
        activeClips.current.clear();
        sync();
        return;
      }

      // While playing, RAF updates playheadPosition every frame — DO NOT
      // sync from those events. The interval handles boundary detection.
      if (state.isPlaying) return;

      // Paused: scrub or timeline edit → re-sync.
      if (
        state.playheadPosition !== prev.playheadPosition ||
        state.timeline !== prev.timeline
      ) {
        sync();
      }
    });

    sync(); // initial state

    return () => {
      unsub();
      stopInterval();
      for (const el of pool.current.values()) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      pool.current.clear();
      activeClips.current.clear();
    };
  }, []);
}
