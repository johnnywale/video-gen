import { Track, Clip } from "./models";

export function sortClips(track: Track): Track {
  return {
    ...track,
    clips: [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart),
  };
}

/**
 * Pick a non-overlapping timelineStart on `track` for a new clip of `duration`,
 * preferring `preferredStart` (typically the playhead). If that range would
 * overlap an existing clip, push the new clip to the end of the latest
 * overlapping clip and re-check. Returns a position that doesn't overlap any
 * existing clip on this track.
 */
export function findInsertPosition(
  track: Track,
  preferredStart: number,
  duration: number
): number {
  const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
  let start = Math.max(0, preferredStart);

  // Iterate until no overlap. Each pass pushes past any clip we collide with.
  // Bounded by the number of clips — at most one push per existing clip.
  for (let i = 0; i < sorted.length + 1; i++) {
    const overlap = sorted.find((c) => {
      const cEnd = c.timelineStart + (c.end - c.start);
      return start < cEnd && start + duration > c.timelineStart;
    });
    if (!overlap) return start;
    start = overlap.timelineStart + (overlap.end - overlap.start);
  }
  return start;
}

export function hasOverlap(track: Track): boolean {
  const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (cur.timelineStart + (cur.end - cur.start) > next.timelineStart) return true;
  }
  return false;
}

export function updateClipInTrack(track: Track, updatedClip: Clip): Track {
  return {
    ...track,
    clips: track.clips.map((c) => (c.id === updatedClip.id ? updatedClip : c)),
  };
}
