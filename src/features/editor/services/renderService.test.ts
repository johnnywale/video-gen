import { describe, it, expect } from "vitest";
import { localiseMediaServerUrls } from "./renderService";

describe("localiseMediaServerUrls", () => {
  it("rewrites a current-port media-server URL to a bare file path", () => {
    const args = [
      "-i",
      "http://127.0.0.1:57433/Users/x/Movies/test.mp4",
      "-y",
      "/out.mp4",
    ];
    expect(localiseMediaServerUrls(args)).toEqual([
      "-i",
      "/Users/x/Movies/test.mp4",
      "-y",
      "/out.mp4",
    ]);
  });

  it("rewrites a stale-port URL too — that's the whole point", () => {
    // The dead-port case from the user's bug report. ffmpeg can read the
    // file directly so the URL doesn't have to resolve.
    const out = localiseMediaServerUrls([
      "-i",
      "http://127.0.0.1:56156/var/folders/T/video-editor-media/speech_X_123.mp3",
    ]);
    expect(out[1]).toBe("/var/folders/T/video-editor-media/speech_X_123.mp3");
  });

  it("percent-decodes paths so spaces survive the round trip", () => {
    const out = localiseMediaServerUrls([
      "-i",
      "http://127.0.0.1:5000/Users/x/My%20Movies/clip%20one.mp4",
    ]);
    expect(out[1]).toBe("/Users/x/My Movies/clip one.mp4");
  });

  it("leaves non-URL args (flags, file paths, filter graphs) alone", () => {
    const args = [
      "-filter_complex",
      "[0:v]setpts=PTS-STARTPTS,scale=1920:1080[v0]",
      "-c:v",
      "libx264",
      "/already/a/path.mp4",
    ];
    expect(localiseMediaServerUrls(args)).toEqual(args);
  });

  it("does not touch non-loopback URLs (e.g. real CDNs)", () => {
    const args = ["-i", "https://example.com/asset.mp4"];
    expect(localiseMediaServerUrls(args)).toEqual(args);
  });
});
