/**
 * Waveform extraction — delegates to Rust backend via ffmpeg.
 * Cached in IndexedDB for persistence across reloads.
 */

import { getCacheEntry, setCacheEntry, removeCacheEntry } from "@/infrastructure/storage/cacheStorage";
import { extractWaveform } from "@/infrastructure/tauri/commands";

export interface WaveformData {
  peaks: Float32Array;
  duration: number;
  peaksPerSecond: number;
}

interface WaveformCache {
  peaks: number[];
  duration: number;
  peaksPerSecond: number;
}

type Callback = () => void;
const memCache = new Map<string, WaveformData>();
const pending = new Set<string>();
const listeners = new Map<string, Set<Callback>>();

export function subscribe(src: string, cb: Callback): () => void {
  if (!listeners.has(src)) listeners.set(src, new Set());
  listeners.get(src)!.add(cb);
  return () => { listeners.get(src)?.delete(cb); };
}

export function getCached(src: string): WaveformData | null {
  return memCache.get(src) ?? null;
}

export function getOrGenerate(
  src: string,
  mediaId?: string,
  filePath?: string,
  duration?: number
): WaveformData | null {
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
  if (mediaId) removeCacheEntry(`wave:${mediaId}`);
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
  // Try IndexedDB cache
  if (mediaId) {
    const cached = await getCacheEntry<WaveformCache>(`wave:${mediaId}`);
    if (cached && cached.peaks.length > 0 && cached.peaksPerSecond > 0) {
      memCache.set(src, {
        peaks: new Float32Array(cached.peaks),
        duration: cached.duration,
        peaksPerSecond: cached.peaksPerSecond,
      });
      notify(src);
      return;
    }
  }

  // Generate via Rust backend
  try {
    const sampleCount = 500;
    const rawPeaks = await extractWaveform(filePath, sampleCount);
    if (rawPeaks.length > 0) {
      const data: WaveformData = {
        peaks: new Float32Array(rawPeaks),
        duration,
        peaksPerSecond: rawPeaks.length / duration,
      };
      memCache.set(src, data);
      if (mediaId) {
        await setCacheEntry<WaveformCache>(`wave:${mediaId}`, {
          peaks: Array.from(data.peaks),
          duration: data.duration,
          peaksPerSecond: data.peaksPerSecond,
        });
      }
    }
  } catch (e) {
    console.warn("Waveform extraction failed:", e);
  }
  notify(src);
}
