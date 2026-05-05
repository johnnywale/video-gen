import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useEditorStore } from "../../store/editorStore";
import {
  generateRandomStages,
  rerollStage,
  updateStage,
  planToClips,
  totalPlanDuration,
  StagePlan,
} from "@/domain/stages/plan";
import { extractFramesAtTimes, aiGenerateCaptions, getMediaUrl, probeMedia, isSpeechError, SpeechError } from "@/infrastructure/tauri/commands";
import { useSettingsStore } from "../../store/settingsStore";
import { useTopicsStore } from "../../store/topicsStore";
import { useCaptionsStore } from "../../store/captionsStore";
import { useFontsStore } from "../../store/fontsStore";
import { makeBatch } from "@/domain/captions/captionBatch";
import { getOrGenerateSpeech, peekCachedSpeech } from "../../services/speechService";
import { TopicsManagerModal } from "../Topics/TopicsManagerModal";
import { SpeechDebugModal } from "./SpeechDebugModal";
import styles from "./AutoStagePanel.module.css";

interface Props {
  onClose: () => void;
}

const THUMB_W = 320;
const THUMB_H = 180;
const THUMB_DEBOUNCE_MS = 350;

// Curated MiniMax voice IDs commonly used for Chinese narration. The user
// can also type a custom value via the input (the select includes a
// "Custom..." option that exposes the raw text input).
const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: "Wise_Woman", label: "Wise Woman" },
  { id: "Friendly_Person", label: "Friendly Person" },
  { id: "Inspirational_girl", label: "Inspirational Girl" },
  { id: "Deep_Voice_Man", label: "Deep Voice Man" },
  { id: "Calm_Woman", label: "Calm Woman" },
  { id: "Casual_Guy", label: "Casual Guy" },
  { id: "Lively_Girl", label: "Lively Girl" },
  { id: "Patient_Man", label: "Patient Man" },
  { id: "Imposing_Manner", label: "Imposing Manner" },
  { id: "Elegant_Man", label: "Elegant Man" },
];
const DEFAULT_VOICE = "Wise_Woman";

/** Text overlay styles — indices match the Python video_maker.py TEXT_STYLES table. */
const TEXT_STYLE_OPTIONS: { id: number; label: string }[] = [
  { id: 0, label: "0 — 金色（向上滑入）" },
  { id: 1, label: "1 — 白色（打字机）" },
  { id: 2, label: "2 — 青色（淡入发光）" },
  { id: 3, label: "3 — 白色（左侧滑入）" },
  { id: 4, label: "4 — 红色（顶部淡入）" },
];

const SPEED_PRESETS = [0.25, 0.33, 0.5, 0.75, 1, 1.5, 2];
const SPEED_MIN = 0.25;
const SPEED_MAX = 2;
/** Default speed for newly generated stages.
 *  ~3.3× slow — matches the cinematic-montage feel of `video_maker.py`'s
 *  computed default (Python clamps to 0.2–0.95; 0.3 sits in that range
 *  closer to the visual sweet spot of "0.33 = 3× slow" the script
 *  comments call out as canonical). */
const DEFAULT_STAGE_SPEED = 0.3;

export function AutoStagePanel({ onClose }: Props) {
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const addClip = useEditorStore((s) => s.addClip);

  const videoMedia = useMemo(() => mediaFiles.filter((m) => m.hasVideo), [mediaFiles]);
  // Default the source-video pick to whatever is on the *current* video
  // track — that's what the user is editing. Falls back to the first
  // imported video media if the timeline has no video clip yet (the
  // panel is also a way to *start* a project).
  const initialMediaId = useMemo(() => {
    const tl = useEditorStore.getState().timeline;
    const firstVideoClip = tl.tracks
      .find((t) => t.type === "video" && !t.muted)?.clips[0];
    if (firstVideoClip) {
      const match = videoMedia.find(
        (m) => m.src === firstVideoClip.src || m.filePath === firstVideoClip.src
      );
      if (match) return match.id;
    }
    return videoMedia[0]?.id ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mediaId, setMediaId] = useState<string>(initialMediaId);
  const [duration, setDuration] = useState<number>(30);
  const [stageCount, setStageCount] = useState<number>(5);
  const [plan, setPlan] = useState<StagePlan | null>(null);
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE);
  const [voiceCustom, setVoiceCustom] = useState<boolean>(false);
  // Topic is the free-string theme passed to the AI. Default seeded below
  // by an effect once the topics store has hydrated and we know the first
  // saved entry. (Don't reference savedTopics here — temporal dead zone:
  // savedTopics is declared further down with the rest of the store reads.)
  const [topic, setTopic] = useState<string>("精彩回顾");
  const [isFetchingThumbs, setIsFetchingThumbs] = useState(false);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [topicsManagerOpen, setTopicsManagerOpen] = useState(false);
  // Captions to apply to stages on the next 生成. Set when the modal
  // random-loads a saved batch on mount; cleared once consumed.
  const [pendingBatchCaptions, setPendingBatchCaptions] = useState<string[] | null>(null);
  // Per-stage TTS state. `paths` records cache hits (or freshly-generated
  // results); `busy` is the set of stages currently calling MiniMax;
  // `errors` lets us surface the failure inline. Re-keyed by stage id
  // because stage objects are recreated on every plan edit.
  const [speechPaths, setSpeechPaths] = useState<Record<string, string>>({});
  const [speechBusy, setSpeechBusy] = useState<Record<string, boolean>>({});
  // Stored as the full SpeechError so the user can re-open the debug
  // modal for any past failure (clicking the 生成失败 pill).
  const [speechFailures, setSpeechFailures] = useState<Record<string, SpeechError>>({});
  // Single shared <audio> element for 试听. Reused so clicking another
  // stage's preview cleanly stops the previous one.
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  // The last speech-generation failure. When non-null, the debug modal
  // auto-opens with the request + response bodies. Cleared by the user.
  const [speechDebug, setSpeechDebug] = useState<{
    failure: SpeechError;
    stageLabel: string;
    text: string;
    voiceId: string;
  } | null>(null);
  const apiSettings = useSettingsStore((s) => s.settings);
  const savedTopics = useTopicsStore((s) => s.topics);
  const selectedAudioMedia = useEditorStore((s) =>
    s.selectedAudioMediaId
      ? s.mediaFiles.find((m) => m.id === s.selectedAudioMediaId && !m.hasVideo) ?? null
      : null
  );
  const transitionType = useEditorStore((s) => s.projectSettings.transitionType);
  const transitionDuration = useEditorStore((s) => s.projectSettings.transitionDuration);
  const fonts = useFontsStore((s) => s.fonts);
  const defaultCjkFamily = useFontsStore((s) => s.defaultCjkFamily);

  const selectedMedia = videoMedia.find((m) => m.id === mediaId) ?? null;

  // xfade overlaps adjacent clips, shaving (N-1)·td seconds off the export.
  // To make the user-entered `duration` match the *exported* duration (not
  // the on-timeline length), grow each stage so the post-xfade total lands
  // back on `duration`.
  const useXfadeCompensation = transitionType !== "none" && stageCount >= 2;
  const xfadeOverhead = useXfadeCompensation ? (stageCount - 1) * transitionDuration : 0;

  // Generate plan + first batch of thumbnails
  const handleGenerate = useCallback(async () => {
    if (!selectedMedia || !selectedMedia.filePath) return;
    const onTimelineDuration = duration + xfadeOverhead;
    const generated = generateRandomStages(selectedMedia, onTimelineDuration, stageCount, undefined, { speed: DEFAULT_STAGE_SPEED });
    // Caption source priority on every 生成 / 重新生成:
    //   1. pendingBatchCaptions  — the random-loaded batch on first mount
    //      (consumed once).
    //   2. existing plan's text  — preserves the user's last captions
    //      across re-rolls so 重新生成 keeps 文字 populated; before this,
    //      re-rolling silently wiped the captions which surprised users.
    let captions: string[] | null = null;
    if (pendingBatchCaptions && pendingBatchCaptions.length === generated.stages.length) {
      captions = pendingBatchCaptions;
    } else if (plan && plan.stages.length === generated.stages.length) {
      const existing = plan.stages.map((s) => s.text ?? "");
      if (existing.some((t) => t.length > 0)) captions = existing;
    }
    const stagesWithCaptions = captions
      ? generated.stages.map((s, i) => ({ ...s, text: captions![i] }))
      : generated.stages;
    if (pendingBatchCaptions) setPendingBatchCaptions(null);
    const fresh = {
      ...generated,
      stages: stagesWithCaptions,
      voiceId,
    };
    setPlan(fresh);
    setIsFetchingThumbs(true);
    try {
      const times = fresh.stages.map((s) => s.sourceTime);
      const thumbs = await extractFramesAtTimes(selectedMedia.filePath, times, THUMB_W, THUMB_H);
      setPlan((cur) => {
        if (!cur) return cur;
        // Skip if user generated again in the meantime — fresh.stages won't match.
        if (cur.stages.length !== fresh.stages.length) return cur;
        return {
          ...cur,
          stages: cur.stages.map((s, i) => ({ ...s, thumbnail: thumbs[i] || undefined })),
        };
      });
    } catch (e) {
      console.error("[AutoStage] thumbnail fetch failed:", e);
    } finally {
      setIsFetchingThumbs(false);
    }
  }, [selectedMedia, duration, stageCount, voiceId, xfadeOverhead, pendingBatchCaptions, plan]);

  // Mirror voice changes onto an existing plan so the export pipeline gets
  // the latest selection (without forcing a full re-generation).
  useEffect(() => {
    setPlan((cur) => (cur && cur.voiceId !== voiceId ? { ...cur, voiceId } : cur));
  }, [voiceId]);

  // Mount-only seeding. Prefer a random saved caption batch — set the
  // topic / voice / stage count from it and queue its captions to be
  // applied on the next 生成. If no batches exist, fall back to the
  // first saved topic (the original default-seed behaviour).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const batches = useCaptionsStore.getState().batches;
    const batch = batches.length > 0
      ? batches[Math.floor(Math.random() * batches.length)]
      : null;
    if (batch) {
      setTopic(batch.topic);
      setVoiceId(batch.voiceId);
      setStageCount(batch.captions.length);
      setPendingBatchCaptions(batch.captions);
      return;
    }
    if (savedTopics.length > 0 && topic === "精彩回顾") {
      const first = savedTopics[0];
      if (first.theme !== topic) setTopic(first.theme);
    }
  }, []);

  // Debounced re-fetch when individual stage timestamps change.
  // Detected by noticing stages whose thumbnail is undefined but sourceTime is set.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!plan || !selectedMedia?.filePath) return;
    const stale = plan.stages.filter((s) => s.thumbnail === undefined);
    if (stale.length === 0) return;

    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(async () => {
      try {
        const times = stale.map((s) => s.sourceTime);
        const ids = stale.map((s) => s.id);
        const thumbs = await extractFramesAtTimes(selectedMedia.filePath!, times, THUMB_W, THUMB_H);
        setPlan((cur) => {
          if (!cur) return cur;
          let next = cur;
          ids.forEach((id, i) => {
            if (thumbs[i]) {
              next = updateStage(next, id, { thumbnail: thumbs[i] });
            }
          });
          return next;
        });
      } catch (e) {
        console.error("[AutoStage] thumbnail refetch failed:", e);
      }
    }, THUMB_DEBOUNCE_MS);

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [plan, selectedMedia]);

  // Per-stage editors
  const handleSetSourceTime = (stageId: string, value: number) => {
    if (!plan || !selectedMedia) return;
    const clamped = Math.max(0, Math.min(selectedMedia.duration, value));
    setPlan(updateStage(plan, stageId, { sourceTime: clamped }));
  };
  const handleSetLength = (stageId: string, value: number) => {
    if (!plan) return;
    setPlan(updateStage(plan, stageId, { length: Math.max(0.1, value) }));
  };
  const handleSetText = (stageId: string, value: string) => {
    if (!plan) return;
    setPlan(updateStage(plan, stageId, { text: value }));
  };
  const handleSetSpeed = (stageId: string, value: number) => {
    if (!plan) return;
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, value));
    setPlan(updateStage(plan, stageId, { speed: clamped }));
  };
  const handleSetTextStyle = (stageId: string, value: number) => {
    if (!plan) return;
    setPlan(updateStage(plan, stageId, { textStyle: value }));
  };
  const handleSetFontFamily = (stageId: string, family: string) => {
    if (!plan) return;
    // Empty string = "use project default" (cleared field in the model).
    setPlan(updateStage(plan, stageId, { fontFamily: family || undefined }));
  };

  const handleGenerateCaptions = async () => {
    if (!plan || plan.stages.length === 0) return;
    if (!topic.trim()) {
      setCaptionError("Topic is empty.");
      return;
    }
    setCaptionError(null);
    setIsGeneratingCaptions(true);
    try {
      // If the current topic matches a saved one with a custom prompt,
      // use that prompt template; otherwise the backend's default applies.
      const matched = savedTopics.find((t) => t.theme === topic.trim());
      const promptTemplate = matched?.prompt;
      const captions = await aiGenerateCaptions(
        topic.trim(),
        plan.stages.length,
        apiSettings.anthropicBaseUrl,
        apiSettings.anthropicApiKey,
        undefined,
        promptTemplate
      );
      // Apply each caption to its corresponding stage by index. Use the
      // current plan reference at the moment of return — if the user
      // re-generated stages while we were waiting, just bail.
      setPlan((cur) => {
        if (!cur || cur.stages.length !== captions.length) return cur;
        let next = cur;
        cur.stages.forEach((s, i) => {
          next = updateStage(next, s.id, { text: captions[i] });
        });
        return next;
      });
      // Persist the batch so future opens can random-load it (and so the
      // TTS cache lookup later finds matching text+voice pairs).
      useCaptionsStore.getState().add(makeBatch({
        topic: topic.trim(),
        voiceId,
        captions,
      }));
    } catch (e) {
      const msg = String(e);
      setCaptionError(msg);
      console.error("[AutoStage] caption generation failed:", msg);
    } finally {
      setIsGeneratingCaptions(false);
    }
  };
  const handleReroll = (stageId: string) => {
    if (!plan || !selectedMedia) return;
    setPlan(rerollStage(plan, stageId, selectedMedia.duration));
  };

  // ── TTS preview / regeneration ─────────────────────────────────────
  // Refresh cached-path map whenever the plan or voice changes — text
  // edits invalidate cache hits since the key includes the text.
  useEffect(() => {
    if (!plan) {
      setSpeechPaths({});
      return;
    }
    const next: Record<string, string> = {};
    for (const s of plan.stages) {
      const text = (s.text ?? "").trim();
      if (!text) continue;
      const hit = peekCachedSpeech(text, voiceId);
      if (hit) next[s.id] = hit;
    }
    setSpeechPaths(next);
  }, [plan, voiceId]);

  /** Stop any currently-playing preview, then play `filePath`. */
  const playPreview = useCallback(async (filePath: string) => {
    try {
      const url = await getMediaUrl(filePath);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = "";
      }
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.warn("[AutoStage] preview play failed:", e);
    }
  }, []);

  // Wrap any thrown value in a SpeechError so the debug modal always has
  // a consistent shape — non-Tauri errors (network DOM, JS bugs) get an
  // empty request/response.
  const toSpeechError = (e: unknown): SpeechError => {
    if (isSpeechError(e)) return e;
    return {
      message: e instanceof Error ? e.message : String(e),
      endpoint: "",
      request_body: "",
      status: null,
      response_body: null,
    };
  };

  const recordSpeechFailure = useCallback(
    (stageId: string, text: string, err: unknown) => {
      const failure = toSpeechError(err);
      setSpeechFailures((m) => ({ ...m, [stageId]: failure }));
      const idx = plan?.stages.findIndex((s) => s.id === stageId) ?? -1;
      setSpeechDebug({
        failure,
        stageLabel: idx >= 0 ? `第 ${idx + 1} 段` : "",
        text,
        voiceId,
      });
      console.error("[AutoStage] speech generation failed:", failure);
    },
    [plan, voiceId]
  );

  const generateSpeechForStage = useCallback(
    async (stageId: string, text: string, force: boolean): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed) return null;
      const apiKey = apiSettings.minimaxApiKey.trim();
      const baseUrl = apiSettings.minimaxBaseUrl.trim();
      if (!apiKey || !baseUrl) {
        recordSpeechFailure(stageId, trimmed, new Error("请先在「设置」中填写 MiniMax 密钥"));
        return null;
      }
      setSpeechBusy((m) => ({ ...m, [stageId]: true }));
      setSpeechFailures((m) => {
        const { [stageId]: _drop, ...rest } = m;
        return rest;
      });
      try {
        const { filePath } = await getOrGenerateSpeech(trimmed, voiceId, {
          apiKey,
          baseUrl,
          force,
          cacheDir: apiSettings.speechCacheDir,
        });
        setSpeechPaths((m) => ({ ...m, [stageId]: filePath }));
        return filePath;
      } catch (e) {
        recordSpeechFailure(stageId, trimmed, e);
        return null;
      } finally {
        setSpeechBusy((m) => {
          const { [stageId]: _drop, ...rest } = m;
          return rest;
        });
      }
    },
    [apiSettings.minimaxApiKey, apiSettings.minimaxBaseUrl, apiSettings.speechCacheDir, voiceId, recordSpeechFailure]
  );

  /** 试听: play the cached audio if present; otherwise generate (cache miss
   *  is the normal "first preview" path) and play the result. */
  const handlePreviewSpeech = async (stageId: string) => {
    const stage = plan?.stages.find((s) => s.id === stageId);
    if (!stage || !(stage.text ?? "").trim()) return;
    const cached = speechPaths[stageId];
    if (cached) {
      await playPreview(cached);
      return;
    }
    const fresh = await generateSpeechForStage(stageId, stage.text!, false);
    if (fresh) await playPreview(fresh);
  };

  /** 重新生成: bypass the cache, force MiniMax to produce fresh audio. */
  const handleRegenerateSpeech = async (stageId: string) => {
    const stage = plan?.stages.find((s) => s.id === stageId);
    if (!stage || !(stage.text ?? "").trim()) return;
    const fresh = await generateSpeechForStage(stageId, stage.text!, true);
    if (fresh) await playPreview(fresh);
  };

  // Stop preview audio when the modal closes.
  useEffect(() => () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = "";
      previewAudioRef.current = null;
    }
  }, []);

  const handleAddToTimeline = async () => {
    if (!plan || !selectedMedia) return;
    if (isCommitting) return;
    setIsCommitting(true);

    const store = useEditorStore.getState();
    const planDuration = totalPlanDuration(plan);

    // Replace existing video AND audio tracks. Stage mode is "rebuild
    // the timeline from this plan" — letting old voiceover or bg-audio
    // tracks pile up between runs caused two real bugs: (1) ffmpeg fed
    // duplicate audio inputs from prior sessions, and (2) those prior
    // sessions referenced media-server URLs from a dead port (each run
    // picks a fresh port), so the export failed with "Connection refused".
    //
    // Iterating removeTrack hits `removeOrClearTrack`'s "preserve last of
    // type" path on the final call per type, leaving exactly one empty
    // track of each type as a shell to populate.
    const existingTrackIds = store.timeline.tracks.map((t) => t.id);
    for (const id of existingTrackIds) {
      store.removeTrack(id);
    }
    // If there were zero video tracks to begin with, add one now.
    const tracksAfter = useEditorStore.getState().timeline.tracks;
    const targetVideoTrack = tracksAfter.find((t) => t.type === "video");
    let videoTrackId = targetVideoTrack?.id;
    if (!videoTrackId) {
      store.addTrack("video");
      const fresh = useEditorStore.getState().timeline.tracks.find((t) => t.type === "video");
      videoTrackId = fresh?.id;
    }
    if (!videoTrackId) return;

    // Stages start at t=0 — we just replaced the whole video track, so
    // there's no existing content to slot around.
    const clips = planToClips(plan, selectedMedia, 0);
    for (const c of clips) {
      addClip(videoTrackId, c);
    }

    // ── Voiceover (TTS) auto-attach ─────────────────────────────────
    // Order matters: voiceover is placed *before* the background audio
    // track. This way speech sits "on top" in the track list — clearer
    // mental model, and during preview the voiceover element gets
    // primed/seeked first so its first word doesn't trail the bg fade-in.
    //
    // xfade COMPRESSION: when a transition is enabled the export's video
    // is `sum(length) - (N-1)·td` long because each xfade overlaps the
    // previous clip by `td` seconds. Stage i's *visual* start in the
    // output is therefore `cumLengths[i] - i·td`, not `cumLengths[i]`.
    // Without this correction the last speech ended up ~(N-1)·td late
    // and got chopped by the audio atrim — that's the drift the user
    // was hearing.
    const td = transitionType !== "none" ? transitionDuration : 0;
    let stageCursor = 0;
    const stageMeta = plan.stages.map((s, i) => {
      const onTimelineStart = stageCursor - i * td;
      stageCursor += s.length;
      return {
        stage: s,
        index: i,
        timelineStart: Math.max(0, onTimelineStart),
        length: s.length,
      };
    });
    const speechTargets = stageMeta.filter((x) => (x.stage.text ?? "").trim().length > 0);
    if (speechTargets.length > 0) {
      const apiKey = apiSettings.minimaxApiKey.trim();
      const baseUrl = apiSettings.minimaxBaseUrl.trim();
      if (apiKey && baseUrl) {
        const results = await Promise.all(speechTargets.map(async (t) => {
          try {
            setSpeechBusy((m) => ({ ...m, [t.stage.id]: true }));
            const { filePath } = await getOrGenerateSpeech(t.stage.text!, voiceId, {
              apiKey, baseUrl,
              cacheDir: apiSettings.speechCacheDir,
            });
            const info = await probeMedia(filePath);
            const src = await getMediaUrl(filePath);
            setSpeechPaths((m) => ({ ...m, [t.stage.id]: filePath }));
            return { ...t, filePath, src, duration: info.duration };
          } catch (e) {
            recordSpeechFailure(t.stage.id, t.stage.text!, e);
            return null;
          } finally {
            setSpeechBusy((m) => {
              const { [t.stage.id]: _drop, ...rest } = m;
              return rest;
            });
          }
        }));

        const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);
        if (ok.length > 0) {
          useEditorStore.getState().addTrack("audio");
          const allAudioTracks = useEditorStore.getState().timeline.tracks
            .filter((t) => t.type === "audio");
          const voiceoverTrack = allAudioTracks[allAudioTracks.length - 1];
          if (voiceoverTrack) {
            // Speech is placed at the matching stage start when possible,
            // but never trimmed — capping clip.end to the stage length cut
            // off the last word of long lines and produced a "skipping a
            // word before the next" effect during preview. If a TTS clip
            // is longer than its stage we push the *next* clip later so
            // they don't overlap (which would amix two voices into one).
            // Drift accepted: a couple of long lines may run a few seconds
            // past their visual stage; intelligibility wins over sync.
            const ordered = [...ok].sort((a, b) => a.index - b.index);
            let placeCursor = 0;
            for (const r of ordered) {
              const placeAt = Math.max(placeCursor, r.timelineStart);
              addClip(voiceoverTrack.id, {
                src: r.src,
                start: 0,
                end: r.duration,
                timelineStart: placeAt,
                name: `配音 · 第 ${r.index + 1} 段`,
              });
              placeCursor = placeAt + r.duration;
            }
          }
        }
      } else {
        console.warn("[AutoStage] skipping voiceover — MiniMax credentials not set");
      }
    }

    // ── Background audio loop (added after voiceover so it renders
    // *under* speech in the track list / mix). If the user has starred
    // an audio file in the media bin, add it as a continuous bed for
    // the whole stage range.
    //   - shorter than plan → looped (multiple back-to-back clips)
    //   - longer than plan → trimmed
    const selAudioId = useEditorStore.getState().selectedAudioMediaId;
    if (selAudioId) {
      const audioMedia = store.mediaFiles.find((m) => m.id === selAudioId && !m.hasVideo);
      if (audioMedia && audioMedia.duration > 0) {
        store.addTrack("audio");
        const audioTracks = useEditorStore.getState().timeline.tracks.filter((t) => t.type === "audio");
        const newAudioTrack = audioTracks[audioTracks.length - 1];
        if (newAudioTrack) {
          if (audioMedia.duration >= planDuration) {
            // Trim to plan length.
            addClip(newAudioTrack.id, {
              src: audioMedia.src,
              start: 0,
              end: planDuration,
              timelineStart: 0,
              name: `配音 · ${audioMedia.name}`,
            });
          } else {
            // Loop end-to-end until the plan duration is filled.
            let bgCursor = 0;
            let loop = 0;
            while (bgCursor < planDuration - 1e-3) {
              const remaining = planDuration - bgCursor;
              const clipLen = Math.min(audioMedia.duration, remaining);
              addClip(newAudioTrack.id, {
                src: audioMedia.src,
                start: 0,
                end: clipLen,
                timelineStart: bgCursor,
                name: loop === 0 ? `配音 · ${audioMedia.name}` : `配音 · ${audioMedia.name} (${loop + 1})`,
              });
              bgCursor += clipLen;
              loop++;
            }
          }
        }
      }
    }

    setIsCommitting(false);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Esc closes the modal; Cmd/Ctrl+Enter triggers the primary action.
  // Skip when topicsManager is open — its own Esc handling shouldn't be
  // overridden by ours.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (topicsManagerOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (plan && plan.stages.length > 0) {
          e.preventDefault();
          handleAddToTimeline();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsManagerOpen, plan]);

  const total = plan ? totalPlanDuration(plan) : 0;
  const stageCountForXfade = plan?.stages.length ?? 0;
  const projectedOutput = transitionType !== "none" && stageCountForXfade >= 2
    ? Math.max(0, total - (stageCountForXfade - 1) * transitionDuration)
    : total;

  return (
    <>
    {topicsManagerOpen && <TopicsManagerModal onClose={() => setTopicsManagerOpen(false)} />}
    {speechDebug && (
      <SpeechDebugModal
        failure={speechDebug.failure}
        stageLabel={speechDebug.stageLabel}
        text={speechDebug.text}
        voiceId={speechDebug.voiceId}
        onClose={() => setSpeechDebug(null)}
      />
    )}
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>自动分段</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label>源视频</label>
              <select value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
                {videoMedia.length === 0 ? (
                  <option value="">未导入视频</option>
                ) : (
                  videoMedia.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))
                )}
              </select>
              <span className={styles.fieldHint}>
                {selectedMedia
                  ? `时长 ${selectedMedia.duration.toFixed(1)} 秒`
                  : "请先在素材库中导入视频"}
              </span>
            </div>
            <div className={styles.field}>
              <label>总时长（秒）</label>
              <input
                type="number"
                min={1}
                max={600}
                step={1}
                value={duration}
                aria-invalid={duration < 1 || duration > 600 || (!!selectedMedia && duration > selectedMedia.duration)}
                onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className={styles.fieldHint}>
                {selectedMedia && duration > selectedMedia.duration
                  ? `不能超过源视频时长 (${selectedMedia.duration.toFixed(1)} 秒)`
                  : "1 – 600 秒"}
              </span>
            </div>
            <div className={styles.field}>
              <label>分段数</label>
              <input
                type="number"
                min={1}
                max={50}
                step={1}
                value={stageCount}
                aria-invalid={stageCount < 1 || stageCount > 50}
                onChange={(e) => setStageCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              />
              <span className={styles.fieldHint}>1 – 50 段</span>
            </div>
            <div className={styles.field}>
              <label>主题</label>
              <select
                value={savedTopics.find((t) => t.theme === topic)?.id ?? "__custom__"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__add__" || v === "__manage__") {
                    setTopicsManagerOpen(true);
                    return;
                  }
                  if (v === "__custom__") return;
                  const found = savedTopics.find((t) => t.id === v);
                  if (found) setTopic(found.theme);
                }}
              >
                {savedTopics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
                {!savedTopics.some((t) => t.theme === topic) && (
                  <option value="__custom__">{topic ? `自定义：${topic.slice(0, 20)}` : "（自定义）"}</option>
                )}
                <option value="__add__">+ 新增主题…</option>
                <option value="__manage__">管理主题…</option>
              </select>
              <span className={styles.fieldHint}>用于 AI 文字生成</span>
            </div>
            <div className={styles.field}>
              <label>配音音色</label>
              {voiceCustom ? (
                <input
                  type="text"
                  value={voiceId}
                  placeholder="自定义音色 ID"
                  onChange={(e) => setVoiceId(e.target.value)}
                  onBlur={() => { if (!voiceId.trim()) { setVoiceId(DEFAULT_VOICE); setVoiceCustom(false); } }}
                />
              ) : (
                <select
                  value={VOICE_OPTIONS.some((v) => v.id === voiceId) ? voiceId : "__custom__"}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setVoiceCustom(true);
                    } else {
                      setVoiceId(e.target.value);
                    }
                  }}
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                  <option value="__custom__">自定义…</option>
                </select>
              )}
              <span className={styles.fieldHint}>TTS 合成的音色</span>
            </div>
            <button
              className={styles.compactBtn}
              onClick={handleGenerate}
              disabled={!selectedMedia || isFetchingThumbs}
              title="按当前参数随机抽取片段（已生成的可继续编辑）"
            >
              {isFetchingThumbs ? "生成中…" : (plan ? "↻ 重新生成" : "生成")}
            </button>
          </div>

          {plan && (
            <>
              <div className={styles.summary}>
                <span className={styles.totalLabel}>
                  共 {plan.stages.length} 段
                  {isFetchingThumbs ? " · 缩略图加载中…" : ""}
                  {isGeneratingCaptions ? " · 文字生成中…" : ""}
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button
                    className={styles.aiBtn}
                    onClick={handleGenerateCaptions}
                    disabled={isGeneratingCaptions || plan.stages.length === 0}
                    title="使用上方主题为所有分段生成文字"
                  >
                    ✨ {isGeneratingCaptions ? "生成中…" : "AI 生成文字"}
                  </button>
                  <span className={styles.totalValue}>
                    {projectedOutput !== total
                      ? `输出 ${projectedOutput.toFixed(2)} 秒 · 时间线 ${total.toFixed(2)} 秒`
                      : `总计：${total.toFixed(2)} 秒`}
                  </span>
                </span>
              </div>
              {captionError && (
                <div style={{ fontSize: 11, color: "#e88", padding: "6px 12px", background: "rgba(255,80,80,0.08)", borderRadius: 4, borderLeft: "3px solid #c66" }}>
                  文字生成失败：{captionError}
                </div>
              )}
              {selectedAudioMedia && (
                <div className={styles.bannerOk}>
                  <span className={styles.bannerIcon}>♪</span>
                  <span>
                    背景音频：<strong>★ {selectedAudioMedia.name}</strong>
                    <span className={styles.bannerNote}> · 将作为音频轨添加</span>
                  </span>
                </div>
              )}

              <div className={styles.grid}>
                {plan.stages.map((s, idx) => (
                  <div key={s.id} className={styles.card}>
                    <div className={styles.thumb}>
                      <span className={styles.cardLabel}>第 {idx + 1} 段</span>
                      {s.thumbnail ? (
                        <img src={s.thumbnail} alt={`第 ${idx + 1} 段`} />
                      ) : (
                        <span className={styles.thumbPlaceholder}>加载中…</span>
                      )}
                    </div>
                    <div className={styles.cardBody}>
                      <div className={styles.cardRow}>
                        <label>起点</label>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={Number(s.sourceTime.toFixed(3))}
                          onChange={(e) => handleSetSourceTime(s.id, Number(e.target.value))}
                        />
                        <button className={styles.rerollBtn} onClick={() => handleReroll(s.id)} title="重新随机选取时间点">
                          ↻
                        </button>
                      </div>
                      <div className={styles.cardRow}>
                        <label>时长</label>
                        <input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={Number(s.length.toFixed(3))}
                          onChange={(e) => handleSetLength(s.id, Number(e.target.value))}
                        />
                      </div>
                      <div className={styles.cardRow}>
                        <label>速度</label>
                        <input
                          type="number"
                          min={SPEED_MIN}
                          max={SPEED_MAX}
                          step={0.05}
                          list={`speed-presets-${s.id}`}
                          value={Number((s.speed ?? 1).toFixed(2))}
                          onChange={(e) => handleSetSpeed(s.id, Number(e.target.value))}
                        />
                        <datalist id={`speed-presets-${s.id}`}>
                          {SPEED_PRESETS.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                      </div>
                      <div className={styles.cardRow}>
                        <label>样式</label>
                        <select
                          value={s.textStyle ?? 0}
                          onChange={(e) => handleSetTextStyle(s.id, Number(e.target.value))}
                        >
                          {TEXT_STYLE_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.cardRow}>
                        <label>字体</label>
                        <select
                          value={s.fontFamily ?? ""}
                          onChange={(e) => handleSetFontFamily(s.id, e.target.value)}
                          title={s.fontFamily ?? `默认（${defaultCjkFamily ?? "未设置"}）`}
                        >
                          <option value="">默认{defaultCjkFamily ? `（${defaultCjkFamily}）` : ""}</option>
                          {fonts.length === 0 && <option disabled>加载中…</option>}
                          {fonts.filter((f) => f.supports_cjk).length > 0 && (
                            <optgroup label="CJK 字体">
                              {fonts.filter((f) => f.supports_cjk).map((f) => (
                                <option key={`cjk-${f.path}`} value={f.family}>{f.family}</option>
                              ))}
                            </optgroup>
                          )}
                          {fonts.filter((f) => !f.supports_cjk).length > 0 && (
                            <optgroup label="其他">
                              {fonts.filter((f) => !f.supports_cjk).map((f) => (
                                <option key={`x-${f.path}`} value={f.family}>{f.family}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                      <div className={`${styles.cardRow} ${styles.textRow}`}>
                        <label>文字</label>
                        <textarea
                          rows={2}
                          value={s.text ?? ""}
                          placeholder="屏幕文字 + 配音内容（可选）"
                          onChange={(e) => handleSetText(s.id, e.target.value)}
                        />
                      </div>
                      {(() => {
                        const hasText = !!(s.text ?? "").trim();
                        const busy = !!speechBusy[s.id];
                        const cached = speechPaths[s.id];
                        const err = speechFailures[s.id];
                        const status = err
                          ? { cls: styles.speechStatusError, text: "生成失败" }
                          : busy
                          ? { cls: styles.speechStatusBusy, text: "生成中…" }
                          : cached
                          ? { cls: styles.speechStatusReady, text: "已生成" }
                          : { cls: "", text: "未生成" };
                        const stageIdx = idx;
                        return (
                          <div className={`${styles.cardRow} ${styles.speechRow}`} title={err?.message}>
                            {err ? (
                              <button
                                type="button"
                                className={`${styles.speechStatus} ${status.cls}`}
                                onClick={() => setSpeechDebug({
                                  failure: err,
                                  stageLabel: `第 ${stageIdx + 1} 段`,
                                  text: s.text ?? "",
                                  voiceId,
                                })}
                                title="点击查看请求/响应"
                                style={{ cursor: "pointer" }}
                              >
                                ♪ {status.text}
                              </button>
                            ) : (
                              <span className={`${styles.speechStatus} ${status.cls}`}>
                                ♪ {status.text}
                              </span>
                            )}
                            <button
                              className={styles.speechBtn}
                              onClick={() => handlePreviewSpeech(s.id)}
                              disabled={!hasText || busy}
                              title={cached ? "播放已生成的配音" : "生成并播放"}
                            >
                              ▶ 试听
                            </button>
                            <button
                              className={styles.speechBtn}
                              onClick={() => handleRegenerateSpeech(s.id)}
                              disabled={!hasText || busy}
                              title="忽略缓存，调用接口重新生成"
                            >
                              ↻ 新版本
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!plan && videoMedia.length === 0 && (
            <div className={styles.empty}>请先导入视频后再使用本功能。</div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.secondaryBtn} onClick={onClose} disabled={isCommitting}>取消</button>
          <button
            className={styles.primaryBtn}
            onClick={handleAddToTimeline}
            disabled={!plan || plan.stages.length === 0 || isCommitting}
          >
            {isCommitting ? "处理中…" : "确认添加"}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
