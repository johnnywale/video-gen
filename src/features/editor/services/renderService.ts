import { Timeline, ProjectSettings, MediaFile } from "@/domain/timeline/models";
import { buildFFmpegCommand } from "@/domain/renderer/ffmpegGraph";
import { executeFFmpeg } from "@/infrastructure/ffmpeg/ffmpegService";

export async function renderProject(
  timeline: Timeline,
  outputPath: string,
  settings?: ProjectSettings,
  mediaFiles: MediaFile[] = []
): Promise<void> {
  const command = buildFFmpegCommand(timeline, outputPath, settings, mediaFiles);
  console.log("[renderProject] transition:", settings?.transitionType ?? "none",
    settings?.transitionType !== "none" ? `dur=${settings?.transitionDuration ?? 1}` : "");
  console.log("[renderProject] ffmpeg command:", command.join(" "));
  return executeFFmpeg(command);
}
