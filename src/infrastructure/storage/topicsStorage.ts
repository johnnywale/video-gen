import { Topic, DEFAULT_TOPICS } from "@/domain/topics/topic";

const KEY = "video-editor-topics";

export function loadTopics(): Topic[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_TOPICS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_TOPICS];
    // Defensive — strip unknown fields, drop malformed entries.
    return parsed
      .filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.theme === "string")
      .map((t) => {
        const out: Topic = { id: t.id, name: t.name, theme: t.theme };
        if (typeof t.prompt === "string" && t.prompt.length > 0) out.prompt = t.prompt;
        return out;
      });
  } catch {
    return [...DEFAULT_TOPICS];
  }
}

export function saveTopics(topics: Topic[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(topics));
  } catch {
    console.warn("Failed to save topics to localStorage");
  }
}
