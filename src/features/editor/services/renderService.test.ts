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

  it("strips the URL-leading slash before a Windows drive letter", () => {
    // The Windows render bug: media URL is built as
    // `http://127.0.0.1:PORT/C%3A%5CUsers%5C…mp4`. After we strip the
    // host+port and decode, we'd get `/C:\Users\…mp4` — ffmpeg refuses
    // that with "Invalid argument". The path on Windows is `C:\Users\…`,
    // no leading slash.
    const out = localiseMediaServerUrls([
      "-i",
      "http://127.0.0.1:60331/C%3A%5CUsers%5Cadminuser%5CDownloads%5Ctest.mp4",
    ]);
    expect(out[1]).toBe("C:\\Users\\adminuser\\Downloads\\test.mp4");
  });

  it("handles forward-slash Windows paths too", () => {
    // Some pipelines normalise backslashes to forward slashes before
    // passing through the URL layer. Drive-letter detection should work
    // for both.
    const out = localiseMediaServerUrls([
      "-i",
      "http://127.0.0.1:60331/C%3A/Users/adminuser/Downloads/test.mp4",
    ]);
    expect(out[1]).toBe("C:/Users/adminuser/Downloads/test.mp4");
  });

  it("strips the URL-leading slash before a UNC path", () => {
    // `\\server\share\…` arrives as `/\\server\share\…` after URL
    // stripping; drop the URL `/` so ffmpeg sees a real UNC path.
    const out = localiseMediaServerUrls([
      "-i",
      "http://127.0.0.1:60331/%5C%5Cserver%5Cshare%5Cclip.mp4",
    ]);
    expect(out[1]).toBe("\\\\server\\share\\clip.mp4");
  });
});
