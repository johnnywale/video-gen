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
import { extractFramesAtTimes, aiGenerateCaptions } from "@/infrastructure/tauri/commands";
import { useSettingsStore } from "../../store/settingsStore";
import { useTopicsStore } from "../../store/topicsStore";
import { TopicsManagerModal } from "../Topics/TopicsManagerModal";
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
  const [mediaId, setMediaId] = useState<string>(videoMedia[0]?.id ?? "");
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
  const apiSettings = useSettingsStore((s) => s.settings);
  const savedTopics = useTopicsStore((s) => s.topics);
  const selectedAudioMedia = useEditorStore((s) =>
    s.selectedAudioMediaId
      ? s.mediaFiles.find((m) => m.id === s.selectedAudioMediaId && !m.hasVideo) ?? null
      : null
  );
  const transitionType = useEditorStore((s) => s.projectSettings.transitionType);
  const transitionDuration = useEditorStore((s) => s.projectSettings.transitionDuration);

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
    const fresh = {
      ...generateRandomStages(selectedMedia, onTimelineDuration, stageCount, undefined, { speed: DEFAULT_STAGE_SPEED }),
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
  }, [selectedMedia, duration, stageCount, voiceId, xfadeOverhead]);

  // Mirror voice changes onto an existing plan so the export pipeline gets
  // the latest selection (without forcing a full re-generation).
  useEffect(() => {
    setPlan((cur) => (cur && cur.voiceId !== voiceId ? { ...cur, voiceId } : cur));
  }, [voiceId]);

  // Seed the topic from the first saved topic on mount. Runs once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
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

  const handleAddToTimeline = () => {
    if (!plan || !selectedMedia) return;

    const store = useEditorStore.getState();
    const planDuration = totalPlanDuration(plan);

    // Replace existing video tracks. Iterating removeTrack over each video
    // track removes them one by one — and the last call hits
    // `removeOrClearTrack`'s "preserve last of type" path, which clears
    // the clips but keeps the track shell. End state: exactly one empty
    // video track ready to receive the staged clips.
    const existingVideoIds = store.timeline.tracks
      .filter((t) => t.type === "video")
      .map((t) => t.id);
    for (const id of existingVideoIds) {
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

    // (User-requested) If the user has starred an audio file in the media
    // bin, add it as the background audio track for the whole stage range.
    // The audio is auto-fitted to the plan duration:
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
            let cursor = 0;
            let loop = 0;
            while (cursor < planDuration - 1e-3) {
              const remaining = planDuration - cursor;
              const clipLen = Math.min(audioMedia.duration, remaining);
              addClip(newAudioTrack.id, {
                src: audioMedia.src,
                start: 0,
                end: clipLen,
                timelineStart: cursor,
                name: loop === 0 ? `配音 · ${audioMedia.name}` : `配音 · ${audioMedia.name} (${loop + 1})`,
              });
              cursor += clipLen;
              loop++;
            }
          }
        }
      }
    }

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
              {selectedAudioMedia ? (
                <div className={styles.bannerOk}>
                  <span className={styles.bannerIcon}>♪</span>
                  <span>
                    背景音频：<strong>★ {selectedAudioMedia.name}</strong>
                    <span className={styles.bannerNote}> · 将作为音频轨添加</span>
                  </span>
                </div>
              ) : (
                <div className={styles.bannerWarn}>
                  <span className={styles.bannerIcon}>!</span>
                  <span>未选中背景音频 · 点击「素材库 / 音频」中的文件即可设为配音轨</span>
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
                      <div className={`${styles.cardRow} ${styles.textRow}`}>
                        <label>文字</label>
                        <textarea
                          rows={2}
                          value={s.text ?? ""}
                          placeholder="屏幕文字 + 配音内容（可选）"
                          onChange={(e) => handleSetText(s.id, e.target.value)}
                        />
                      </div>
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
          <button className={styles.secondaryBtn} onClick={onClose}>取消</button>
          <button
            className={styles.primaryBtn}
            onClick={handleAddToTimeline}
            disabled={!plan || plan.stages.length === 0}
          >
            确认添加
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
