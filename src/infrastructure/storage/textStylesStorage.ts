import { TextStyle, BUILTIN_TEXT_STYLES } from "@/domain/captions/textStyle";

const KEY = "video-editor-text-styles";

/** Returns built-ins (always rebuilt from code so default tweaks land on
 *  next launch) prepended to any user-added customs from localStorage. */
export function loadTextStyles(): TextStyle[] {
  try {
    const raw = localStorage.getItem(KEY);
    const customs = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(customs)) return [...BUILTIN_TEXT_STYLES];
    const valid: TextStyle[] = customs
      .filter(
        (s) =>
          s &&
          typeof s.id === "string" &&
          typeof s.name === "string" &&
          typeof s.color === "string"
      )
      .filter((s) => !s.builtin)
      .map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        position: s.position === "top" ? "top" : "bottom",
      }));
    return [...BUILTIN_TEXT_STYLES, ...valid];
  } catch {
    return [...BUILTIN_TEXT_STYLES];
  }
}

/** Persist only the customs — built-ins live in code. */
export function saveTextStyles(list: TextStyle[]): void {
  try {
    const customs = list.filter((s) => !s.builtin);
    localStorage.setItem(KEY, JSON.stringify(customs));
  } catch {
    console.warn("Failed to save text styles to localStorage");
  }
}
