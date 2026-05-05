import { Timeline } from "@/domain/timeline/models";

type Snapshot = { timeline: Timeline };

const LIMIT = 50;
const pastStack: Snapshot[] = [];
const futureStack: Snapshot[] = [];

export function pushSnapshot(timeline: Timeline) {
  pastStack.push({ timeline: structuredClone(timeline) });
  if (pastStack.length > LIMIT) pastStack.shift();
  futureStack.length = 0;
}

export function undoSnapshot(currentTimeline: Timeline): Snapshot | null {
  if (pastStack.length === 0) return null;
  futureStack.push({ timeline: structuredClone(currentTimeline) });
  return pastStack.pop()!;
}

export function redoSnapshot(currentTimeline: Timeline): Snapshot | null {
  if (futureStack.length === 0) return null;
  pastStack.push({ timeline: structuredClone(currentTimeline) });
  return futureStack.pop()!;
}

export function canUndo(): boolean {
  return pastStack.length > 0;
}

export function canRedo(): boolean {
  return futureStack.length > 0;
}
