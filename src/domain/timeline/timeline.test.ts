import { describe, it, expect } from "vitest";
import { removeOrClearTrack, removeTrack, addClip } from "./timeline";
import { Timeline, Track, Clip } from "./models";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: over.id ?? "c",
    src: over.src ?? "/x.mp4",
    start: over.start ?? 0,
    end: over.end ?? 5,
    timelineStart: over.timelineStart ?? 0,
    name: "c",
  };
}

function track(over: Partial<Track> = {}): Track {
  return {
    id: over.id ?? "t",
    type: over.type ?? "video",
    clips: over.clips ?? [],
    muted: over.muted ?? false,
    locked: over.locked ?? false,
    hidden: over.hidden ?? false,
  };
}

describe("removeOrClearTrack", () => {
  it("removes the track when there is another video track", () => {
    const tl: Timeline = {
      tracks: [
        track({ id: "v1", clips: [clip({ id: "c1" })] }),
        track({ id: "v2" }),
      ],
      duration: 0,
    };
    const out = removeOrClearTrack(tl, "v1");
    expect(out.tracks.map((t) => t.id)).toEqual(["v2"]);
  });

  it("clears clips on the last video track instead of removing it", () => {
    const tl: Timeline = {
      tracks: [
        track({ id: "v", type: "video", clips: [clip({ id: "c1" }), clip({ id: "c2" })] }),
        track({ id: "a", type: "audio", clips: [clip({ id: "c3" })] }),
      ],
      duration: 0,
    };
    const out = removeOrClearTrack(tl, "v");
    // Track still present, but with no clips.
    expect(out.tracks).toHaveLength(2);
    const v = out.tracks.find((t) => t.id === "v")!;
    expect(v.clips).toEqual([]);
    // Audio track is untouched.
    const a = out.tracks.find((t) => t.id === "a")!;
    expect(a.clips).toHaveLength(1);
  });

  it("clears clips on the last audio track instead of removing it", () => {
    const tl: Timeline = {
      tracks: [
        track({ id: "v", type: "video" }),
        track({ id: "a", type: "audio", clips: [clip({ id: "c1" })] }),
      ],
      duration: 0,
    };
    const out = removeOrClearTrack(tl, "a");
    expect(out.tracks).toHaveLength(2);
    const a = out.tracks.find((t) => t.id === "a")!;
    expect(a.clips).toEqual([]);
  });

  it("video and audio counts are independent (removing the only video keeps it; another audio survives)", () => {
    const tl: Timeline = {
      tracks: [
        track({ id: "v", type: "video", clips: [clip()] }),
        track({ id: "a1", type: "audio" }),
        track({ id: "a2", type: "audio" }),
      ],
      duration: 0,
    };
    const out = removeOrClearTrack(tl, "v");
    expect(out.tracks.find((t) => t.id === "v")?.clips).toEqual([]);
    expect(out.tracks.find((t) => t.id === "a1")).toBeDefined();
    expect(out.tracks.find((t) => t.id === "a2")).toBeDefined();
  });

  it("unknown track id is a no-op", () => {
    const tl: Timeline = {
      tracks: [track({ id: "v" })],
      duration: 0,
    };
    expect(removeOrClearTrack(tl, "nope")).toEqual(tl);
  });

  it("preserves track flags (muted/locked/hidden) when clearing the last one", () => {
    const tl: Timeline = {
      tracks: [
        track({ id: "v", type: "video", muted: true, locked: true, hidden: false, clips: [clip()] }),
      ],
      duration: 0,
    };
    const out = removeOrClearTrack(tl, "v");
    const v = out.tracks[0];
    expect(v.muted).toBe(true);
    expect(v.locked).toBe(true);
    expect(v.clips).toEqual([]);
  });
});

describe("removeTrack (raw)", () => {
  it("still does an unconditional remove (used elsewhere)", () => {
    const tl: Timeline = {
      tracks: [track({ id: "v" }), track({ id: "a", type: "audio" })],
      duration: 0,
    };
    expect(removeTrack(tl, "v").tracks).toEqual([track({ id: "a", type: "audio" })]);
  });
});

describe("addClip (smoke)", () => {
  it("appends to the matching track", () => {
    const tl: Timeline = { tracks: [track({ id: "v", type: "video" })], duration: 0 };
    const out = addClip(tl, "v", clip({ id: "newclip" }));
    expect(out.tracks[0].clips).toHaveLength(1);
    expect(out.tracks[0].clips[0].id).toBe("newclip");
  });
});
