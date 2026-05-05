/**
 * Text style — colour + position for the caption overlay used by both
 * preview and ffmpeg `drawtext`. Five built-ins ship with the app and
 * cannot be deleted or edited; the user can add custom entries via the
 * Text tab and pick them in the per-stage 样式 dropdown.
 *
 * IDs are the cross-machine stable reference: a clip stores
 * `textStyleId`, so reopening the same project on another machine
 * (with a different localStorage) still resolves built-ins, and unknown
 * custom IDs gracefully fall back to the first built-in.
 */

export type TextStylePosition = "top" | "center" | "bottom";

export interface TextStyle {
  id: string;
  name: string;
  color: string;          // hex "#RRGGBB"
  position: TextStylePosition;
  /** True for the 5 shipped defaults — UI prevents edit and delete. */
  builtin?: boolean;
}

/** Shipped defaults. The order MUST match the legacy numeric `textStyle`
 *  index so old projects round-trip cleanly via `legacyIndexToId`.
 *  Each built-in's `id` is the key the renderer uses to apply the
 *  animation that matches the label (slide-up / typewriter / etc.) — see
 *  `buildCaptionFilter` in domain/renderer/ffmpegGraph.ts. */
export const BUILTIN_TEXT_STYLES: readonly TextStyle[] = [
  { id: "builtin-gold-bottom",      name: "金色（向上滑入）", color: "#FFD700", position: "bottom", builtin: true },
  { id: "builtin-white-typewriter", name: "白色（打字机）",    color: "#FFFFFF", position: "bottom", builtin: true },
  { id: "builtin-cyan-glow",        name: "青色（淡入发光）", color: "#00FFCC", position: "center", builtin: true },
  { id: "builtin-white-slidein",    name: "白色（左侧滑入）", color: "#FFFFFF", position: "bottom", builtin: true },
  { id: "builtin-red-top",          name: "红色（顶部淡入）", color: "#FF4040", position: "top",    builtin: true },
];

/** Mirror of the legacy 0..4 index used by clips before `textStyleId`
 *  existed. Returns the matching built-in's ID, or the first built-in
 *  when out of range. */
export function legacyIndexToId(idx: number | undefined): string {
  if (idx === undefined || idx < 0 || idx >= BUILTIN_TEXT_STYLES.length) {
    return BUILTIN_TEXT_STYLES[0].id;
  }
  return BUILTIN_TEXT_STYLES[idx].id;
}

/** Resolve an ID against a styles list. Falls back to the first item in
 *  the list, then to the first built-in — guaranteed non-null. */
export function resolveTextStyle(
  styles: readonly TextStyle[],
  id: string | undefined
): TextStyle {
  if (id) {
    const found = styles.find((s) => s.id === id);
    if (found) return found;
  }
  return styles[0] ?? BUILTIN_TEXT_STYLES[0];
}

/** For backward compat with old clips that only have a numeric
 *  `textStyle`. Combines `legacyIndexToId` + `resolveTextStyle`. */
export function resolveClipStyle(
  styles: readonly TextStyle[],
  textStyleId: string | undefined,
  legacyIndex: number | undefined
): TextStyle {
  const id = textStyleId ?? legacyIndexToId(legacyIndex);
  return resolveTextStyle(styles, id);
}

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `style_${crypto.randomUUID()}`
    : `style_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

export function makeTextStyle(input: {
  name: string;
  color: string;
  position: TextStylePosition;
}): TextStyle {
  return { id: newId(), name: input.name, color: input.color, position: input.position };
}

export function validateTextStyle(name: string, color: string): string | null {
  if (!name.trim()) return "请输入名称";
  if (name.length > 60) return "名称过长（最多 60 字符）";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return "颜色需要 #RRGGBB 格式";
  return null;
}
