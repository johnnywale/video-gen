/**
 * Thumbnail extraction — delegates to Rust backend via ffmpeg.
 * Cached in IndexedDB for persistence across reloads.
 */

import { getCacheEntry, setCacheEntry, removeCacheEntry } from "@/infrastructure/storage/cacheStorage";
import { extractThumbnails } from "@/infrastructure/tauri/commands";

export interface ThumbnailStrip {
  dataUrls: string[];
  frameInterval: number;
  sourceDuration: number;
}

type Callback = () => void;
const memCache = new Map<string, ThumbnailStrip>();
const pending = new Set<string>();
const listeners = new Map<string, Set<Callback>>();

export function subscribe(src: string, cb: Callback): () => void {
  if (!listeners.has(src)) listeners.set(src, new Set());
  listeners.get(src)!.add(cb);
  return () => { listeners.get(src)?.delete(cb); };
}

export function getCached(src: string): ThumbnailStrip | null {
  return memCache.get(src) ?? null;
}

export function getOrGenerate(
  src: string,
  mediaId?: string,
  filePath?: string,
  duration?: number
): ThumbnailStrip | null {
  if (memCache.has(src)) return memCache.get(src)!;
  if (!pending.has(src) && filePath && duration && duration > 0) {
    pending.add(src);
    loadOrGenerate(src, filePath, duration, mediaId).finally(() => pending.delete(src));
  }
  return null;
}

export function evict(src: string, mediaId?: string) {
  memCache.delete(src);
  listeners.delete(src);
  if (mediaId) removeCacheEntry(`thumb:${mediaId}`);
}

function notify(src: string) {
  listeners.get(src)?.forEach((cb) => cb());
}

async function loadOrGenerate(
  src: string,
  filePath: string,
  duration: number,
  mediaId?: string
) {
  // Try IndexedDB cache first
  if (mediaId) {
    const cached = await getCacheEntry<ThumbnailStrip>(`thumb:${mediaId}`);
    if (cached && cached.dataUrls.length > 0 && cached.sourceDuration > 0) {
      memCache.set(src, cached);
      notify(src);
      return;
    }
  }

  // Generate via Rust backend
  try {
    const count = 30; // max frames
    const dataUrls = await extractThumbnails(filePath, count, 114, 64);
    if (dataUrls.length > 0) {
      // The backend places frames at the middle of each segment of length
      // (duration / count). For the renderer's idx lookup `floor(srcTime /
      // frameInterval)` to map srcTime → correct frame, frameInterval =
      // duration / count.
      const strip: ThumbnailStrip = {
        dataUrls,
        frameInterval: duration / dataUrls.length,
        sourceDuration: duration,
      };
      memCache.set(src, strip);
      if (mediaId) await setCacheEntry(`thumb:${mediaId}`, strip);
    }
  } catch (e) {
    console.warn("Thumbnail extraction failed:", e);
  }
  notify(src);
}
