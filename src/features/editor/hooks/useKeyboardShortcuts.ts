import { useEffect } from "react";
import { useEditorStore } from "../store/editorStore";
import { FRAME_DURATION } from "@/shared/constants";
import { clipDuration } from "@/domain/timeline/clip";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const store = useEditorStore.getState();

      switch (e.key) {
        case " ":
          e.preventDefault();
          store.setIsPlaying(!store.isPlaying);
          break;

        case "j":
        case "J":
          e.preventDefault();
          store.setIsPlaying(false);
          store.setPlayheadPosition(Math.max(0, store.playheadPosition - FRAME_DURATION));
          break;

        case "k":
        case "K":
          e.preventDefault();
          store.setIsPlaying(false);
          break;

        case "l":
        case "L":
          e.preventDefault();
          store.setIsPlaying(false);
          store.setPlayheadPosition(store.playheadPosition + FRAME_DURATION);
          break;

        case "ArrowLeft":
          e.preventDefault();
          store.setIsPlaying(false);
          store.setPlayheadPosition(Math.max(0, store.playheadPosition - FRAME_DURATION));
          break;

        case "ArrowRight":
          e.preventDefault();
          store.setIsPlaying(false);
          store.setPlayheadPosition(store.playheadPosition + FRAME_DURATION);
          break;

        case "Delete":
        case "Backspace":
          e.preventDefault();
          store.deleteSelectedClip();
          break;

        case "i":
        case "I":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            store.setMarkingInPoint(store.playheadPosition);
          }
          break;

        case "o":
        case "O":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (store.markingInPoint !== null) {
              store.addTimeRange(store.markingInPoint, store.playheadPosition);
              store.setMarkingInPoint(null);
            }
          }
          break;

        case "b":
        case "B":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            for (const track of store.timeline.tracks) {
              for (const clip of track.clips) {
                const end = clip.timelineStart + clipDuration(clip);
                if (store.playheadPosition > clip.timelineStart && store.playheadPosition < end) {
                  store.splitClipAtPlayhead(track.id, clip.id);
                  return;
                }
              }
            }
          }
          break;

        case "z":
        case "Z":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              store.redo();
            } else {
              store.undo();
            }
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
