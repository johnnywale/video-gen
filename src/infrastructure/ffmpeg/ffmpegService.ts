import { renderVideo } from "../tauri/commands";

/**
 * Executes an ffmpeg command via Tauri.
 * args[0] is "ffmpeg", rest are the CLI arguments.
 */
export async function executeFFmpeg(args: string[]): Promise<void> {
  // Strip the leading "ffmpeg" binary name — Tauri side knows the binary path
  const commandArgs = args[0] === "ffmpeg" ? args.slice(1) : args;
  return renderVideo(commandArgs);
}
