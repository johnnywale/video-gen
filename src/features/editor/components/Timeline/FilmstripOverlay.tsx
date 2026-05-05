import { useRef, useEffect } from "react";
import { useThumbnails } from "../../hooks/useThumbnails";
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

const MAX_CANVAS_W = 4096;

export function FilmstripOverlay({ src, mediaId, filePath, mediaDuration, clipStart, clipEnd, widthPx, heightPx }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strip = useThumbnails(src, mediaId, filePath, mediaDuration);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !strip || strip.dataUrls.length === 0) return;

    const renderW = Math.min(widthPx, MAX_CANVAS_W);
    canvas.width = renderW;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#1a1a1e";
    ctx.fillRect(0, 0, renderW, heightPx);

    const { dataUrls, frameInterval, sourceDuration } = strip;
    if (sourceDuration <= 0) return;

    // Load all images, then draw
    const images: HTMLImageElement[] = dataUrls.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });

    // Wait for at least the first image to get aspect ratio
    const firstImg = images[0];
    const doDraw = () => {
      const imgW = firstImg.naturalWidth || 114;
      const imgH = firstImg.naturalHeight || 64;
      const thumbW = Math.round(heightPx * (imgW / imgH));
      const scale = renderW / Math.max(1, widthPx);
      const scaledW = Math.max(1, Math.round(thumbW * scale));
      const clipDur = clipEnd - clipStart;

      let x = 0;
      while (x < renderW) {
        const srcTime = clipStart + (x / renderW) * clipDur;
        const idx = Math.min(images.length - 1, Math.max(0, Math.floor(srcTime / frameInterval)));
        const img = images[idx];
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, x, 0, scaledW, heightPx);
        }
        x += scaledW;
      }
    };

    if (firstImg.complete) {
      doDraw();
    } else {
      firstImg.onload = doDraw;
    }
  }, [strip, clipStart, clipEnd, widthPx, heightPx]);

  if (!strip || strip.dataUrls.length === 0) return null;

  return <canvas ref={canvasRef} className={styles.clipVisualOverlay} />;
}
