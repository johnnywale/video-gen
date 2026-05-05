import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface RenderProgressEvent {
  percent: number;
  currentTime: number;
}

export function onRenderProgress(
  callback: (progress: RenderProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<RenderProgressEvent>("render_progress", (event) => {
    callback(event.payload);
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
