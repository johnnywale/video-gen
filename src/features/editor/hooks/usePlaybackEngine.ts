import { useRef, useEffect, useCallback } from "react";
import { useEditorStore } from "../store/editorStore";
import { Timeline, Clip } from "@/domain/timeline/models";
import { clipDuration } from "@/domain/timeline/clip";

interface ActiveClip {
  clip: Clip;
  sourceTime: number;
  trackMuted: boolean;
}

/** Find the topmost visible video clip at playhead */
function findActiveVideoClip(timeline: Timeline, playhead: number): ActiveClip | null {
  const videoTracks = timeline.tracks.filter((t) => t.type === "video" && !t.hidden);
  for (let i = videoTracks.length - 1; i >= 0; i--) {
    const track = videoTracks[i];
    for (const clip of track.clips) {
      const dur = clipDuration(clip);
      if (playhead >= clip.timelineStart && playhead < clip.timelineStart + dur) {
        return { clip, sourceTime: clip.start + (playhead - clip.timelineStart), trackMuted: track.muted };
      }
    }
  }
  return null;
}

/** Find all active audio clips at playhead (from non-hidden audio tracks) */
function findActiveAudioClips(timeline: Timeline, playhead: number): ActiveClip[] {
  const result: ActiveClip[] = [];
  const audioTracks = timeline.tracks.filter((t) => t.type === "audio" && !t.hidden);
  for (const track of audioTracks) {
    for (const clip of track.clips) {
      const dur = clipDuration(clip);
      if (playhead >= clip.timelineStart && playhead < clip.timelineStart + dur) {
        result.push({ clip, sourceTime: clip.start + (playhead - clip.timelineStart), trackMuted: track.muted });
      }
    }
  }
  return result;
}

export function usePlaybackEngine(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const videoPool = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioPool = useRef<Map<string, HTMLAudioElement>>(new Map());
  const rafId = useRef<number>(0);
  const lastPlayStartTime = useRef<number>(0);
  const lastPlayheadAtStart = useRef<number>(0);
  // Track which audio clips are currently playing to detect boundary crossings
  const activeAudioIds = useRef<Set<string>>(new Set());
  const activeVideoSrc = useRef<string | null>(null);

  const getVideoElement = useCallback((src: string): HTMLVideoElement => {
    let video = videoPool.current.get(src);
    if (!video) {
      video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.src = src;
      videoPool.current.set(src, video);
    }
    return video;
  }, []);

  const getAudioElement = useCallback((src: string): HTMLAudioElement => {
    let audio = audioPool.current.get(src);
    if (!audio) {
      audio = document.createElement("audio");
      audio.preload = "auto";
      audio.src = src;
      audioPool.current.set(src, audio);
    }
    return audio;
  }, []);

  /** Mute & pause all media elements */
  const silenceAll = useCallback(() => {
    videoPool.current.forEach((v) => { v.muted = true; v.pause(); });
    audioPool.current.forEach((a) => { a.muted = true; a.pause(); });
    activeAudioIds.current.clear();
    activeVideoSrc.current = null;
  }, []);

  /** Paint a video frame onto the canvas */
  const paintFrame = useCallback((video: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (video.readyState < 2) return;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { projectSettings } = useEditorStore.getState();
    const projAspect = projectSettings.width / projectSettings.height;
    const canvasAspect = canvas.width / canvas.height;
    let frameW: number, frameH: number, frameX: number, frameY: number;
    if (canvasAspect > projAspect) {
      frameH = canvas.height;
      frameW = frameH * projAspect;
      frameX = (canvas.width - frameW) / 2;
      frameY = 0;
    } else {
      frameW = canvas.width;
      frameH = frameW / projAspect;
      frameX = 0;
      frameY = (canvas.height - frameH) / 2;
    }

    const vw = video.videoWidth || projectSettings.width;
    const vh = video.videoHeight || projectSettings.height;
    const srcAspect = vw / vh;
    let drawW: number, drawH: number;
    if (srcAspect > projAspect) {
      drawW = frameW;
      drawH = frameW / srcAspect;
    } else {
      drawH = frameH;
      drawW = frameH * srcAspect;
    }
    const dx = frameX + (frameW - drawW) / 2;
    const dy = frameY + (frameH - drawH) / 2;
    ctx.drawImage(video, dx, dy, drawW, drawH);
  }, [canvasRef]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [canvasRef]);

  /** Seek video and draw once ready (for paused/scrubbing) */
  const seekAndDraw = useCallback((playhead: number) => {
    const { timeline } = useEditorStore.getState();
    const active = findActiveVideoClip(timeline, playhead);

    if (!active) {
      clearCanvas();
      return;
    }

    const video = getVideoElement(active.clip.src);
    video.muted = true; // always mute when scrubbing
    const needsSeek = Math.abs(video.currentTime - active.sourceTime) > 0.05;

    if (!needsSeek && video.readyState >= 2) {
      paintFrame(video);
      return;
    }

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      paintFrame(video);
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = active.sourceTime;

    if (video.readyState >= 2) {
      requestAnimationFrame(() => {
        video.removeEventListener("seeked", onSeeked);
        paintFrame(video);
      });
    }
  }, [getVideoElement, paintFrame, clearCanvas]);

  /** Sync audio elements during playback */
  const syncAudio = useCallback((playhead: number) => {
    const { timeline } = useEditorStore.getState();

    // --- Audio from video track (video files often have audio) ---
    const activeVideo = findActiveVideoClip(timeline, playhead);
    const videoAudioEnabled = activeVideo && !activeVideo.trackMuted && (activeVideo.clip.audioEnabled !== false);
    if (videoAudioEnabled) {
      const video = getVideoElement(activeVideo.clip.src);
      video.muted = false;

      // If video source changed, pause old one
      if (activeVideoSrc.current && activeVideoSrc.current !== activeVideo.clip.src) {
        const oldVideo = videoPool.current.get(activeVideoSrc.current);
        if (oldVideo) { oldVideo.muted = true; oldVideo.pause(); }
      }
      activeVideoSrc.current = activeVideo.clip.src;
    } else {
      // Mute all video elements if no active video or track is muted
      if (activeVideoSrc.current) {
        const oldVideo = videoPool.current.get(activeVideoSrc.current);
        if (oldVideo) oldVideo.muted = true;
        activeVideoSrc.current = null;
      }
      if (activeVideo) {
        const video = getVideoElement(activeVideo.clip.src);
        video.muted = true;
      }
    }

    // --- Separate audio tracks ---
    const activeAudios = findActiveAudioClips(timeline, playhead);
    const currentIds = new Set(activeAudios.map((a) => a.clip.id));

    // Stop audio clips that are no longer active
    for (const id of activeAudioIds.current) {
      if (!currentIds.has(id)) {
        // Find the clip's src to pause it
        for (const track of timeline.tracks) {
          const clip = track.clips.find((c) => c.id === id);
          if (clip) {
            const audio = audioPool.current.get(clip.src);
            if (audio) { audio.pause(); audio.muted = true; }
            break;
          }
        }
      }
    }

    // Play/sync active audio clips
    for (const active of activeAudios) {
      const audio = getAudioElement(active.clip.src);
      audio.muted = active.trackMuted;

      if (!activeAudioIds.current.has(active.clip.id)) {
        // New clip — seek and play
        audio.currentTime = active.sourceTime;
        if (!active.trackMuted) audio.play().catch(() => {});
      } else if (Math.abs(audio.currentTime - active.sourceTime) > 0.3) {
        // Drifted — resync
        audio.currentTime = active.sourceTime;
      }

      if (audio.paused && !active.trackMuted) {
        audio.play().catch(() => {});
      }
    }

    activeAudioIds.current = currentIds;
  }, [getVideoElement, getAudioElement]);

  /** Draw + sync during playback */
  const drawPlayingFrame = useCallback((playhead: number) => {
    const { timeline } = useEditorStore.getState();
    const active = findActiveVideoClip(timeline, playhead);

    if (!active) {
      clearCanvas();
    } else {
      const video = getVideoElement(active.clip.src);
      if (video.paused) {
        video.currentTime = active.sourceTime;
        video.play().catch(() => {});
      }
      if (video.readyState >= 2) {
        paintFrame(video);
      }
    }

    syncAudio(playhead);
  }, [getVideoElement, paintFrame, clearCanvas, syncAudio]);

  /** The render loop */
  const renderLoop = useCallback(() => {
    const store = useEditorStore.getState();
    if (!store.isPlaying) return;

    const elapsed = (performance.now() - lastPlayStartTime.current) / 1000;
    const newPlayhead = lastPlayheadAtStart.current + elapsed;

    if (newPlayhead >= store.timeline.duration) {
      store.setPlayheadPosition(store.timeline.duration);
      store.setIsPlaying(false);
      return;
    }

    store.setPlayheadPosition(newPlayhead);
    drawPlayingFrame(newPlayhead);
    rafId.current = requestAnimationFrame(renderLoop);
  }, [drawPlayingFrame]);

  // Start/stop render loop
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (state.isPlaying && !prevState.isPlaying) {
        // Start playback
        lastPlayStartTime.current = performance.now();
        lastPlayheadAtStart.current = state.playheadPosition;

        // Kick off video + audio
        const active = findActiveVideoClip(state.timeline, state.playheadPosition);
        if (active) {
          const video = getVideoElement(active.clip.src);
          video.muted = active.trackMuted || !active.clip.audioEnabled;
          video.currentTime = active.sourceTime;
          video.play().catch(() => {});
          activeVideoSrc.current = active.clip.src;
        }

        // Start audio clips
        const audioClips = findActiveAudioClips(state.timeline, state.playheadPosition);
        for (const ac of audioClips) {
          const audio = getAudioElement(ac.clip.src);
          audio.muted = ac.trackMuted;
          audio.currentTime = ac.sourceTime;
          if (!ac.trackMuted) audio.play().catch(() => {});
        }
        activeAudioIds.current = new Set(audioClips.map((a) => a.clip.id));

        rafId.current = requestAnimationFrame(renderLoop);
      } else if (!state.isPlaying && prevState.isPlaying) {
        // Stop playback
        cancelAnimationFrame(rafId.current);
        silenceAll();
        seekAndDraw(state.playheadPosition);
      }
    });

    return () => {
      unsub();
      cancelAnimationFrame(rafId.current);
    };
  }, [renderLoop, seekAndDraw, getVideoElement, getAudioElement, silenceAll]);

  // Scrubbing while paused
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (!state.isPlaying && state.playheadPosition !== prevState.playheadPosition) {
        seekAndDraw(state.playheadPosition);
      }
    });
    return unsub;
  }, [seekAndDraw]);

  // Initial draw + timeline changes
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (!state.isPlaying && state.timeline !== prevState.timeline) {
        seekAndDraw(state.playheadPosition);
      }
    });
    seekAndDraw(useEditorStore.getState().playheadPosition);
    return unsub;
  }, [seekAndDraw]);

  // Resize canvas
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      if (!useEditorStore.getState().isPlaying) {
        seekAndDraw(useEditorStore.getState().playheadPosition);
      }
    }
  }, [canvasRef, seekAndDraw]);

  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (canvasRef.current?.parentElement) {
      observer.observe(canvasRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [resizeCanvas, canvasRef]);

  // Cleanup
  useEffect(() => {
    return () => {
      videoPool.current.forEach((v) => { v.pause(); v.removeAttribute("src"); v.load(); });
      videoPool.current.clear();
      audioPool.current.forEach((a) => { a.pause(); a.removeAttribute("src"); a.load(); });
      audioPool.current.clear();
    };
  }, []);
}
