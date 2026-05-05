import { useMemo } from "react";
import { useWaveform } from "../../hooks/useWaveform";
import styles from "./Timeline.module.css";

interface Props {
  src: string;
  mediaId?: string;
  filePath?: string;
  mediaDuration?: number;
  clipStart: number;
  clipEnd: number;
  widthPx: number;
  heightPx: number;
}

const MAX_SVG_WIDTH = 2000;
const MAX_POINTS = 2000;

export function WaveformOverlay({ src, mediaId, filePath, mediaDuration, clipStart, clipEnd, widthPx, heightPx }: Props) {
  const waveform = useWaveform(src, mediaId, filePath, mediaDuration);

  const pathD = useMemo(() => {
    if (!waveform || waveform.peaks.length === 0 || widthPx <= 0) return "";

    const { peaks, peaksPerSecond } = waveform;
    const startIdx = Math.floor(clipStart * peaksPerSecond);
    const endIdx = Math.min(peaks.length, Math.ceil(clipEnd * peaksPerSecond));
    const sliceLen = endIdx - startIdx;
    if (sliceLen <= 0) return "";

    // Use a fixed coordinate space, CSS scales to fill
    const svgW = Math.min(widthPx, MAX_SVG_WIDTH);
    const centerY = heightPx / 2;
    const halfH = centerY * 0.9;

    const barCount = Math.min(MAX_POINTS, Math.min(sliceLen, Math.ceil(svgW)));
    const step = Math.max(1, Math.floor(sliceLen / barCount));

    const topPoints: string[] = [];
    const bottomPoints: string[] = [];

    for (let i = 0; i < barCount; i++) {
      const idx = startIdx + Math.min(i * step, sliceLen - 1);
      const peak = peaks[Math.min(idx, peaks.length - 1)];
      const x = (i / barCount) * svgW;
      const y = peak * halfH;

      topPoints.push(`${x.toFixed(1)},${(centerY - y).toFixed(1)}`);
      bottomPoints.push(`${x.toFixed(1)},${(centerY + y).toFixed(1)}`);
    }

    return `M${topPoints.join(" L")} L${bottomPoints.reverse().join(" L")}Z`;
  }, [waveform, clipStart, clipEnd, widthPx, heightPx]);

  if (!pathD) return null;

  const svgW = Math.min(widthPx, MAX_SVG_WIDTH);

  return (
    <svg
      className={styles.clipVisualOverlay}
      viewBox={`0 0 ${svgW} ${heightPx}`}
      preserveAspectRatio="none"
    >
      <path d={pathD} className={styles.waveformPath} />
    </svg>
  );
}
