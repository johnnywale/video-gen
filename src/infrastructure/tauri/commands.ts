import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Convert a local file path to a URL the webview can load.
 *
 * NOTE: kept for callers that don't need media playback. For `<video>` /
 * `<audio>` use `getMediaUrl()` — WKWebView does not handle the asset://
 * protocol reliably for media (range requests fail, MEDIA_ERR_SRC_NOT_SUPPORTED).
 */
export function assetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

/** URL to the local HTTP media server. Use this for `<video>`/`<audio>` src. */
export function getMediaUrl(filePath: string): Promise<string> {
  return invoke<string>("get_media_url", { filePath });
}

export function renderVideo(command: string[]): Promise<void> {
  return invoke("render_video", { command });
}

/** Native file picker — returns array of file paths */
export function openFilePicker(multiple: boolean = true): Promise<string[]> {
  return invoke("open_file_picker", { multiple });
}

/** Native save dialog — returns the chosen path or null if user cancelled. */
export function saveFilePicker(opts?: { defaultPath?: string; defaultName?: string }): Promise<string | null> {
  return invoke("save_file_picker", { defaultPath: opts?.defaultPath, defaultName: opts?.defaultName });
}

/** Open a file or folder with the OS default handler. */
export function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}

export function getDefaultOutputPath(): Promise<string> {
  return invoke("get_default_output_path");
}

export interface MediaInfo {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function probeMedia(filePath: string): Promise<MediaInfo> {
  return invoke("probe_media", { filePath });
}

/** Extract thumbnail frames via backend ffmpeg. Returns base64 data URLs. */
export function extractThumbnails(
  filePath: string,
  count: number,
  width: number,
  height: number
): Promise<string[]> {
  return invoke("extract_thumbnails", { filePath, count, width, height });
}

/** Extract one frame at each given timestamp (seconds). Returns base64 data URLs. */
export function extractFramesAtTimes(
  filePath: string,
  times: number[],
  width: number,
  height: number
): Promise<string[]> {
  return invoke("extract_frames_at_times", { filePath, times, width, height });
}

/** Call the OpenAI-compat chat completions endpoint to generate `count`
 *  short captions for the topic. Credentials come from the Settings panel.
 *  `promptTemplate` overrides the default prompt (with {topic} / {count}
 *  substitution). When omitted, the backend's default template is used. */
export function aiGenerateCaptions(
  topic: string,
  count: number,
  baseUrl: string,
  apiKey: string,
  model?: string,
  promptTemplate?: string
): Promise<string[]> {
  return invoke("ai_generate_captions", { topic, count, baseUrl, apiKey, model, promptTemplate });
}

/** Generate instrumental background music via MiniMax music_generation.
 *  Always is_instrumental=true. baseUrl selects region. Returns mp3 path. */
export function aiGenerateMusic(
  prompt: string,
  apiKey: string,
  baseUrl: string,
  durationSeconds?: number
): Promise<string> {
  return invoke("ai_generate_music", { prompt, apiKey, baseUrl, durationSeconds });
}

/** Diagnostic — sends a minimal request to MiniMax with the configured
 *  key + base URL, returns raw HTTP status + response body for debugging. */
export function aiDiagnoseMiniMax(apiKey: string, baseUrl: string): Promise<string> {
  return invoke("ai_diagnose_minimax", { apiKey, baseUrl });
}

/** Extract waveform peaks via backend ffmpeg. Returns float array 0.0-1.0. */
export function extractWaveform(
  filePath: string,
  sampleCount: number
): Promise<number[]> {
  return invoke("extract_waveform", { filePath, sampleCount });
}
