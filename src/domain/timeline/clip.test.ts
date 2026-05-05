import { describe, it, expect } from "vitest";
import { clipDuration } from "./clip";
import { Clip } from "./models";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    src: "/x.mp4",
    start: 0,
    end: 10,
    timelineStart: 0,
    name: "c",
    ...over,
  };
}

describe("clipDuration", () => {
  it("at speed 1 (default), duration = end - start", () => {
    expect(clipDuration(clip({ start: 2, end: 12 }))).toBe(10);
  });

  it("at speed undefined, duration = end - start", () => {
    expect(clipDuration(clip({ start: 0, end: 5 }))).toBe(5);
  });

  it("speed 0.5 stretches on-timeline duration by 2×", () => {
    // 5 source seconds at half speed → 10 timeline seconds
    expect(clipDuration(clip({ start: 0, end: 5, speed: 0.5 }))).toBe(10);
  });

  it("speed 2 compresses on-timeline duration by half", () => {
    // 10 source seconds at 2× → 5 timeline seconds
    expect(clipDuration(clip({ start: 0, end: 10, speed: 2 }))).toBe(5);
  });

  it("speed 0.25 stretches by 4×", () => {
    expect(clipDuration(clip({ start: 0, end: 4, speed: 0.25 }))).toBe(16);
  });

  it("zero or negative speed is clamped (no division by zero)", () => {
    // Result is bounded; we only require it doesn't blow up to Infinity.
    const d = clipDuration(clip({ start: 0, end: 1, speed: 0 }));
    expect(Number.isFinite(d)).toBe(true);
  });
});
