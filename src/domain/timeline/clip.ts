import { Clip } from "./models";

export function trimClip(clip: Clip, start: number, end: number): Clip {
  if (start < 0) throw new Error("Trim start must be >= 0");
  if (end <= start) throw new Error("Trim end must be > start");
  return { ...clip, start, end };
}

export function moveClip(clip: Clip, timelineStart: number): Clip {
  if (timelineStart < 0) throw new Error("Timeline start must be >= 0");
  return { ...clip, timelineStart };
}

/**
 * On-timeline duration of a clip. If speed is set, this is the source
 * range divided by the playback speed — slow-motion clips occupy more
 * timeline seconds than they take from the source file.
 */
export function clipDuration(clip: Clip): number {
  const sourceLen = clip.end - clip.start;
  const speed = clip.speed ?? 1;
  return sourceLen / Math.max(0.0001, speed);
}

export function splitClip(clip: Clip, sourceTime: number): [Clip, Clip] {
  if (sourceTime <= clip.start || sourceTime >= clip.end) {
    throw new Error("Split time must be between clip start and end");
  }
  const clipA: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    end: sourceTime,
  };
  const clipB: Clip = {
    ...clip,
    id: crypto.randomUUID(),
    start: sourceTime,
    timelineStart: clip.timelineStart + (sourceTime - clip.start),
  };
  return [clipA, clipB];
}
