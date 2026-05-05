import { Timeline, ProjectSettings, MediaFile } from "@/domain/timeline/models";
import { buildFFmpegCommand, FontResolution } from "@/domain/renderer/ffmpegGraph";
import { executeFFmpeg } from "@/infrastructure/ffmpeg/ffmpegService";

/**
 * Rewrite media-server URLs back to absolute file paths so ffmpeg reads
 * directly from disk. Two reasons:
 *
 *   1. Cross-launch staleness: the local media server picks a random port
 *      at every launch. Anything we baked into a `clip.src` (e.g. speech
 *      mp3s on the voiceover track) keeps the *previous* run's port and
 *      ffmpeg fails with "Connection refused" on those URLs.
 *   2. The HTTP indirection is pointless for ffmpeg — the server proxies
 *      from disk anyway. Skipping it removes a moving part.
 *
 * URL shape from media_server is `http://127.0.0.1:PORT/<percent-encoded-abs-path>`,
 * so strip the host+port prefix and percent-decode whatever's left. We
 * scope the rewrite to args that look like URLs (don't touch flags or
 * non-URL strings).
 */
const LOCAL_URL_RE = /^https?:\/\/127\.0\.0\.1:\d+(?=\/)/;

export function localiseMediaServerUrls(args: string[]): string[] {
  return args.map((a) => {
    if (!LOCAL_URL_RE.test(a)) return a;
    const stripped = a.replace(LOCAL_URL_RE, "");
    try {
      return decodeURIComponent(stripped);
    } catch {
      // Malformed encoding — fall back to the raw stripped form rather
      // than crash the whole render.
      return stripped;
    }
  });
}

export async function renderProject(
  timeline: Timeline,
  outputPath: string,
  settings?: ProjectSettings,
  mediaFiles: MediaFile[] = [],
  fonts: FontResolution = {}
): Promise<void> {
  const raw = buildFFmpegCommand(timeline, outputPath, settings, mediaFiles, fonts);
  const command = localiseMediaServerUrls(raw);
  console.log("[renderProject] transition:", settings?.transitionType ?? "none",
    settings?.transitionType !== "none" ? `dur=${settings?.transitionDuration ?? 1}` : "");
  console.log("[renderProject] ffmpeg command:", command.join(" "));
  return executeFFmpeg(command);
}
