import { describe, it, expect } from "vitest";
import { buildFFmpegCommand, ensureCompatibleContainer, buildCaptionFilter, estimateExportDuration } from "./ffmpegGraph";
import { Timeline, Track, Clip, ProjectSettings } from "../timeline/models";

const SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "libx264",
  crf: 18,
  preset: "fast",
  audioBitrate: "192k",
  transitionType: "none",
  transitionDuration: 1.0,
};

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    src: "/tmp/a.mp4",
    start: 0,
    end: 5,
    timelineStart: 0,
    name: "clip",
    ...over,  // overrides take precedence; lets fields like `speed`/`text` flow through
  };
}

function videoTrack(clips: Clip[], over: Partial<Track> = {}): Track {
  return { id: over.id ?? "vt", type: "video", clips, muted: over.muted ?? false, locked: false, hidden: false };
}

function audioTrack(clips: Clip[], over: Partial<Track> = {}): Track {
  return { id: over.id ?? "at", type: "audio", clips, muted: over.muted ?? false, locked: false, hidden: false };
}

function timeline(tracks: Track[]): Timeline {
  return { tracks, duration: 10 };
}

function getFilter(args: string[]): string {
  const i = args.indexOf("-filter_complex");
  return i === -1 ? "" : args[i + 1];
}

describe("buildFFmpegCommand — audio combination", () => {
  it("single video clip with audio enabled — acopy (no amix)", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[va0]");
    expect(f).toContain("[va0]acopy[outa_mix]");
    expect(f).not.toContain("amix");
    expect(args).toContain("-map");
    expect(args).toContain("[outa]");
  });

  it("single video clip with audioEnabled=false — no audio in graph", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4", audioEnabled: false })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(f).not.toContain(":a]");
    expect(f).not.toContain("[outa]");
    expect(f).not.toContain("amix");
    expect(f).not.toContain("acopy");
    // Output should not have audio mapping
    const mapArgs = args.reduce<string[]>((acc, a, i) => (args[i - 1] === "-map" ? [...acc, a] : acc), []);
    expect(mapArgs).not.toContain("[outa]");
  });

  it("single audio-only clip — acopy single, no video output", () => {
    const tl = timeline([audioTrack([clip({ src: "/a.mp3" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS[a0]");
    expect(f).toContain("[a0]acopy[outa_mix]");
    expect(f).not.toContain("[outv]");
    expect(f).not.toContain("amix");
  });

  it("two audio clips on one track — amix=inputs=2 with adelay for the offset clip", () => {
    const tl = timeline([
      audioTrack([clip({ id: "c1", src: "/a1.mp3" }), clip({ id: "c2", src: "/a2.mp3", timelineStart: 5 })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    // First clip is at t=0 → no delay needed.
    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS[a0]");
    // Second clip starts at 5s on the timeline → adelay 5000 ms.
    expect(f).toContain("[1:a]asetpts=PTS-STARTPTS,adelay=5000:all=1[a1]");
    expect(f).toContain("[a0][a1]amix=inputs=2[outa_mix]");
    expect(f).not.toContain("acopy");
  });

  it("audio-clip volume injects a `volume=N` filter; default 1 stays out of the chain", () => {
    const tl = timeline([
      audioTrack([
        clip({ id: "loud",   src: "/loud.mp3",   volume: 1.5, timelineStart: 0 }),
        clip({ id: "quiet",  src: "/quiet.mp3",  volume: 0.4, timelineStart: 4 }),
        clip({ id: "normal", src: "/normal.mp3",              timelineStart: 8 }),
      ]),
    ]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    // 1.5 → `volume=1.500` (and no adelay since timelineStart=0).
    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS,volume=1.500[a0]");
    // 0.4 + 4s offset → both filters in the chain, in this order.
    expect(f).toContain("[1:a]asetpts=PTS-STARTPTS,volume=0.400,adelay=4000:all=1[a1]");
    // No volume → no `volume=` filter (only adelay).
    expect(f).toContain("[2:a]asetpts=PTS-STARTPTS,adelay=8000:all=1[a2]");
    expect(f).not.toMatch(/\[2:a\][^[]*volume=/);
  });

  it("video clip + separate audio clip — amix combines video-audio + audio-clip", () => {
    const tl = timeline([
      videoTrack([clip({ id: "v1", src: "/v.mp4" })]),
      audioTrack([clip({ id: "a1", src: "/bgm.mp3" })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    // Video clip is input 0, audio clip is input 1
    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[va0]");
    expect(f).toContain("[1:a]asetpts=PTS-STARTPTS[a1]");
    // Order in amix: video-audio labels first, then audio-clip labels
    expect(f).toContain("[va0][a1]amix=inputs=2[outa_mix]");
  });

  it("video with audioEnabled=false + separate audio — only audio clip mapped, acopy", () => {
    const tl = timeline([
      videoTrack([clip({ id: "v1", src: "/v.mp4", audioEnabled: false })]),
      audioTrack([clip({ id: "a1", src: "/bgm.mp3" })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(f).not.toContain("[va0]");
    expect(f).toContain("[a1]acopy[outa_mix]");
    expect(f).not.toContain("amix");
  });

  it("muted audio track is excluded entirely", () => {
    const tl = timeline([
      videoTrack([clip({ id: "v1", src: "/v.mp4" })]),
      audioTrack([clip({ id: "a1", src: "/bgm.mp3" })], { muted: true }),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    // Muted audio track's clip should not appear as -i input
    expect(args).not.toContain("/bgm.mp3");
    expect(f).not.toContain("[a1]");
    // Only video-clip audio remains → acopy single
    expect(f).toContain("[va0]acopy[outa_mix]");
  });

  it("muted video track is excluded — its audio is not pulled either", () => {
    const tl = timeline([
      videoTrack([clip({ id: "v1", src: "/v.mp4" })], { muted: true }),
      audioTrack([clip({ id: "a1", src: "/bgm.mp3" })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(args).not.toContain("/v.mp4");
    expect(f).not.toContain("[va0]");
    // No video → no concat, no [outv]
    expect(f).not.toContain("[outv]");
    // Audio clip becomes input 0
    expect(f).toContain("[0:a]asetpts=PTS-STARTPTS[a0]");
    expect(f).toContain("[a0]acopy[outa_mix]");
  });

  it("three sources mixed: 2 video clips with audio + 1 audio clip → amix=inputs=3", () => {
    const tl = timeline([
      videoTrack([
        clip({ id: "v1", src: "/v1.mp4" }),
        clip({ id: "v2", src: "/v2.mp4", timelineStart: 5 }),
      ]),
      audioTrack([clip({ id: "a1", src: "/bgm.mp3" })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    // Video-clip audio labels come first, then audio-clip labels
    expect(f).toContain("[va0][va1][a2]amix=inputs=3[outa_mix]");
    expect(f).toContain("[v0][v1]concat=n=2:v=1:a=0[outv]");
  });

  it("video clips without audio + video concat — no [outa] mapping at all", () => {
    const tl = timeline([
      videoTrack([
        clip({ id: "v1", src: "/v1.mp4", audioEnabled: false }),
        clip({ id: "v2", src: "/v2.mp4", audioEnabled: false, timelineStart: 5 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    expect(f).toContain("[v0][v1]concat=n=2:v=1:a=0[outv]");
    expect(f).not.toContain("[outa]");
    expect(f).not.toContain("amix");
    expect(f).not.toContain("acopy");

    const mapArgs = args.reduce<string[]>((acc, a, i) => (args[i - 1] === "-map" ? [...acc, a] : acc), []);
    expect(mapArgs).toEqual(["[outv]"]);
  });

  it("empty timeline — generates a 1-frame black image, no audio", () => {
    const tl = timeline([]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);

    expect(args).toContain("lavfi");
    expect(args.some((a) => a.startsWith("color=black"))).toBe(true);
    expect(args).toContain("-frames:v");
    // No -filter_complex needed
    expect(args).not.toContain("-filter_complex");
  });

  it("input args use -ss/-to/-i in correct order for trimming", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4", start: 1.5, end: 4.25 })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);

    // Find the first -i and check the preceding -ss/-to
    const i = args.indexOf("-i");
    expect(args[i - 4]).toBe("-ss");
    expect(args[i - 3]).toBe("1.5");
    expect(args[i - 2]).toBe("-to");
    expect(args[i - 1]).toBe("4.25");
    expect(args[i + 1]).toBe("/v.mp4");
  });

  it("output encoder args reflect project settings", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", {
      ...SETTINGS,
      codec: "libx265",
      crf: 22,
      preset: "slow",
      audioBitrate: "256k",
      fps: 60,
    });

    expect(args).toContain("-c:v");
    expect(args).toContain("libx265");
    expect(args).toContain("-crf");
    expect(args).toContain("22");
    expect(args).toContain("-preset");
    expect(args).toContain("slow");
    expect(args).toContain("-b:a");
    expect(args).toContain("256k");
    expect(args).toContain("-r");
    expect(args).toContain("60");
    expect(args[args.length - 1]).toBe("/out.mp4");
    expect(args[args.length - 2]).toBe("-y");
  });

  it("input indices are sequential across video then audio inputs", () => {
    const tl = timeline([
      videoTrack([
        clip({ id: "v1", src: "/v1.mp4" }),
        clip({ id: "v2", src: "/v2.mp4", timelineStart: 5 }),
      ]),
      audioTrack([
        clip({ id: "a1", src: "/a1.mp3" }),
        clip({ id: "a2", src: "/a2.mp3", timelineStart: 5 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    const f = getFilter(args);

    // Inputs 0,1 are video; 2,3 are audio
    expect(f).toContain("[0:v]");
    expect(f).toContain("[1:v]");
    expect(f).toContain("[2:a]asetpts=PTS-STARTPTS[a2]");
    // a2 sits at the new "audio" track at t=0 (a3 is the offset one →
    // gets adelay so it lands at 5s in the mix).
    expect(f).toContain("[3:a]asetpts=PTS-STARTPTS,adelay=5000:all=1[a3]");
    expect(f).toContain("[va0][va1][a2][a3]amix=inputs=4[outa_mix]");
  });
});

describe("buildFFmpegCommand — transitions", () => {
  const withTrans = (type: ProjectSettings["transitionType"], duration = 1.0): ProjectSettings => ({
    ...SETTINGS,
    transitionType: type,
    transitionDuration: duration,
  });

  it("transitionType none — uses simple concat (back-compat)", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("none"));
    const f = getFilter(args);
    expect(f).toContain("[v0][v1]concat=n=2:v=1:a=0[outv]");
    expect(f).not.toContain("xfade");
  });

  it("transitionType fade with 2 clips — single xfade with correct offset", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),    // 6 s
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("fade", 1));
    const f = getFilter(args);
    // Offset = first clip duration (6) - transition duration (1) = 5.000
    expect(f).toContain("[v0][v1]xfade=transition=fade:duration=1:offset=5.000[outv]");
    expect(f).not.toContain("concat=");
  });

  it("transitionType dissolve with 3 clips — chained xfades, accumulating offsets", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
        clip({ src: "/v3.mp4", start: 0, end: 4, timelineStart: 12 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("dissolve", 1));
    const f = getFilter(args);
    // First xfade: offset = 6 - 1 = 5
    expect(f).toContain("[v0][v1]xfade=transition=dissolve:duration=1:offset=5.000[xv1]");
    // After first: cumDur = 6 + (6 - 1) = 11. Second xfade offset = 11 - 1 = 10
    expect(f).toContain("[xv1][v2]xfade=transition=dissolve:duration=1:offset=10.000[outv]");
  });

  it("xfade with single clip — falls through to concat (no peer to fade with)", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("fade"));
    const f = getFilter(args);
    expect(f).toContain("concat=n=1:v=1:a=0[outv]");
    expect(f).not.toContain("xfade");
  });

  it("xfade chains video-clip audio via acrossfade into [outva] before amix", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
      ]),
      audioTrack([clip({ src: "/bgm.mp3" })]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("fade", 1));
    const f = getFilter(args);
    // Video-clip audio acrossfaded into [outva]
    expect(f).toContain("[va0][va1]acrossfade=d=1[outva]");
    // Then amixed with the audio-track clip
    expect(f).toContain("[outva][a2]amix=inputs=2[outa_mix]");
  });

  it("xfade with no audio — only video output, no [outa] mapping", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", audioEnabled: false, start: 0, end: 6 }),
        clip({ src: "/v2.mp4", audioEnabled: false, start: 0, end: 6, timelineStart: 6 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("fade", 1));
    const f = getFilter(args);
    expect(f).toContain("xfade=transition=fade");
    expect(f).not.toContain("acrossfade");
    expect(f).not.toContain("[outa]");
  });

  it("output args include mp4-compat flags (pix_fmt yuv420p, faststart)", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", SETTINGS);
    expect(args).toContain("-pix_fmt");
    expect(args).toContain("yuv420p");
    expect(args).toContain("-movflags");
    expect(args).toContain("+faststart");
  });

  it("each video filter normalizes to fps + yuv420p + setsar=1 (xfade compat)", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    expect(f).toMatch(/\[0:v\][^[]*setsar=1,fps=30,format=yuv420p\[v0\]/);
  });

  it("audio is trimmed/padded to exactly the video output duration (concat)", () => {
    // 2 video clips, 6 s each → 12 s total. Audio should be trimmed/padded
    // to 12.000 s so it doesn't run past the end of the video.
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
      ]),
    ]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", withTrans("none")));
    expect(f).toContain("[outa_mix]atrim=0:12.000,apad=whole_dur=12.000,asetpts=PTS-STARTPTS[outa]");
  });

  it("audio trim/pad matches xfade-shortened video duration", () => {
    // 2 clips × 6 s with a 1 s xfade → output is 11 s, not 12.
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 6 }),
        clip({ src: "/v2.mp4", start: 0, end: 6, timelineStart: 6 }),
      ]),
    ]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", withTrans("fade", 1)));
    expect(f).toContain("atrim=0:11.000,apad=whole_dur=11.000");
  });

  it("VP9 codec auto-corrects .mp4 output path to .webm (was producing unplayable file)", () => {
    expect(ensureCompatibleContainer("/Users/x/output.mp4", "libvpx-vp9")).toBe("/Users/x/output.webm");
    expect(ensureCompatibleContainer("/Users/x/output.mov", "libvpx-vp9")).toBe("/Users/x/output.webm");
    expect(ensureCompatibleContainer("/Users/x/output", "libvpx-vp9")).toBe("/Users/x/output.webm");
  });

  it("H.264 codec auto-corrects .webm output path to .mp4", () => {
    expect(ensureCompatibleContainer("/Users/x/output.webm", "libx264")).toBe("/Users/x/output.mp4");
    expect(ensureCompatibleContainer("/Users/x/output.webm", "libx265")).toBe("/Users/x/output.mp4");
  });

  it("compatible codec/extension combos are passed through unchanged", () => {
    expect(ensureCompatibleContainer("/x/o.mp4", "libx264")).toBe("/x/o.mp4");
    expect(ensureCompatibleContainer("/x/o.m4v", "libx264")).toBe("/x/o.m4v");
    expect(ensureCompatibleContainer("/x/o.mov", "libx264")).toBe("/x/o.mov");
    expect(ensureCompatibleContainer("/x/o.webm", "libvpx-vp9")).toBe("/x/o.webm");
  });

  it("buildFFmpegCommand rewrites the output path when codec/container mismatch", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4" })])]);
    const args = buildFFmpegCommand(tl, "/out.mp4", { ...SETTINGS, codec: "libvpx-vp9" });
    // Last arg is the (corrected) output path.
    expect(args[args.length - 1]).toBe("/out.webm");
  });

  // ── Slow-motion regression tests ────────────────────────────────────
  // These reproduce the exact scenario from the user's bug report:
  // 5 stages, each length=6s on timeline at speed=0.3 (so source span
  // = 1.8s). Without setpts the export was 2.2s; with it, the timeline
  // total is 30s before transitions and 23.2s with 1.7s xfades.

  it("slow-motion: setpts multiplier appears in video filter", () => {
    const tl = timeline([videoTrack([
      // length=6 on-timeline, speed=0.3 → 1.8s source window
      clip({ src: "/v.mp4", start: 100, end: 101.8, speed: 0.3 }),
    ])]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    // 1/0.3 = 3.3333
    expect(f).toContain("setpts=3.3333*(PTS-STARTPTS)");
    expect(f).not.toContain("setpts=PTS-STARTPTS,");  // no plain setpts at speed≠1
  });

  it("slow-motion: speed=1 keeps the plain setpts (no slowdown)", () => {
    const tl = timeline([videoTrack([clip({ src: "/v.mp4", start: 0, end: 6 })])]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    expect(f).toContain("setpts=PTS-STARTPTS,");  // plain
    expect(f).not.toMatch(/setpts=\d/);             // no numeric multiplier
  });

  it("slow-motion: 5 clips × 1.8s source × speed 0.3 → total 30s on timeline (no transition)", () => {
    const tl = timeline([videoTrack([
      clip({ id: "c1", src: "/v.mp4", start: 100,  end: 101.8, speed: 0.3 }),
      clip({ id: "c2", src: "/v.mp4", start: 200,  end: 201.8, speed: 0.3, timelineStart: 6 }),
      clip({ id: "c3", src: "/v.mp4", start: 300,  end: 301.8, speed: 0.3, timelineStart: 12 }),
      clip({ id: "c4", src: "/v.mp4", start: 400,  end: 401.8, speed: 0.3, timelineStart: 18 }),
      clip({ id: "c5", src: "/v.mp4", start: 500,  end: 501.8, speed: 0.3, timelineStart: 24 }),
    ])]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", withTrans("none")));
    // 5 clips × (1.8 / 0.3 = 6) on-timeline = 30.000 s
    // (Audio chain still emits its trim because we may still have an
    //  audio track or audio-clip elsewhere; this scenario has no audio
    //  tracks so atrim is skipped — but if there were one it'd be 30s.)
    expect(f).toContain("[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[outv]");
  });

  it("slow-motion + audio track: atrim/apad uses 30s on-timeline duration (concat)", () => {
    const tl = timeline([
      videoTrack([
        clip({ id: "c1", src: "/v.mp4", start: 100,  end: 101.8, speed: 0.3 }),
        clip({ id: "c2", src: "/v.mp4", start: 200,  end: 201.8, speed: 0.3, timelineStart: 6 }),
        clip({ id: "c3", src: "/v.mp4", start: 300,  end: 301.8, speed: 0.3, timelineStart: 12 }),
        clip({ id: "c4", src: "/v.mp4", start: 400,  end: 401.8, speed: 0.3, timelineStart: 18 }),
        clip({ id: "c5", src: "/v.mp4", start: 500,  end: 501.8, speed: 0.3, timelineStart: 24 }),
      ]),
      audioTrack([clip({ src: "/bgm.mp3", start: 0, end: 7800 })]),
    ]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", withTrans("none")));
    // Audio is trimmed/padded to exactly 30s — proves the timeline total
    // is computed correctly with slow-motion factored in.
    expect(f).toContain("atrim=0:30.000,apad=whole_dur=30.000");
  });

  it("slow-motion + xfade: 5 clips × 6s on-timeline minus 4×1.7s transitions → 23.2s", () => {
    const tl = timeline([
      videoTrack([
        clip({ id: "c1", src: "/v.mp4", start: 100,  end: 101.8, speed: 0.3 }),
        clip({ id: "c2", src: "/v.mp4", start: 200,  end: 201.8, speed: 0.3, timelineStart: 6 }),
        clip({ id: "c3", src: "/v.mp4", start: 300,  end: 301.8, speed: 0.3, timelineStart: 12 }),
        clip({ id: "c4", src: "/v.mp4", start: 400,  end: 401.8, speed: 0.3, timelineStart: 18 }),
        clip({ id: "c5", src: "/v.mp4", start: 500,  end: 501.8, speed: 0.3, timelineStart: 24 }),
      ]),
      audioTrack([clip({ src: "/bgm.mp3", start: 0, end: 7800 })]),
    ]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", withTrans("fadeblack", 1.7)));
    // First xfade offset = 6 - 1.7 = 4.300
    expect(f).toContain("[v0][v1]xfade=transition=fadeblack:duration=1.7:offset=4.300[xv1]");
    // 5 × 6 = 30, minus 4 × 1.7 = 6.8 → 23.200 final
    expect(f).toContain("atrim=0:23.200,apad=whole_dur=23.200");
  });

  it("slow-motion: video-clip audio is dropped when speed != 1 (atempo chain skipped)", () => {
    const tl = timeline([videoTrack([
      clip({ src: "/v.mp4", start: 0, end: 1.8, speed: 0.3 }),
    ])]);
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS, [
      { id: "m1", name: "v.mp4", src: "/v.mp4", duration: 100, hasVideo: true, hasAudio: true },
    ]));
    // No video-clip audio chain emitted for slowed clip.
    expect(f).not.toContain("[0:a]asetpts");
    expect(f).not.toContain("[va0]");
  });

  it("transition duration is honoured in the offset calculation", () => {
    const tl = timeline([
      videoTrack([
        clip({ src: "/v1.mp4", start: 0, end: 5 }),
        clip({ src: "/v2.mp4", start: 0, end: 5, timelineStart: 5 }),
      ]),
    ]);
    const args = buildFFmpegCommand(tl, "/out.mp4", withTrans("fade", 0.5));
    const f = getFilter(args);
    // 5 - 0.5 = 4.500
    expect(f).toContain("xfade=transition=fade:duration=0.5:offset=4.500[outv]");
  });
});

describe("estimateExportDuration", () => {
  const mkTl = (clips: Clip[], muted = false): Timeline => ({
    tracks: [{ id: "vt", type: "video", clips, muted, locked: false, hidden: false }],
    duration: 0,
  });

  it("returns 0 for an empty timeline (no baseline for the progress bar)", () => {
    expect(estimateExportDuration({ tracks: [], duration: 0 })).toBe(0);
  });

  it("returns 0 when the only video track is muted (excluded by ffmpeg)", () => {
    const tl = mkTl([clip({ start: 0, end: 5 })], true);
    expect(estimateExportDuration(tl)).toBe(0);
  });

  it("sums on-timeline durations across clips", () => {
    const tl = mkTl([
      clip({ start: 0, end: 4 }),                   // 4 s
      clip({ start: 0, end: 6, timelineStart: 4 }), // 6 s
    ]);
    expect(estimateExportDuration(tl)).toBeCloseTo(10, 5);
  });

  it("honours speed: a 1.8s source at speed 0.3 occupies 6s", () => {
    const tl = mkTl([clip({ start: 0, end: 1.8, speed: 0.3 })]);
    expect(estimateExportDuration(tl)).toBeCloseTo(6, 5);
  });

  it("subtracts (N-1)·td when xfade is on (matches user's 30s-from-36.8s case)", () => {
    const tl = mkTl([
      clip({ start: 0, end: 1.8, speed: 0.3 }),                       // 6 s on-timeline
      clip({ start: 0, end: 1.8, speed: 0.3, timelineStart: 6 }),
      clip({ start: 0, end: 1.8, speed: 0.3, timelineStart: 12 }),
      clip({ start: 0, end: 1.8, speed: 0.3, timelineStart: 18 }),
      clip({ start: 0, end: 1.8, speed: 0.3, timelineStart: 24 }),
    ]);
    const settings = { ...SETTINGS, transitionType: "fadeblack" as const, transitionDuration: 1.7 };
    // 5 × 6 = 30, minus 4 × 1.7 = 6.8 → 23.2
    expect(estimateExportDuration(tl, settings)).toBeCloseTo(23.2, 3);
  });

  it("ignores xfade when transitionType is none, even for many clips", () => {
    const tl = mkTl([
      clip({ start: 0, end: 5 }),
      clip({ start: 0, end: 5, timelineStart: 5 }),
    ]);
    expect(estimateExportDuration(tl, SETTINGS)).toBeCloseTo(10, 5);
  });
});

describe("buildCaptionFilter", () => {
  it("returns empty for missing or whitespace-only text", () => {
    expect(buildCaptionFilter(undefined, 0, 1920, 1080)).toBe("");
    expect(buildCaptionFilter("", 0, 1920, 1080)).toBe("");
    expect(buildCaptionFilter("   \n\t", 0, 1920, 1080)).toBe("");
  });

  it("emits a drawtext filter with the caption text quoted and styled", () => {
    const f = buildCaptionFilter("山高路远", 0, 1920, 1080);
    expect(f).toContain("drawtext=fontfile=/System/Library/Fonts/PingFang.ttc");
    expect(f).toContain("text='山高路远'");
    expect(f).toContain("fontcolor=#FFD700");           // style 0 → 金色
    expect(f).toContain("y=h-text_h-86");                // bottom margin (1080 * 0.08)
    expect(f).toContain("fontsize=60");                  // 1080 / 18
  });

  it("style 4 (红色, 顶部) puts the y at the top margin", () => {
    const f = buildCaptionFilter("提示", 4, 1920, 1080);
    expect(f).toContain("fontcolor=#FF4040");
    expect(f).toContain("y=86");                          // top, no h-text_h offset
  });

  it("escapes characters that are special inside a drawtext literal", () => {
    const f = buildCaptionFilter("don't 50%\\path", 1, 1920, 1080);
    // ' → \', % → \%, \ → \\
    expect(f).toContain("text='don\\'t 50\\%\\\\path'");
  });

  it("collapses newlines so they don't show as escape sequences", () => {
    const f = buildCaptionFilter("line one\nline two", 0, 1920, 1080);
    expect(f).toContain("text='line one line two'");
    expect(f).not.toContain("\\n");
  });

  it("inserts the drawtext into the per-clip filter chain when text is set", () => {
    const tl: Timeline = {
      tracks: [{
        id: "vt",
        type: "video",
        clips: [{
          id: "c1",
          src: "/v.mp4",
          start: 0,
          end: 5,
          timelineStart: 0,
          name: "stage 1",
          text: "你好世界",
          textStyle: 2,
        }],
        muted: false,
        locked: false,
        hidden: false,
      }],
      duration: 5,
    };
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    expect(f).toContain("format=yuv420p,drawtext=");
    expect(f).toContain("text='你好世界'");
    expect(f).toContain("fontcolor=#00FFFF");           // style 2 → 青色
  });

  it("clips without text get NO drawtext segment", () => {
    const tl: Timeline = {
      tracks: [{
        id: "vt",
        type: "video",
        clips: [{
          id: "c1",
          src: "/v.mp4",
          start: 0,
          end: 5,
          timelineStart: 0,
          name: "no caption",
        }],
        muted: false,
        locked: false,
        hidden: false,
      }],
      duration: 5,
    };
    const f = getFilter(buildFFmpegCommand(tl, "/out.mp4", SETTINGS));
    expect(f).not.toContain("drawtext=");
  });
});
