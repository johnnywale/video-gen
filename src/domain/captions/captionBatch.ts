/**
 * A captions batch is the output of one "✨ AI 生成文字" run: N short
 * lines for a given topic + voice. Persisting these lets the user
 * re-load a previous run instead of re-spending an API call, and lets
 * AutoStage pre-fill from a random saved batch when the modal opens.
 */

export interface CaptionBatch {
  id: string;
  /** The topic theme used to generate this batch. */
  topic: string;
  /** Voice id paired with these captions (the cache key for TTS). */
  voiceId: string;
  /** N caption lines, in stage order. */
  captions: string[];
  /** Unix ms timestamp when generated. */
  createdAt: number;
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cap_${Math.random().toString(36).slice(2)}_${Date.now()}`;

/** Hard cap so an unattended user doesn't blow up localStorage. Oldest entries
 *  drop first. */
export const MAX_BATCHES = 100;

export function makeBatch(input: {
  topic: string;
  voiceId: string;
  captions: string[];
}): CaptionBatch {
  return {
    id: newId(),
    topic: input.topic,
    voiceId: input.voiceId,
    captions: [...input.captions],
    createdAt: Date.now(),
  };
}

/** Newest-first append, with oldest dropped past MAX_BATCHES. */
export function addBatch(list: CaptionBatch[], batch: CaptionBatch): CaptionBatch[] {
  const next = [batch, ...list];
  if (next.length > MAX_BATCHES) next.length = MAX_BATCHES;
  return next;
}

export function removeBatch(list: CaptionBatch[], id: string): CaptionBatch[] {
  return list.filter((b) => b.id !== id);
}

/** Pick a uniformly random entry. Returns null if the list is empty. */
export function pickRandomBatch(
  list: CaptionBatch[],
  rng: () => number = Math.random
): CaptionBatch | null {
  if (list.length === 0) return null;
  const i = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[i];
}
