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

/** Generate `count` short captions for the topic via the LiteLLM proxy's
 *  chat-completions endpoint (proxy URL is hard-coded in the backend).
 *  `promptTemplate` overrides the default prompt (with {topic} / {count}
 *  substitution). When omitted, the backend's default template is used. */
export function aiGenerateCaptions(
  topic: string,
  count: number,
  apiKey: string,
  model?: string,
  promptTemplate?: string
): Promise<string[]> {
  return invoke("ai_generate_captions", { topic, count, apiKey, model, promptTemplate });
}

/** Generate instrumental background music via the LiteLLM proxy's
 *  /v1/music_generation pass-through. Always is_instrumental=true.
 *  Returns the saved mp3 path. */
export function aiGenerateMusic(
  prompt: string,
  apiKey: string,
  durationSeconds?: number
): Promise<string> {
  return invoke("ai_generate_music", { prompt, apiKey, durationSeconds });
}

/** Structured failure from `ai_generate_speech`. The promise rejects with
 *  this object when the backend returns Err — surface it directly in a
 *  debug panel so the user sees what was sent and what came back. */
export interface SpeechError {
  message: string;
  endpoint: string;
  request_body: string;
  status: number | null;
  response_body: string | null;
}

export function isSpeechError(e: unknown): e is SpeechError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as SpeechError).message === "string" &&
    typeof (e as SpeechError).endpoint === "string" &&
    typeof (e as SpeechError).request_body === "string"
  );
}

/** Generate TTS audio for a single line via the LiteLLM proxy's
 *  /v1/audio/speech endpoint (OpenAI-compat). Returns the saved mp3 file
 *  path. Rejects with `SpeechError` (request/response bodies attached).
 *  Caller should cache by (text, voiceId).
 *
 *  `cacheDir` overrides where the backend writes the mp3. When empty /
 *  undefined the backend falls back to its default app-local-data dir. */
export function aiGenerateSpeech(
  text: string,
  voiceId: string,
  apiKey: string,
  cacheDir?: string
): Promise<string> {
  return invoke("ai_generate_speech", { text, voiceId, apiKey, cacheDir });
}

/** Resolve the default speech-cache directory the backend would use when
 *  the user hasn't picked one. Surfaced in the Settings panel as a hint. */
export function defaultSpeechCacheDir(): Promise<string> {
  return invoke("default_speech_cache_dir");
}

/** Diagnostic — sends a minimal request to the LiteLLM proxy with the
 *  configured key, returns raw HTTP status + response body for debugging. */
export function aiDiagnoseMiniMax(apiKey: string): Promise<string> {
  return invoke("ai_diagnose_minimax", { apiKey });
}

/** Extract waveform peaks via backend ffmpeg. Returns float array 0.0-1.0. */
export function extractWaveform(
  filePath: string,
  sampleCount: number
): Promise<number[]> {
  return invoke("extract_waveform", { filePath, sampleCount });
}

/** Metadata for one installed font, returned by `list_system_fonts`. */
export interface FontInfo {
  family: string;
  postscript_name: string;
  /** Absolute path on disk — passed to ffmpeg's `drawtext=fontfile=…`. */
  path: string;
  /** Face index within the file (.ttc collections have many). ffmpeg's
   *  drawtext only ever uses face 0, so faces with `face_index > 0`
   *  won't render as the family suggests; UI warns about these. */
  face_index: number;
  /** True if the font's cmap covers all of the simplified-Chinese-
   *  specific probe codepoints (你, 问, 时, 负). Lenient single-codepoint
   *  probes failed in the wild — Traditional / Japanese fonts pass
   *  for 你 but render tofu boxes for 问/时/负. */
  supports_cjk: boolean;
}

/** Enumerate installed fonts (deduped by file path, CJK-capable first). */
export function listSystemFonts(): Promise<FontInfo[]> {
  return invoke("list_system_fonts");
}
