import { aiGenerateSpeech } from "@/infrastructure/tauri/commands";
import {
  lookupSpeechCache,
  recordSpeechCache,
} from "@/infrastructure/storage/speechCacheStorage";

interface GenerateOpts {
  apiKey: string;
  baseUrl: string;
  /** When true, skip the cache and call the API even if a hit exists. Used
   *  by "重新生成" to deliberately replace stale audio. */
  force?: boolean;
  /** User-chosen on-disk directory for the resulting mp3. Empty / undefined
   *  → backend uses its default app-local-data dir. */
  cacheDir?: string;
}

/**
 * Resolve a (text, voiceId) pair to a local mp3 file path. The cache is
 * consulted first; on miss (or `force`) we hit MiniMax via the Rust
 * backend, then record the resulting path.
 *
 * Returned tuple: `[filePath, fromCache]` so callers can adjust UI (e.g.
 * skip the loading spinner on cache hits).
 */
export async function getOrGenerateSpeech(
  text: string,
  voiceId: string,
  opts: GenerateOpts
): Promise<{ filePath: string; fromCache: boolean }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("文字为空");
  if (!voiceId.trim()) throw new Error("voice_id 为空");

  if (!opts.force) {
    const hit = lookupSpeechCache(voiceId, trimmed);
    if (hit) return { filePath: hit, fromCache: true };
  }

  const filePath = await aiGenerateSpeech(
    trimmed,
    voiceId,
    opts.apiKey,
    opts.baseUrl,
    opts.cacheDir
  );
  recordSpeechCache(voiceId, trimmed, filePath);
  return { filePath, fromCache: false };
}

/** Pure cache lookup — does not generate. UI can use this to know whether
 *  a 试听 button should be enabled before any API call. */
export function peekCachedSpeech(text: string, voiceId: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || !voiceId.trim()) return null;
  return lookupSpeechCache(voiceId, trimmed);
}
