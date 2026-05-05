import { FPS } from "@/shared/constants";

export function formatTimecode(seconds: number, fps: number = FPS): string {
  const totalFrames = Math.floor(Math.max(0, seconds) * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(Math.max(0, seconds));
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);

  return [
    String(hh).padStart(2, "0"),
    String(mm).padStart(2, "0"),
    String(ss).padStart(2, "0"),
    String(ff).padStart(2, "0"),
  ].join(":");
}
