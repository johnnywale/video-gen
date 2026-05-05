import { CaptionBatch } from "@/domain/captions/captionBatch";

const KEY = "video-editor-caption-batches";

export function loadCaptionBatches(): CaptionBatch[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) =>
        b &&
        typeof b.id === "string" &&
        typeof b.topic === "string" &&
        typeof b.voiceId === "string" &&
        Array.isArray(b.captions) &&
        b.captions.every((c: unknown) => typeof c === "string") &&
        typeof b.createdAt === "number"
      )
      .map((b) => ({
        id: b.id,
        topic: b.topic,
        voiceId: b.voiceId,
        captions: b.captions as string[],
        createdAt: b.createdAt,
      }));
  } catch {
    return [];
  }
}

export function saveCaptionBatches(batches: CaptionBatch[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(batches));
  } catch {
    console.warn("Failed to save caption batches to localStorage");
  }
}
