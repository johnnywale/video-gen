import { Timeline, Track, Clip } from "./models";

export function addTrack(timeline: Timeline, track: Track): Timeline {
  return { ...timeline, tracks: [...timeline.tracks, track] };
}

export function removeTrack(timeline: Timeline, trackId: string): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((t) => t.id !== trackId),
  };
}

/**
 * "Soft" remove: deletes the track if there's at least one other track of
 * the same type, otherwise clears the track's clips so the user always has
 * a video and an audio track to work with. Returns the timeline unchanged
 * when the track is unknown.
 */
export function removeOrClearTrack(timeline: Timeline, trackId: string): Timeline {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return timeline;
  const sameType = timeline.tracks.filter((t) => t.type === track.type);
  if (sameType.length <= 1) {
    // Last of its type — clear clips, keep the track shell.
    return {
      ...timeline,
      tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, clips: [] } : t)),
    };
  }
  return removeTrack(timeline, trackId);
}

export function addClip(timeline: Timeline, trackId: string, clip: Clip): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
    ),
  };
}

export function removeClip(timeline: Timeline, trackId: string, clipId: string): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
        : t
    ),
  };
}

export function updateClip(timeline: Timeline, trackId: string, updatedClip: Clip): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === updatedClip.id ? updatedClip : c)) }
        : t
    ),
  };
}

export function computeDuration(timeline: Timeline): number {
  let max = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + (clip.end - clip.start);
      if (end > max) max = end;
    }
  }
  return max;
}
