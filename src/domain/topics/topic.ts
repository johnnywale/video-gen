/**
 * A topic is a reusable AI-prompt theme. The user picks one to seed caption
 * generation in Auto Stages. Pure data model + helpers — no I/O.
 */

export interface Topic {
  id: string;
  /** Short label shown in dropdowns. */
  name: string;
  /** The actual string passed to the AI as the {topic} variable. */
  theme: string;
  /** Optional full prompt template. Supports {topic} and {count} placeholders.
   *  When absent, the backend's default template is used. */
  prompt?: string;
}

export const DEFAULT_PROMPT_TEMPLATE = [
  "请为一个「{topic}」主题短视频生成 {count} 句富有哲理的人生感悟。",
  "要求：每句 8-15 个字，意境深远，发人深省，风格多样（励志/感悟/豁达/淡然/坚韧交替）。",
  "示例风格：「山高路远，看世界也找自己」「人生如水，静而深流」",
].join("\n");

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `top_${Math.random().toString(36).slice(2)}_${Date.now()}`;

export const DEFAULT_TOPICS: Topic[] = [
  { id: newId(), name: "Highlights", theme: "精彩回顾" },
  { id: newId(), name: "Travel Diary", theme: "旅行日记" },
  { id: newId(), name: "Personal Growth", theme: "成长感悟" },
  { id: newId(), name: "Food Exploration", theme: "美食探店" },
  { id: newId(), name: "Motivational", theme: "励志格言" },
];

/** Add a topic (or update if id matches) and return a new array. */
export function upsertTopic(list: Topic[], topic: Omit<Topic, "id"> & { id?: string }): Topic[] {
  if (topic.id) {
    const exists = list.some((t) => t.id === topic.id);
    if (exists) {
      return list.map((t) => (t.id === topic.id ? { ...t, ...topic, id: t.id } : t));
    }
  }
  const id = topic.id ?? newId();
  const next: Topic = { id, name: topic.name, theme: topic.theme };
  if (topic.prompt && topic.prompt.trim()) next.prompt = topic.prompt;
  return [...list, next];
}

export function removeTopic(list: Topic[], id: string): Topic[] {
  return list.filter((t) => t.id !== id);
}

export function findTopic(list: Topic[], id: string): Topic | undefined {
  return list.find((t) => t.id === id);
}

/** Validate a topic — both fields must be non-blank. Returns null if OK,
 *  otherwise a short reason. Strings are user-facing (Chinese). */
export function validateTopic(name: string, theme: string): string | null {
  if (!name.trim()) return "请输入名称";
  if (!theme.trim()) return "请输入主题内容";
  if (name.length > 80) return "名称过长（最多 80 字符）";
  if (theme.length > 200) return "主题过长（最多 200 字符）";
  return null;
}
