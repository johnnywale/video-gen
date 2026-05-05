import styles from "./CaptionOverlay.module.css";

interface Props {
  text: string;
  style?: number;
}

export function CaptionOverlay({ text, style = 0 }: Props) {
  if (!text) return null;
  // Clamp the style index into the 0–4 range we have CSS for.
  const idx = Math.max(0, Math.min(4, Math.floor(style)));
  const styleClass = styles[`style${idx}` as keyof typeof styles] ?? styles.style0;

  // Style 1 wraps the text in a span so the bg box hugs the text rather
  // than the full overlay width.
  return (
    <div
      className={`${styles.overlay} ${styleClass}`}
      // Keying on text + style restarts the entrance animation when either
      // changes — so transitioning from one stage to the next visibly
      // re-fades the caption in.
      key={`${idx}:${text}`}
    >
      {idx === 1 ? <span>{text}</span> : text}
    </div>
  );
}
