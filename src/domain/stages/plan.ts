import { MediaFile, Clip } from "../timeline/models";

export interface Stage {
  id: string;
  /** Source-time in seconds where this stage starts. */
  sourceTime: number;
  /** Output (on-timeline) duration in seconds. With speed != 1, the source
   *  span actually consumed is `length * speed`. */
  length: number;
  /** Optional pre-fetched preview thumbnail (base64 data URL). */
  thumbnail?: string;
  /** Optional text — used as on-screen caption and TTS source at export. */
  text?: string;
  /** Playback speed multiplier. 1 = normal, 0.5 = 2× slow. Default 1. */
  speed?: number;
  /** Index into the export-time text overlay style table. Default 0. */
  textStyle?: number;
}

export interface StagePlan {
  mediaFileId: string;
  stages: Stage[];
  /** Voice identifier for TTS (MiniMax voice_id or similar). */
  voiceId?: string;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `stg_${Math.random().toString(36).slice(2)}_${Date.now()}`;

/** Pick a random source timestamp such that [t, t+length] fits inside the media. */
export function pickRandomTimestamp(
  mediaDuration: number,
  stageLength: number,
  rng: () => number = Math.random
): number {
  const max = Math.max(0, mediaDuration - stageLength);
  return rng() * max;
}

/**
 * Generate `count` stages of equal length covering `totalDuration` seconds of
 * output. Each stage's source timestamp is randomly chosen so the source
 * window (length × speed) fits inside the media.
 *
 * `defaults.speed` seeds each stage's playback speed. Default 1 (normal
 * speed). For a cinematic-montage feel that matches `video_maker.py`,
 * pass something like 0.3 (≈3.3× slow).
 *
 * If the media is shorter than the source window, stages are clamped to
 * start at 0 (the result may be shorter than requested).
 */
export function generateRandomStages(
  media: Pick<MediaFile, "id" | "duration">,
  totalDuration: number,
  count: number,
  rng: () => number = Math.random,
  defaults?: { speed?: number }
): StagePlan {
  if (count <= 0 || totalDuration <= 0 || media.duration <= 0) {
    return { mediaFileId: media.id, stages: [] };
  }
  const length = totalDuration / count;
  const speed = defaults?.speed ?? 1;
  const sourceWindow = length * speed; // seconds of source consumed per stage
  const stages: Stage[] = [];
  for (let i = 0; i < count; i++) {
    const stage: Stage = {
      id: newId(),
      sourceTime: pickRandomTimestamp(media.duration, sourceWindow, rng),
      length,
    };
    if (speed !== 1) stage.speed = speed;
    stages.push(stage);
  }
  return { mediaFileId: media.id, stages };
}

/** Replace one stage's sourceTime with a new random pick. */
export function rerollStage(
  plan: StagePlan,
  stageId: string,
  mediaDuration: number,
  rng: () => number = Math.random
): StagePlan {
  return {
    ...plan,
    stages: plan.stages.map((s) => {
      if (s.id !== stageId) return s;
      // Source window honours the stage's current speed (so the random
      // window doesn't extend past the source when speed > 1).
      const sourceWindow = s.length * (s.speed ?? 1);
      return {
        ...s,
        sourceTime: pickRandomTimestamp(mediaDuration, sourceWindow, rng),
        thumbnail: undefined,
      };
    }),
  };
}

/** Update one stage's fields. Text/speed/style changes don't invalidate the thumbnail. */
export function updateStage(
  plan: StagePlan,
  stageId: string,
  patch: Partial<Pick<Stage, "sourceTime" | "length" | "thumbnail" | "text" | "speed" | "textStyle">>
): StagePlan {
  return {
    ...plan,
    stages: plan.stages.map((s) => {
      if (s.id !== stageId) return s;
      const next = { ...s, ...patch };
      // If sourceTime or length changed, the existing thumbnail is stale —
      // unless the caller is *setting* a thumbnail explicitly.
      const editedTimingOnly =
        ("sourceTime" in patch || "length" in patch) && !("thumbnail" in patch);
      if (editedTimingOnly) next.thumbnail = undefined;
      return next;
    }),
  };
}

/**
 * Convert a stage plan to a list of timeline clips (without IDs — addClip
 * assigns those). Clips are placed back-to-back starting at `placeStart`.
 */
export function planToClips(
  plan: StagePlan,
  media: Pick<MediaFile, "src">,
  placeStart: number = 0
): Omit<Clip, "id">[] {
  let cursor = placeStart;
  const out: Omit<Clip, "id">[] = [];
  for (const s of plan.stages) {
    if (s.length <= 0) continue;
    const speed = s.speed ?? 1;
    // Source seconds consumed by this stage = on-timeline length × speed.
    // (Speed < 1 means slow motion: a 6 s on-timeline stage at speed 0.5
    // takes only 3 s of source and stretches it to 6 s of output.)
    const sourceLen = s.length * speed;
    out.push({
      src: media.src,
      start: s.sourceTime,
      end: s.sourceTime + sourceLen,
      timelineStart: cursor,
      name: `Stage ${out.length + 1}`,
      ...(s.text ? { text: s.text } : {}),
      ...(s.speed !== undefined && s.speed !== 1 ? { speed: s.speed } : {}),
      ...(s.textStyle !== undefined ? { textStyle: s.textStyle } : {}),
    });
    cursor += s.length;
  }
  return out;
}

/** Sum of all stage lengths — the total output duration. */
export function totalPlanDuration(plan: StagePlan): number {
  return plan.stages.reduce((sum, s) => sum + Math.max(0, s.length), 0);
}
