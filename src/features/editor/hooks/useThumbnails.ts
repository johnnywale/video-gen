import { useState, useEffect } from "react";
import * as svc from "@/infrastructure/media/thumbnailService";

export function useThumbnails(src: string, mediaId?: string, filePath?: string, duration?: number) {
  const [strip, setStrip] = useState(() => svc.getCached(src));

  useEffect(() => {
    const cached = svc.getOrGenerate(src, mediaId, filePath, duration);
    if (cached) { setStrip(cached); return; }

    return svc.subscribe(src, () => {
      const result = svc.getCached(src);
      if (result) setStrip(result);
    });
  }, [src, mediaId, filePath, duration]);

  return strip;
}
