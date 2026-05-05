export type TrackType = "video" | "audio";

export type Clip = {
  id: string;
  src: string;
  start: number;         // seconds into source file
  end: number;           // seconds into source file
  timelineStart: number; // position on timeline in seconds
  name: string;
  audioEnabled?: boolean; // whether to include original audio (defaults to true)
  /** Per-clip audio gain. 1 = unchanged, 0 = silent, 2 = +6 dB. Applied
   *  during preview (HTMLAudioElement.volume, capped to [0, 1]) and at
   *  export (ffmpeg `volume=N` filter, no cap). Defaults to 1 when absent. */
  volume?: number;
  text?: string;         // optional caption / TTS source for this clip
  /**
   * Playback speed multiplier. 1 = normal. <1 = slow motion (e.g. 0.5 = 2× slow).
   * The on-timeline duration of the clip is (end - start) / speed, so a clip
   * with end-start = 2s and speed = 0.5 occupies 4s on the timeline.
   */
  speed?: number;
  /** Legacy index into the built-in text-overlay style table (0-based).
   *  Preserved for projects saved before `textStyleId` existed; new code
   *  should set `textStyleId` instead. The renderer falls back to this
   *  index (mapping to a built-in's ID) when `textStyleId` is absent. */
  textStyle?: number;
  /** Stable ID of a TextStyle from the textStylesStore. Preferred over
   *  `textStyle` because it's machine-portable — built-in IDs are fixed
   *  in code, custom IDs round-trip via the project save. Unknown IDs
   *  resolve back to the first built-in at render time. */
  textStyleId?: string;
  /** Font family used to render `text` in the export. Resolved against
   *  the user's installed fonts (via fontsStore) at render time; falls
   *  back to the project default when absent or unknown. */
  fontFamily?: string;
};

export type Track = {
  id: string;
  type: TrackType;
  clips: Clip[];
  muted: boolean;
  locked: boolean;
  hidden: boolean;
};

export type Timeline = {
  tracks: Track[];
  duration: number;
};

/** xfade transition types supported by ffmpeg, plus "none" to disable.
 *  Subset of the full xfade list — these read well in short clips. */
export type TransitionType =
  | "none"
  | "fade" | "fadeblack" | "fadewhite"
  | "dissolve"
  | "wipeleft" | "wiperight" | "wipeup" | "wipedown"
  | "slideleft" | "slideright" | "slideup" | "slidedown"
  | "circleopen" | "circleclose"
  | "radial" | "zoomin";

export type ProjectSettings = {
  width: number;
  height: number;
  fps: number;
  codec: "libx264" | "libx265" | "libvpx-vp9";
  crf: number;        // quality (0-51, lower = better)
  preset: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow";
  audioBitrate: string; // e.g. "192k"
  /** xfade transition between adjacent clips on the same video track. */
  transitionType: TransitionType;
  /** Crossfade duration in seconds. Ignored when transitionType is "none". */
  transitionDuration: number;
};

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: "libx264",
  crf: 18,
  preset: "fast",
  audioBitrate: "192k",
  transitionType: "none",
  transitionDuration: 1.0,
};

export type TimeRange = {
  id: string;
  inPoint: number;  // seconds on timeline
  outPoint: number; // seconds on timeline
  label: string;
  color: string;
};

export type MediaFile = {
  id: string;
  name: string;
  src: string;
  filePath?: string; // actual disk path for backend processing (Tauri mode)
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
};
