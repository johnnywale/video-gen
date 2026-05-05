import { useState, useEffect } from "react";
import * as svc from "@/infrastructure/media/waveformService";

export function useWaveform(src: string, mediaId?: string, filePath?: string, duration?: number) {
  const [data, setData] = useState(() => svc.getCached(src));

  useEffect(() => {
    const cached = svc.getOrGenerate(src, mediaId, filePath, duration);
    if (cached) { setData(cached); return; }

    return svc.subscribe(src, () => {
      const result = svc.getCached(src);
      if (result) setData(result);
    });
  }, [src, mediaId, filePath, duration]);

  return data;
}
