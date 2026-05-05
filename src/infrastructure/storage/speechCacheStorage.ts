/**
 * On-disk index for generated TTS audio. Keyed by (voiceId, text), so the
 * same line spoken by the same voice is generated once and re-used for
 * 试听 / re-add forever after — saves a paid API call every preview.
 *
 * The audio bytes themselves live as files in the OS temp dir (the backend
 * writes them); we store the resolved file path here. Files can be
 * reaped by the OS, so callers should be prepared for the path to no
 * longer exist (re-generate in that case).
 */

const KEY = "video-editor-speech-cache";

interface SpeechCacheEntry {
  /** The voice id used (MiniMax voice_id). */
  voiceId: string;
  /** The exact text generated. */
  text: string;
  /** Absolute path to the cached mp3. */
  filePath: string;
  /** Unix ms — used for soft eviction once we hit MAX_ENTRIES. */
  createdAt: number;
}

/** Hard cap so we don't grow localStorage unbounded. Oldest entries drop
 *  first when we exceed this. ~500 entries × 200 bytes = ~100 KB. */
const MAX_ENTRIES = 500;

interface CacheShape {
  entries: SpeechCacheEntry[];
}

function emptyCache(): CacheShape {
  return { entries: [] };
}

function load(): CacheShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return emptyCache();
    const entries: SpeechCacheEntry[] = parsed.entries
      .filter((e: unknown): e is SpeechCacheEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as SpeechCacheEntry).voiceId === "string" &&
        typeof (e as SpeechCacheEntry).text === "string" &&
        typeof (e as SpeechCacheEntry).filePath === "string" &&
        typeof (e as SpeechCacheEntry).createdAt === "number"
      );
    return { entries };
  } catch {
    return emptyCache();
  }
}

function save(cache: CacheShape): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    console.warn("Failed to save speech cache to localStorage");
  }
}

/** Returns the cached file path for (voiceId, text), or null if absent. */
export function lookupSpeechCache(voiceId: string, text: string): string | null {
  const cache = load();
  const hit = cache.entries.find((e) => e.voiceId === voiceId && e.text === text);
  return hit ? hit.filePath : null;
}

/** Insert (or overwrite) an entry, then evict oldest down to MAX_ENTRIES. */
export function recordSpeechCache(voiceId: string, text: string, filePath: string): void {
  const cache = load();
  const without = cache.entries.filter((e) => !(e.voiceId === voiceId && e.text === text));
  without.unshift({ voiceId, text, filePath, createdAt: Date.now() });
  if (without.length > MAX_ENTRIES) without.length = MAX_ENTRIES;
  save({ entries: without });
}

/** Drop the entry for (voiceId, text). Used when the file was missing on
 *  disk and we want to force a fresh generation next time. */
export function invalidateSpeechCache(voiceId: string, text: string): void {
  const cache = load();
  const without = cache.entries.filter((e) => !(e.voiceId === voiceId && e.text === text));
  if (without.length !== cache.entries.length) save({ entries: without });
}
