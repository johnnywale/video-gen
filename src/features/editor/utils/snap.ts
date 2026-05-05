import { Timeline } from "@/domain/timeline/models";
import { clipDuration } from "@/domain/timeline/clip";

export interface SnapResult {
  snappedPosition: number;
  snapLine: number | null;
}

export function computeSnap(
  draggingClipId: string,
  proposedStart: number,
  duration: number,
  timeline: Timeline,
  playheadPosition: number,
  pixelsPerSecond: number,
  thresholdPx: number
): SnapResult {
  const threshold = thresholdPx / pixelsPerSecond;
  const proposedEnd = proposedStart + duration;

  const targets: number[] = [0, playheadPosition];

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === draggingClipId) continue;
      targets.push(clip.timelineStart);
      targets.push(clip.timelineStart + clipDuration(clip));
    }
  }

  let bestDelta = Infinity;
  let bestSnap: number | null = null;
  let snapLinePos: number | null = null;

  for (const target of targets) {
    const deltaStart = Math.abs(proposedStart - target);
    if (deltaStart < threshold && deltaStart < bestDelta) {
      bestDelta = deltaStart;
      bestSnap = target;
      snapLinePos = target;
    }

    const deltaEnd = Math.abs(proposedEnd - target);
    if (deltaEnd < threshold && deltaEnd < bestDelta) {
      bestDelta = deltaEnd;
      bestSnap = target - duration;
      snapLinePos = target;
    }
  }

  if (bestSnap !== null) {
    return { snappedPosition: bestSnap, snapLine: snapLinePos };
  }

  return { snappedPosition: proposedStart, snapLine: null };
}
