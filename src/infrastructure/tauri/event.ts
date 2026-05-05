import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface RenderProgressEvent {
  percent: number;
  currentTime: number;
}

/** Raw payload as it arrives from Tauri. The Rust struct now uses
 *  `rename_all = "camelCase"`, but older backend builds may still emit
 *  the snake_case `current_time` field; we accept both so users running
 *  a stale binary still get a moving progress bar. */
interface RawProgress {
  percent?: number;
  currentTime?: number;
  current_time?: number;
}

export function onRenderProgress(
  callback: (progress: RenderProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<RawProgress>("render_progress", (event) => {
    const raw = event.payload;
    callback({
      percent: raw.percent ?? 0,
      currentTime: raw.currentTime ?? raw.current_time ?? 0,
    });
  });
}

export function onRenderComplete(callback: () => void): Promise<UnlistenFn> {
  return listen("render_complete", () => callback());
}

export function onRenderError(callback: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>("render_error", (event) => callback(event.payload));
}

export interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

export function onFileDrop(callback: (paths: string[]) => void): Promise<UnlistenFn> {
  return listen<DragDropPayload>("tauri://drag-drop", (event) => {
    callback(event.payload.paths);
  });
}
