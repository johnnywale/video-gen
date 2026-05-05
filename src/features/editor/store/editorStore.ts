import { create } from "zustand";
import { Timeline, Track, Clip, TrackType, MediaFile, ProjectSettings, DEFAULT_PROJECT_SETTINGS, TimeRange } from "@/domain/timeline/models";
import {
  addClip,
  removeClip,
  updateClip,
  addTrack,
  removeOrClearTrack,
  computeDuration,
} from "@/domain/timeline/timeline";
import { trimClip, moveClip, splitClip, clipDuration } from "@/domain/timeline/clip";
import { pushSnapshot, undoSnapshot, redoSnapshot } from "./undoMiddleware";
import { saveProject } from "@/infrastructure/storage/projectStorage";

interface EditorState {
  timeline: Timeline;
  mediaFiles: MediaFile[];
  selectedClipId: string | null;
  /** ID of the audio MediaFile currently "starred" for use as the
   *  background track in Auto Stages. Set via the media bin (audio tab). */
  selectedAudioMediaId: string | null;
  playheadPosition: number;
  isPlaying: boolean;
  outputPath: string;
  snapLine: number | null;
  draggingMediaId: string | null;
  hydrated: boolean;

  // Undo/Redo
  undo: () => void;
  redo: () => void;

  // Media bin
  addMediaFile: (file: Omit<MediaFile, "id">) => void;
  removeMediaFile: (id: string) => void;
  selectAudioMedia: (id: string | null) => void;

  // Timeline mutations
  addTrack: (type: TrackType) => void;
  removeTrack: (trackId: string) => void;
  addClip: (trackId: string, clip: Omit<Clip, "id">) => void;
  removeClip: (trackId: string, clipId: string) => void;
  trimClip: (trackId: string, clipId: string, start: number, end: number) => void;
  moveClip: (trackId: string, clipId: string, timelineStart: number) => void;
  splitClipAtPlayhead: (trackId: string, clipId: string) => void;
  deleteSelectedClip: () => void;
  toggleClipAudio: (trackId: string, clipId: string) => void;

  // Track controls
  toggleTrackMuted: (trackId: string) => void;
  toggleTrackLocked: (trackId: string) => void;
  toggleTrackHidden: (trackId: string) => void;

  // Time ranges (in/out markers)
  timeRanges: TimeRange[];
  markingInPoint: number | null; // temp in-point while user is setting a range
  addTimeRange: (inPoint: number, outPoint: number) => void;
  removeTimeRange: (id: string) => void;
  updateTimeRange: (id: string, updates: Partial<Pick<TimeRange, "inPoint" | "outPoint" | "label">>) => void;
  setMarkingInPoint: (time: number | null) => void;

  // Selection
  selectClip: (clipId: string | null) => void;

  // Playback
  setPlayheadPosition: (pos: number) => void;
  setIsPlaying: (playing: boolean) => void;

  // Project settings
  projectSettings: ProjectSettings;
  updateProjectSettings: (settings: Partial<ProjectSettings>) => void;

  // Export
  setOutputPath: (path: string) => void;

  // Persistence
  hydrateState: (state: { timeline: Timeline; mediaFiles: MediaFile[]; projectSettings: ProjectSettings; outputPath: string }) => void;

  // Transient UI
  setSnapLine: (pos: number | null) => void;
  setDraggingMediaId: (id: string | null) => void;
}

const defaultTimeline: Timeline = {
  tracks: [
    { id: crypto.randomUUID(), type: "video", clips: [], muted: false, locked: false, hidden: false },
    { id: crypto.randomUUID(), type: "audio", clips: [], muted: false, locked: false, hidden: false },
  ],
  duration: 0,
};

function isTrackLocked(state: EditorState, trackId: string): boolean {
  return state.timeline.tracks.find((t) => t.id === trackId)?.locked ?? false;
}

function withUndo(
  state: EditorState,
  newTimeline: Timeline,
  extra?: Partial<EditorState>
): Partial<EditorState> {
  pushSnapshot(state.timeline);
  return { timeline: { ...newTimeline, duration: computeDuration(newTimeline) }, ...extra };
}

function updateTrackProp(timeline: Timeline, trackId: string, update: Partial<Track>): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.id === trackId ? { ...t, ...update } : t)),
  };
}

export const useEditorStore = create<EditorState>((set) => ({
  timeline: defaultTimeline,
  mediaFiles: [],
  selectedClipId: null,
  selectedAudioMediaId: null,
  playheadPosition: 0,
  isPlaying: false,
  outputPath: "",
  projectSettings: DEFAULT_PROJECT_SETTINGS,
  snapLine: null,
  draggingMediaId: null,
  timeRanges: [],
  markingInPoint: null,
  hydrated: false,

  hydrateState: (restored) =>
    set({
      timeline: restored.timeline,
      mediaFiles: restored.mediaFiles,
      projectSettings: restored.projectSettings,
      outputPath: restored.outputPath,
      hydrated: true,
    }),

  undo: () =>
    set((state) => {
      const snapshot = undoSnapshot(state.timeline);
      if (!snapshot) return state;
      return { timeline: snapshot.timeline };
    }),

  redo: () =>
    set((state) => {
      const snapshot = redoSnapshot(state.timeline);
      if (!snapshot) return state;
      return { timeline: snapshot.timeline };
    }),

  addMediaFile: (fileData) =>
    set((state) => ({
      mediaFiles: [...state.mediaFiles, { ...fileData, id: crypto.randomUUID() }],
    })),

  removeMediaFile: (id) =>
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((f) => f.id !== id),
      selectedAudioMediaId: state.selectedAudioMediaId === id ? null : state.selectedAudioMediaId,
    })),

  selectAudioMedia: (id) => set({ selectedAudioMediaId: id }),

  addTrack: (type) =>
    set((state) => {
      const track: Track = { id: crypto.randomUUID(), type, clips: [], muted: false, locked: false, hidden: false };
      return withUndo(state, addTrack(state.timeline, track));
    }),

  removeTrack: (trackId) =>
    set((state) => withUndo(state, removeOrClearTrack(state.timeline, trackId))),

  addClip: (trackId, clipData) =>
    set((state) => {
      if (isTrackLocked(state, trackId)) return state;
      const clip: Clip = { ...clipData, audioEnabled: clipData.audioEnabled ?? true, id: crypto.randomUUID() };
      return withUndo(state, addClip(state.timeline, trackId, clip));
    }),

  removeClip: (trackId, clipId) =>
    set((state) => {
      if (isTrackLocked(state, trackId)) return state;
      return withUndo(state, removeClip(state.timeline, trackId, clipId));
    }),

  trimClip: (trackId, clipId, start, end) =>
    set((state) => {
      if (isTrackLocked(state, trackId)) return state;
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      return withUndo(state, updateClip(state.timeline, trackId, trimClip(clip, start, end)));
    }),

  moveClip: (trackId, clipId, timelineStart) =>
    set((state) => {
      if (isTrackLocked(state, trackId)) return state;
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const updated = updateClip(state.timeline, trackId, moveClip(clip, timelineStart));
      pushSnapshot(state.timeline);
      return { timeline: { ...updated, duration: computeDuration(updated) } };
    }),

  splitClipAtPlayhead: (trackId, clipId) =>
    set((state) => {
      if (isTrackLocked(state, trackId)) return state;
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!clip) return state;

      const playhead = state.playheadPosition;
      const clipEnd = clip.timelineStart + clipDuration(clip);
      if (playhead <= clip.timelineStart || playhead >= clipEnd) return state;

      const sourceTime = clip.start + (playhead - clip.timelineStart);
      const [a, b] = splitClip(clip, sourceTime);

      const newTimeline: Timeline = {
        ...state.timeline,
        tracks: state.timeline.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [a, b] : [c])) }
            : t
        ),
      };

      return withUndo(state, newTimeline, { selectedClipId: a.id });
    }),

  deleteSelectedClip: () =>
    set((state) => {
      if (!state.selectedClipId) return state;
      for (const track of state.timeline.tracks) {
        if (track.locked) continue;
        if (track.clips.some((c) => c.id === state.selectedClipId)) {
          return withUndo(state, removeClip(state.timeline, track.id, state.selectedClipId!), {
            selectedClipId: null,
          });
        }
      }
      return state;
    }),

  toggleClipAudio: (trackId, clipId) =>
    set((state) => {
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      const clip = track?.clips.find((c) => c.id === clipId);
      if (!clip) return state;
      const updated = updateClip(state.timeline, trackId, { ...clip, audioEnabled: clip.audioEnabled === false });
      return withUndo(state, updated);
    }),

  toggleTrackMuted: (trackId) =>
    set((state) => {
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      if (!track) return state;
      return withUndo(state, updateTrackProp(state.timeline, trackId, { muted: !track.muted }));
    }),

  toggleTrackLocked: (trackId) =>
    set((state) => {
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      if (!track) return state;
      return withUndo(state, updateTrackProp(state.timeline, trackId, { locked: !track.locked }));
    }),

  toggleTrackHidden: (trackId) =>
    set((state) => {
      const track = state.timeline.tracks.find((t) => t.id === trackId);
      if (!track) return state;
      return withUndo(state, updateTrackProp(state.timeline, trackId, { hidden: !track.hidden }));
    }),

  updateProjectSettings: (settings) =>
    set((state) => ({ projectSettings: { ...state.projectSettings, ...settings } })),

  addTimeRange: (inPoint, outPoint) =>
    set((state) => {
      const colors = ["#5b6af5", "#2ea44f", "#f59b42", "#f54271", "#42d4f5", "#a855f7"];
      const color = colors[state.timeRanges.length % colors.length];
      const range: TimeRange = {
        id: crypto.randomUUID(),
        inPoint: Math.min(inPoint, outPoint),
        outPoint: Math.max(inPoint, outPoint),
        label: `Range ${state.timeRanges.length + 1}`,
        color,
      };
      return { timeRanges: [...state.timeRanges, range] };
    }),

  removeTimeRange: (id) =>
    set((state) => ({ timeRanges: state.timeRanges.filter((r) => r.id !== id) })),

  updateTimeRange: (id, updates) =>
    set((state) => ({
      timeRanges: state.timeRanges.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),

  setMarkingInPoint: (time) => set({ markingInPoint: time }),

  selectClip: (clipId) => set({ selectedClipId: clipId }),
  setPlayheadPosition: (pos) => set({ playheadPosition: pos }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setOutputPath: (path) => set({ outputPath: path }),
  setSnapLine: (pos) => set({ snapLine: pos }),
  setDraggingMediaId: (id) => set({ draggingMediaId: id }),
}));

// Auto-save: subscribe to state changes and persist (debounced)
let saveTimeout: ReturnType<typeof setTimeout>;
useEditorStore.subscribe((state) => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveProject({
      timeline: state.timeline,
      mediaFiles: state.mediaFiles,
      projectSettings: state.projectSettings,
      outputPath: state.outputPath,
    });
  }, 500);
});
