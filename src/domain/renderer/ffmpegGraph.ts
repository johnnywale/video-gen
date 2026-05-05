import { Timeline, ProjectSettings, DEFAULT_PROJECT_SETTINGS, MediaFile } from "../timeline/models";

/**
 * Caption colours per `clip.textStyle` index. Mirrors the labels shown in
 * AutoStagePanel.tsx:
 *   0 — 金色, 1 — 白色, 2 — 青色, 3 — 白色, 4 — 红色（顶部）
 * Animation hints (typewriter / slide-in) referenced in the labels are
 * intentionally not implemented yet — colour + position is the minimum
 * for "captions appear in the export".
 */
const CAPTION_COLORS = ["#FFD700", "#FFFFFF", "#00FFFF", "#FFFFFF", "#FF4040"];

/** Default fontfile. macOS ships PingFang as the system CJK font; if the
 *  user's machine is Linux/Windows they'll see latin-only fallback unless
 *  they override. Kept here as the single point of change. */
const DEFAULT_CAPTION_FONT = "/System/Library/Fonts/PingFang.ttc";

/** Escape a caption string for ffmpeg's drawtext `text='...'` literal.
 *  Inside single-quoted filter values, only `\` and `'` are special;
 *  drawtext additionally treats `%` as a format-expression prefix. */
function escapeDrawTextLiteral(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

/** Build the `drawtext=...` segment for one clip's caption, or empty
 *  string if the clip has no text. Returns the bare filter (no leading
 *  comma) so the caller can decide whether to chain it. */
export function buildCaptionFilter(
  text: string | undefined,
  styleIdx: number | undefined,
  // _width reserved for future text-wrapping logic; positioning currently
  // only needs height (vertical margin + fontsize derivation).
  _width: number,
  height: number,
  fontFile: string = DEFAULT_CAPTION_FONT
): string {
  // drawtext doesn't render `\n`; collapse newlines so multi-line
  // captions don't end up as visible escape sequences in the output.
  const cleaned = (text ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!cleaned) return "";
  const escaped = escapeDrawTextLiteral(cleaned);
  const idx = styleIdx ?? 0;
  const color = CAPTION_COLORS[idx] ?? "#FFFFFF";
  // Style 4 (红色) sits near the top of the frame; everything else
  // bottom-aligned at ~10% from the edge.
  const margin = Math.round(height * 0.08);
  const yExpr = idx === 4 ? `${margin}` : `h-text_h-${margin}`;
  // Roughly 60 px on 1080p, scaling with output height.
  const fontSize = Math.max(20, Math.round(height / 18));
  return [
    `drawtext=fontfile=${fontFile}`,
    `text='${escaped}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `x=(w-text_w)/2`,
    `y=${yExpr}`,
    `box=1:boxcolor=black@0.45:boxborderw=12`,
    `shadowcolor=black:shadowx=2:shadowy=2`,
  ].join(":");
}

/**
 * Pick an output container that works with the chosen video codec.
 * VP9 → .webm; H.264/H.265 → .mp4. Returns the path with a corrected
 * extension when needed; passes through otherwise.
 */
export function ensureCompatibleContainer(
  outputPath: string,
  codec: ProjectSettings["codec"]
): string {
  const lower = outputPath.toLowerCase();
  const isVp9Friendly = lower.endsWith(".webm");
  const isH264Friendly =
    lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".mov") || lower.endsWith(".mkv");

  if (codec === "libvpx-vp9" && !isVp9Friendly) {
    // Replace whatever extension exists with .webm.
    return outputPath.replace(/\.[A-Za-z0-9]+$/, "") + ".webm";
  }
  if ((codec === "libx264" || codec === "libx265") && !isH264Friendly) {
    return outputPath.replace(/\.[A-Za-z0-9]+$/, "") + ".mp4";
  }
  return outputPath;
}

/**
 * Builds an ffmpeg argument list from a Timeline and project settings.
 *
 * Each clip is a separate -i input, trimmed at the input stage.
 * Video clips are scaled to project resolution. When a transition is set
 * we chain `xfade` between consecutive clips (and `acrossfade` for their
 * audio); otherwise we use the simple `concat` filter.
 *
 * `mediaFiles` (optional) lets us skip the audio filter for clips whose
 * source video has no audio stream — referencing `[N:a]` on a video-only
 * input makes ffmpeg fail the whole filter graph.
 */
/** Per-render font lookup. Maps each `clip.fontFamily` to the on-disk
 *  font file path (built by the caller from useFontsStore.fonts). The
 *  `defaultPath` is used for clips without `fontFamily`, or whose
 *  family isn't in the map. */
export interface FontResolution {
  familyToPath?: Record<string, string>;
  defaultPath?: string;
}

export function buildFFmpegCommand(
  timeline: Timeline,
  outputPath: string,
  settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS,
  mediaFiles: MediaFile[] = [],
  fonts: FontResolution = {}
): string[] {
  const { width, height, fps, codec, crf, preset, audioBitrate } = settings;
  const transitionType = settings.transitionType ?? "none";
  const transitionDuration = settings.transitionDuration ?? 1.0;
  const useXfade = transitionType !== "none";

  // Codec/container compatibility. VP9 is non-standard inside .mp4 — ffmpeg
  // will write the file, but QuickTime / iOS / most players refuse to open
  // it. Likewise H.264/H.265 don't belong in .webm. Adjust the output path
  // to match the codec rather than fighting the user's setting.
  outputPath = ensureCompatibleContainer(outputPath, codec);

  const videoTracks = timeline.tracks.filter((t) => t.type === "video" && !t.muted);
  const audioTracks = timeline.tracks.filter((t) => t.type === "audio" && !t.muted);

  const inputs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  /** Per-input video labels with their on-timeline durations (for xfade offsets). */
  const videoLabels: { label: string; duration: number }[] = [];
  const audioFromVideoLabels: string[] = [];

  for (const track of videoTracks) {
    for (const clip of track.clips) {
      inputs.push("-ss", String(clip.start), "-to", String(clip.end), "-i", clip.src);

      // Apply slow-motion. setpts multiplies frame timestamps by 1/speed so
      // a 1.8 s source clip with speed=0.3 stretches to 6 s on the output
      // timeline. Without this the export played at native speed and
      // produced a 2 s file instead of the user's intended 30 s.
      const speed = clip.speed ?? 1;
      const setptsExpr = speed !== 1 && speed > 0
        ? `setpts=${(1 / speed).toFixed(4)}*(PTS-STARTPTS)`
        : `setpts=PTS-STARTPTS`;

      // Caption is drawn AFTER scaling so font sizing matches the output
      // resolution rather than the source. Skipped (empty string) when
      // the clip has no text — keeps the filter graph minimal. Font
      // lookup: clip.fontFamily → fonts.familyToPath, then the project
      // default, then the hardcoded macOS PingFang fallback.
      const fontPath =
        (clip.fontFamily && fonts.familyToPath?.[clip.fontFamily]) ||
        fonts.defaultPath ||
        DEFAULT_CAPTION_FONT;
      const captionFilter = buildCaptionFilter(clip.text, clip.textStyle, width, height, fontPath);
      const captionChain = captionFilter ? `,${captionFilter}` : "";
      filterParts.push(
        `[${inputIndex}:v]${setptsExpr},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,` +
        `setsar=1,fps=${fps},format=yuv420p` +
        captionChain +
        `[v${inputIndex}]`
      );

      // Use ON-TIMELINE duration here (after speed adjustment), not source
      // duration — xfade offsets and the audio atrim need to know how long
      // the clip will actually be after slow-motion stretches it.
      const onTimelineDur = (clip.end - clip.start) / Math.max(0.0001, speed);
      videoLabels.push({ label: `[v${inputIndex}]`, duration: onTimelineDur });

      // Audio from video clip — only when:
      //   - the source has an audio stream (otherwise [N:a] fails)
      //   - the clip's audio is enabled
      //   - speed is 1 (atempo can't cleanly hit speeds < 0.5 without
      //     chained filters; for now the user's selected background audio
      //     covers the soundtrack on slowed clips, mirroring video_maker.py)
      const sourceHasAudio = mediaFiles.find((m) => m.src === clip.src)?.hasAudio ?? true;
      if (clip.audioEnabled !== false && sourceHasAudio && speed === 1) {
        filterParts.push(
          `[${inputIndex}:a]asetpts=PTS-STARTPTS,` +
          `aresample=44100,aformat=channel_layouts=stereo` +
          `[va${inputIndex}]`
        );
        audioFromVideoLabels.push(`[va${inputIndex}]`);
      }

      inputIndex++;
    }
  }

  const audioLabels: string[] = [];
  for (const track of audioTracks) {
    for (const clip of track.clips) {
      inputs.push("-ss", String(clip.start), "-to", String(clip.end), "-i", clip.src);
      // Honour clip.timelineStart in the export. Without `adelay`, every
      // audio-track input plays from t=0 in the amix output regardless of
      // its placement, so multiple voiceover or looped-bgm clips collapsed
      // onto each other and produced overlapping/disjointed audio.
      // adelay with `:all=1` applies the delay to every channel; we use
      // a single millisecond value (rounded) for both channels.
      const delayMs = Math.max(0, Math.round((clip.timelineStart ?? 0) * 1000));
      // Per-clip gain. Skip the filter at exactly 1 (the default) so the
      // graph stays minimal in the common case.
      const vol = clip.volume ?? 1;
      const filterChain: string[] = [`[${inputIndex}:a]asetpts=PTS-STARTPTS`];
      if (vol !== 1) filterChain.push(`volume=${vol.toFixed(3)}`);
      if (delayMs > 0) filterChain.push(`adelay=${delayMs}:all=1`);
      filterParts.push(`${filterChain.join(",")}[a${inputIndex}]`);
      audioLabels.push(`[a${inputIndex}]`);
      inputIndex++;
    }
  }

  // Combine all audio sources
  // When xfade is active, video-clip audio gets crossfaded into a single
  // [outva] stream first; that stream is then amix'd with the audio-track
  // clips alongside.
  const allAudioLabels: string[] = [];

  // No clips at all
  if (videoLabels.length === 0 && audioFromVideoLabels.length === 0 && audioLabels.length === 0) {
    return ["ffmpeg", "-f", "lavfi", "-i", `color=black:s=${width}x${height}:d=0.1`, "-frames:v", "1", "-y", outputPath];
  }

  // ── Video output ─────────────────────────────────────────────────────
  // We track the precise output duration so audio can be trimmed/padded
  // to match exactly. concat sums the inputs; xfade subtracts one
  // transition window per join.
  let videoOutDuration: number | undefined;
  if (videoLabels.length > 0) {
    if (useXfade && videoLabels.length >= 2) {
      const td = transitionDuration;
      let cumDur = videoLabels[0].duration;
      let prev = videoLabels[0].label;
      for (let i = 1; i < videoLabels.length; i++) {
        const isLast = i === videoLabels.length - 1;
        const next = isLast ? "[outv]" : `[xv${i}]`;
        const offset = Math.max(0, cumDur - td);
        filterParts.push(
          `${prev}${videoLabels[i].label}xfade=transition=${transitionType}:duration=${td}:offset=${offset.toFixed(3)}${next}`
        );
        cumDur += videoLabels[i].duration - td;
        prev = next;
      }
      videoOutDuration = cumDur;
    } else {
      filterParts.push(
        `${videoLabels.map((v) => v.label).join("")}concat=n=${videoLabels.length}:v=1:a=0[outv]`
      );
      videoOutDuration = videoLabels.reduce((sum, v) => sum + v.duration, 0);
    }
  }

  // ── Audio output ─────────────────────────────────────────────────────
  // First, chain video-clip audio with acrossfade when xfade is active
  // (mirrors the Python `concat_clips` audio logic).
  if (useXfade && audioFromVideoLabels.length >= 2) {
    let prev = audioFromVideoLabels[0];
    for (let i = 1; i < audioFromVideoLabels.length; i++) {
      const isLast = i === audioFromVideoLabels.length - 1;
      const next = isLast ? "[outva]" : `[xa${i}]`;
      filterParts.push(
        `${prev}${audioFromVideoLabels[i]}acrossfade=d=${transitionDuration}${next}`
      );
      prev = next;
    }
    allAudioLabels.push("[outva]");
  } else {
    allAudioLabels.push(...audioFromVideoLabels);
  }
  allAudioLabels.push(...audioLabels);

  if (allAudioLabels.length > 0) {
    // First combine into [outa_mix].
    if (allAudioLabels.length === 1) {
      const label = allAudioLabels[0];
      const innerName = label.slice(1, -1);
      filterParts.push(`[${innerName}]acopy[outa_mix]`);
    } else {
      filterParts.push(
        `${allAudioLabels.join("")}amix=inputs=${allAudioLabels.length}[outa_mix]`
      );
    }

    // Then trim/pad to the video's exact duration so audio doesn't run
    // past video end (and silence fills any short audio).
    if (videoOutDuration !== undefined && videoOutDuration > 0) {
      const dur = videoOutDuration.toFixed(3);
      filterParts.push(
        `[outa_mix]atrim=0:${dur},apad=whole_dur=${dur},asetpts=PTS-STARTPTS[outa]`
      );
    } else {
      filterParts.push(`[outa_mix]anull[outa]`);
    }
  }

  const args: string[] = [...inputs];

  if (filterParts.length > 0) {
    args.push("-filter_complex", filterParts.join("; "));
  }

  if (videoLabels.length > 0) args.push("-map", "[outv]");
  if (allAudioLabels.length > 0) args.push("-map", "[outa]");

  // -pix_fmt yuv420p: required for QuickTime / iOS / many web players.
  // -movflags +faststart: writes the moov atom at the front of the file
  //   so players can start playing before the whole download finishes
  //   AND so partially-finalized files still open. Without these, the
  //   output mp4 looks valid to ffmpeg but won't open in macOS QuickTime.
  args.push(
    "-r", String(fps),
    "-c:v", codec,
    "-crf", String(crf),
    "-preset", preset,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", audioBitrate,
    "-ar", "44100",
    "-movflags", "+faststart",
    "-y", outputPath
  );

  return ["ffmpeg", ...args];
}

/**
 * Predict the export's wall-clock duration so the UI can compute a smooth
 * progress bar from ffmpeg's `time=…` stderr ticks. Mirrors the
 * `videoOutDuration` math in `buildFFmpegCommand`:
 *
 *   sum over visible video clips of (end-start)/speed,
 *   minus (N-1) × td when xfade is active and N >= 2.
 *
 * Returns 0 when the timeline has no video — in that case progress will
 * just show 0% and snap to 100% on render_complete (no good baseline to
 * derive from for audio-only exports).
 */
export function estimateExportDuration(
  timeline: Timeline,
  settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS
): number {
  let onTimelineSum = 0;
  let clipCount = 0;
  for (const track of timeline.tracks) {
    if (track.type !== "video" || track.muted) continue;
    for (const clip of track.clips) {
      const speed = clip.speed ?? 1;
      onTimelineSum += (clip.end - clip.start) / Math.max(0.0001, speed);
      clipCount += 1;
    }
  }
  if (clipCount === 0) return 0;
  const useXfade = (settings.transitionType ?? "none") !== "none" && clipCount >= 2;
  const td = settings.transitionDuration ?? 1.0;
  const out = useXfade ? onTimelineSum - (clipCount - 1) * td : onTimelineSum;
  return Math.max(0, out);
}
