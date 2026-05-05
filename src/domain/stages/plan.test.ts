import { describe, it, expect } from "vitest";
import {
  generateRandomStages,
  rerollStage,
  updateStage,
  planToClips,
  totalPlanDuration,
  pickRandomTimestamp,
} from "./plan";

const media = { id: "m1", duration: 600 }; // 10-minute source

/** Deterministic RNG returning a fixed sequence of [0,1) values, looping. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("pickRandomTimestamp", () => {
  it("returns a value in [0, duration - length]", () => {
    expect(pickRandomTimestamp(100, 10, () => 0)).toBe(0);
    expect(pickRandomTimestamp(100, 10, () => 1 - 1e-12)).toBeCloseTo(90, 5);
    expect(pickRandomTimestamp(100, 10, () => 0.5)).toBeCloseTo(45, 5);
  });

  it("returns 0 when length >= duration", () => {
    expect(pickRandomTimestamp(10, 10, () => 0.5)).toBe(0);
    expect(pickRandomTimestamp(10, 100, () => 0.5)).toBe(0);
  });
});

describe("generateRandomStages", () => {
  it("creates count stages with equal length summing to totalDuration", () => {
    const plan = generateRandomStages(media, 30, 5, seq([0]));
    expect(plan.stages).toHaveLength(5);
    for (const s of plan.stages) expect(s.length).toBeCloseTo(6, 5);
    expect(totalPlanDuration(plan)).toBeCloseTo(30, 5);
  });

  it("each stage's sourceTime is within the media", () => {
    const plan = generateRandomStages(media, 30, 5, seq([0.1, 0.5, 0.9, 0.0, 0.3]));
    for (const s of plan.stages) {
      expect(s.sourceTime).toBeGreaterThanOrEqual(0);
      expect(s.sourceTime + s.length).toBeLessThanOrEqual(media.duration + 1e-9);
    }
  });

  it("returns empty plan when count is 0", () => {
    expect(generateRandomStages(media, 30, 0).stages).toHaveLength(0);
  });

  it("returns empty plan when duration is 0", () => {
    expect(generateRandomStages(media, 0, 5).stages).toHaveLength(0);
  });

  it("returns empty plan when media has no duration", () => {
    expect(generateRandomStages({ id: "x", duration: 0 }, 30, 5).stages).toHaveLength(0);
  });

  it("each stage gets a unique id", () => {
    const plan = generateRandomStages(media, 30, 5);
    const ids = new Set(plan.stages.map((s) => s.id));
    expect(ids.size).toBe(5);
  });
});

describe("rerollStage", () => {
  it("only re-randomises the targeted stage", () => {
    const plan = generateRandomStages(media, 30, 3, seq([0.1, 0.2, 0.3]));
    const target = plan.stages[1];
    const re = rerollStage(plan, target.id, media.duration, seq([0.7]));
    expect(re.stages[0].sourceTime).toBe(plan.stages[0].sourceTime);
    expect(re.stages[2].sourceTime).toBe(plan.stages[2].sourceTime);
    expect(re.stages[1].sourceTime).not.toBe(plan.stages[1].sourceTime);
  });

  it("clears the stale thumbnail on the rerolled stage", () => {
    const plan = generateRandomStages(media, 30, 2, seq([0.1, 0.2]));
    const withThumb = updateStage(plan, plan.stages[0].id, { thumbnail: "data:image/jpeg;base64,XXX" });
    const re = rerollStage(withThumb, withThumb.stages[0].id, media.duration, seq([0.5]));
    expect(re.stages[0].thumbnail).toBeUndefined();
  });
});

describe("updateStage", () => {
  it("updates length and clears thumbnail (timing changed)", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0.1]));
    const withThumb = updateStage(plan, plan.stages[0].id, { thumbnail: "DATA" });
    const updated = updateStage(withThumb, withThumb.stages[0].id, { length: 12 });
    expect(updated.stages[0].length).toBe(12);
    expect(updated.stages[0].thumbnail).toBeUndefined();
  });

  it("text edit preserves the existing thumbnail", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0.1]));
    const withThumb = updateStage(plan, plan.stages[0].id, { thumbnail: "DATA" });
    const withText = updateStage(withThumb, withThumb.stages[0].id, { text: "Hello world" });
    expect(withText.stages[0].text).toBe("Hello world");
    expect(withText.stages[0].thumbnail).toBe("DATA");
  });

  it("setting only thumbnail keeps timing AND keeps the new thumbnail", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0.1]));
    const updated = updateStage(plan, plan.stages[0].id, { thumbnail: "DATA" });
    expect(updated.stages[0].thumbnail).toBe("DATA");
    expect(updated.stages[0].sourceTime).toBe(plan.stages[0].sourceTime);
  });

  it("ignores updates to non-existent stage ids", () => {
    const plan = generateRandomStages(media, 30, 1);
    const updated = updateStage(plan, "nope", { length: 99 });
    expect(updated.stages).toEqual(plan.stages);
  });
});

describe("planToClips", () => {
  it("emits clips back-to-back starting at placeStart", () => {
    const plan = generateRandomStages(media, 30, 3, seq([0.1, 0.4, 0.8]));
    const clips = planToClips(plan, { src: "/v.mp4" }, 100);
    expect(clips).toHaveLength(3);
    expect(clips[0].timelineStart).toBe(100);
    expect(clips[1].timelineStart).toBeCloseTo(110, 5);
    expect(clips[2].timelineStart).toBeCloseTo(120, 5);
    for (const c of clips) {
      expect(c.end - c.start).toBeCloseTo(10, 5);
      expect(c.src).toBe("/v.mp4");
    }
  });

  it("each clip's source range matches the stage's sourceTime + length", () => {
    const plan = generateRandomStages(media, 30, 2, seq([0]));
    const clips = planToClips(plan, { src: "/v.mp4" });
    expect(clips[0].start).toBe(plan.stages[0].sourceTime);
    expect(clips[0].end).toBeCloseTo(plan.stages[0].sourceTime + plan.stages[0].length, 5);
  });

  it("skips stages with non-positive length", () => {
    const plan = generateRandomStages(media, 30, 3, seq([0.1, 0.2, 0.3]));
    const broken = updateStage(plan, plan.stages[1].id, { length: 0 });
    const clips = planToClips(broken, { src: "/v.mp4" });
    expect(clips).toHaveLength(2);
  });

  it("default placeStart is 0", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0]));
    const clips = planToClips(plan, { src: "/v.mp4" });
    expect(clips[0].timelineStart).toBe(0);
  });

  it("propagates stage.text to clip.text when set", () => {
    const plan = generateRandomStages(media, 30, 2, seq([0.1, 0.5]));
    const withText = updateStage(plan, plan.stages[0].id, { text: "Caption A" });
    const clips = planToClips(withText, { src: "/v.mp4" });
    expect(clips[0].text).toBe("Caption A");
    expect(clips[1].text).toBeUndefined();
  });

  it("speed=0.5 takes half the source range; back-to-back placement uses on-timeline length", () => {
    // 2 stages, on-timeline length 10s each (default since totalDuration=20, count=2)
    const plan = generateRandomStages(media, 20, 2, seq([0]));
    const slowed = updateStage(plan, plan.stages[0].id, { speed: 0.5 });
    const clips = planToClips(slowed, { src: "/v.mp4" }, 0);

    // Stage 0 occupies [0..10] on the timeline (length=10) but only consumes
    // 5 seconds of source (length × speed = 10 × 0.5).
    expect(clips[0].timelineStart).toBe(0);
    expect(clips[0].end - clips[0].start).toBeCloseTo(5, 5);
    expect(clips[0].speed).toBe(0.5);

    // Stage 1 stays at speed 1 (no field set), takes full 10 s of source,
    // and is placed at on-timeline 10 (the previous stage's on-timeline length).
    expect(clips[1].timelineStart).toBeCloseTo(10, 5);
    expect(clips[1].end - clips[1].start).toBeCloseTo(10, 5);
    expect(clips[1].speed).toBeUndefined();
  });

  it("speed=1 omits the speed field on the clip (clean default)", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0]));
    const explicit = updateStage(plan, plan.stages[0].id, { speed: 1 });
    const clips = planToClips(explicit, { src: "/v.mp4" });
    expect(clips[0].speed).toBeUndefined();
  });

  it("default speed seed (0.3) populates each stage and survives planToClips", () => {
    const plan = generateRandomStages(media, 30, 5, seq([0]), { speed: 0.3 });
    expect(plan.stages.every((s) => s.speed === 0.3)).toBe(true);
    const clips = planToClips(plan, { src: "/v.mp4" });
    // length 6s, speed 0.3 → source window = 1.8s. Each clip's source
    // range is exactly 1.8s.
    for (const c of clips) {
      expect(c.end - c.start).toBeCloseTo(1.8, 5);
      expect(c.speed).toBe(0.3);
    }
  });

  it("default speed=1 still produces speed-less stages (no field set)", () => {
    const plan = generateRandomStages(media, 30, 5, seq([0]));
    expect(plan.stages.every((s) => s.speed === undefined)).toBe(true);
  });

  it("propagates textStyle to clips", () => {
    const plan = generateRandomStages(media, 30, 1, seq([0]));
    const styled = updateStage(plan, plan.stages[0].id, { textStyle: 2 });
    const clips = planToClips(styled, { src: "/v.mp4" });
    expect(clips[0].textStyle).toBe(2);
  });
});

describe("totalPlanDuration", () => {
  it("sums all stage lengths", () => {
    const plan = generateRandomStages(media, 24, 4, seq([0]));
    expect(totalPlanDuration(plan)).toBeCloseTo(24, 5);
  });

  it("ignores negative lengths", () => {
    const plan = generateRandomStages(media, 30, 2, seq([0]));
    const broken = updateStage(plan, plan.stages[0].id, { length: -5 });
    expect(totalPlanDuration(broken)).toBeCloseTo(15, 5); // -5 floored to 0, +15
  });

  it("reflects user edits to stage lengths", () => {
    const plan = generateRandomStages(media, 30, 3, seq([0]));
    const edited = updateStage(plan, plan.stages[0].id, { length: 20 });
    expect(totalPlanDuration(edited)).toBeCloseTo(30 - 10 + 20, 5); // 40
  });
});
