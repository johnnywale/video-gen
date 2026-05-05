import { describe, it, expect } from "vitest";
import { findInsertPosition } from "./track";
import { Track, Clip } from "./models";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: over.id ?? crypto.randomUUID(),
    src: over.src ?? "/x.mp4",
    start: over.start ?? 0,
    end: over.end ?? 5,
    timelineStart: over.timelineStart ?? 0,
    name: over.name ?? "c",
  };
}

function track(clips: Clip[]): Track {
  return { id: "t", type: "audio", clips, muted: false, locked: false, hidden: false };
}

describe("findInsertPosition", () => {
  it("empty track — returns preferred start", () => {
    expect(findInsertPosition(track([]), 5, 10)).toBe(5);
  });

  it("preferred start with no overlap — returns preferred", () => {
    const t = track([clip({ timelineStart: 0, end: 4 })]);
    // New clip duration=3 starting at 5 → ends at 8, no overlap with [0..4]
    expect(findInsertPosition(t, 5, 3)).toBe(5);
  });

  it("preferred start overlaps existing clip — pushes to end of that clip", () => {
    // Existing clip: start=0, end=10, on timeline [0..10]
    const t = track([clip({ timelineStart: 0, start: 0, end: 10 })]);
    // Prefer 5 (in the middle of existing) → must push to 10
    expect(findInsertPosition(t, 5, 4)).toBe(10);
  });

  it("preferred start before clip but new clip's tail overlaps — pushes past", () => {
    // Existing: timelineStart=8, end=12 → on timeline [8..12]
    const t = track([clip({ timelineStart: 8, start: 0, end: 4 })]);
    // Prefer 5, duration 5 → would occupy [5..10] which overlaps [8..12]
    expect(findInsertPosition(t, 5, 5)).toBe(12);
  });

  it("must hop past multiple overlapping clips in order", () => {
    const t = track([
      clip({ timelineStart: 0, start: 0, end: 5 }),  // [0..5]
      clip({ timelineStart: 5, start: 0, end: 5 }),  // [5..10]
      clip({ timelineStart: 10, start: 0, end: 5 }), // [10..15]
    ]);
    // Prefer 0 with duration 4 → first overlaps [0..5], push to 5 → overlaps [5..10],
    // push to 10 → overlaps [10..15], push to 15 → no overlap
    expect(findInsertPosition(t, 0, 4)).toBe(15);
  });

  it("preferred start past all clips — returns preferred", () => {
    const t = track([
      clip({ timelineStart: 0, start: 0, end: 5 }),
      clip({ timelineStart: 10, start: 0, end: 5 }),
    ]);
    expect(findInsertPosition(t, 100, 5)).toBe(100);
  });

  it("preferred start in gap between two clips — fits if duration short enough", () => {
    const t = track([
      clip({ timelineStart: 0, start: 0, end: 5 }),  // [0..5]
      clip({ timelineStart: 20, start: 0, end: 5 }), // [20..25]
    ]);
    // Prefer 8, duration 5 → [8..13], fits in gap
    expect(findInsertPosition(t, 8, 5)).toBe(8);
  });

  it("negative preferred start — clamped to 0", () => {
    const t = track([]);
    expect(findInsertPosition(t, -5, 3)).toBe(0);
  });

  it("trimmed clip uses end-start as on-timeline duration", () => {
    // Source-trimmed clip: start=2, end=10 → on-timeline span = 8 seconds at timelineStart=0
    const t = track([clip({ timelineStart: 0, start: 2, end: 10 })]);
    // Prefer 4 (in the middle of [0..8]) → push to 8
    expect(findInsertPosition(t, 4, 3)).toBe(8);
  });
});
