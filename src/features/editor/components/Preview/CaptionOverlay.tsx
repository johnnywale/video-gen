import { CSSProperties } from "react";
import { TextStyle, BUILTIN_TEXT_STYLES } from "@/domain/captions/textStyle";
import styles from "./CaptionOverlay.module.css";

interface Props {
  text: string;
  /** Resolved style — usually the result of resolveClipStyle(). When
   *  omitted the first built-in (style0) is used. */
  style?: TextStyle;
}

/** Map a built-in style ID to its index in the legacy CSS class table.
 *  Built-ins keep the existing animated CSS classes; customs fall back
 *  to inline color/position so any user-defined entry still renders. */
const BUILTIN_ID_TO_CLASS_INDEX: Record<string, number> = Object.fromEntries(
  BUILTIN_TEXT_STYLES.map((s, i) => [s.id, i])
);

export function CaptionOverlay({ text, style }: Props) {
  if (!text) return null;
  const resolved = style ?? BUILTIN_TEXT_STYLES[0];
  const builtinIdx = BUILTIN_ID_TO_CLASS_INDEX[resolved.id];

  if (builtinIdx !== undefined) {
    // Known built-in → keep the existing animated CSS classes.
    const styleClass = styles[`style${builtinIdx}` as keyof typeof styles] ?? styles.style0;
    return (
      <div
        className={`${styles.overlay} ${styleClass}`}
        // Restart the entrance animation when text or style changes.
        key={`${resolved.id}:${text}`}
      >
        {builtinIdx === 1 ? <span>{text}</span> : text}
      </div>
    );
  }

  // Custom style — render with inline colour + position. No animation
  // for now (the built-ins' animations are CSS-class bound; custom
  // entries are static but still legible).
  const positionStyle: CSSProperties =
    resolved.position === "top"
      ? { top: "8%" }
      : resolved.position === "center"
      ? { top: "50%", transform: "translateY(-50%)" }
      : { bottom: "12%" };
  const inlineStyle: CSSProperties = { ...positionStyle, color: resolved.color };
  return (
    <div
      className={styles.overlay}
      style={{
        ...inlineStyle,
        fontSize: "clamp(20px, 4vw, 40px)",
        textShadow: "2px 2px 0 rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.4)",
      }}
      key={`${resolved.id}:${text}`}
    >
      {text}
    </div>
  );
}
