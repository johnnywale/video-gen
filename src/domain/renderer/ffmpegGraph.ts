import { Timeline, ProjectSettings, DEFAULT_PROJECT_SETTINGS, MediaFile } from "../timeline/models";

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
export function buildFFmpegCommand(
  timeline: Timeline,
  outputPath: string,
  settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS,
  mediaFiles: MediaFile[] = []
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

      filterParts.push(
        `[${inputIndex}:v]${setptsExpr},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,` +
        `setsar=1,fps=${fps},format=yuv420p` +
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
      filterParts.push(`[${inputIndex}:a]asetpts=PTS-STARTPTS[a${inputIndex}]`);
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
