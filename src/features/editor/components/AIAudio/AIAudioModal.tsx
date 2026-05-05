import { useState } from "react";
import { aiGenerateMusic, probeMedia, getMediaUrl } from "@/infrastructure/tauri/commands";
import { useEditorStore } from "../../store/editorStore";
import { useSettingsStore } from "../../store/settingsStore";
import styles from "./AIAudioModal.module.css";

interface Props {
  onClose: () => void;
}

/** Mood presets — copied from the reference Python `video_maker.py`
 *  MUSIC_MOODS list, plus the documentary-style preset from the user's
 *  reference music client. Pick one to seed the prompt; user can edit. */
const MOOD_PRESETS: { label: string; prompt: string }[] = [
  {
    label: "电影史诗（管弦乐）",
    prompt: "Cinematic, epic, orchestral, inspiring, slow tempo, perfect for a philosophical montage",
  },
  {
    label: "温暖民谣（吉他）",
    prompt: "Upbeat, warm, acoustic guitar, hopeful, gentle rhythm, reflective journey",
  },
  {
    label: "悬疑黑暗（弦乐）",
    prompt: "Dramatic, dark, suspenseful, deep strings, contemplative, mysterious atmosphere",
  },
  {
    label: "情感钢琴",
    prompt: "Emotional, piano, sentimental, melancholic, soft, tender, introspective",
  },
  {
    label: "燃情终章（鼓+合成器）",
    prompt: "Energetic, driving, uplifting, drums and synth, triumphant, grand finale",
  },
  {
    label: "纪录片风格（叙事配乐）",
    prompt:
      "A warm and emotional background music piece suitable for narrating life lessons and personal growth stories. Piano-driven, with soft strings and subtle ambient textures. Slow tempo (60–80 BPM), gradually evolving from calm and introspective to slightly uplifting and inspiring. The mood should be reflective, peaceful, and healing — not too sad, not too dramatic. No vocals. Smooth progression without abrupt changes. Documentary-style or storytelling background score, ending with a gentle and hopeful resolution",
  },
];

export function AIAudioModal({ onClose }: Props) {
  const [prompt, setPrompt] = useState(MOOD_PRESETS[0].prompt);
  const [duration, setDuration] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minimaxKey = useSettingsStore((s) => s.settings.minimaxApiKey);
  const minimaxBaseUrl = useSettingsStore((s) => s.settings.minimaxBaseUrl);
  const addMediaFile = useEditorStore((s) => s.addMediaFile);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("请输入音乐描述");
      return;
    }
    const trimmedKey = minimaxKey.trim();
    if (!trimmedKey) {
      setError("请先在「设置」中填写 MiniMax API 密钥");
      return;
    }
    if (!minimaxBaseUrl.trim()) {
      setError("请先在「设置」中填写 MiniMax 服务地址");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const filePath = await aiGenerateMusic(
        prompt.trim(),
        trimmedKey,
        minimaxBaseUrl.trim(),
        duration > 0 ? duration : undefined
      );
      const info = await probeMedia(filePath);
      const src = await getMediaUrl(filePath);
      const fileName = filePath.split(/[\\/]/).pop() ?? "music.mp3";
      addMediaFile({
        name: fileName,
        src,
        filePath,
        duration: info.duration,
        width: info.width,
        height: info.height,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      console.error("[AIAudio] music generation failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>AI 背景音乐生成</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={styles.body}>
          <span className={styles.help}>
            通过 MiniMax 音乐生成接口创作纯器乐（无人声）背景音，结果将自动添加到「音频」素材库。生成可能需要 30 秒到几分钟，请耐心等待。
          </span>

          <div className={styles.field}>
            <label>风格预设（选一个填入下方描述）</label>
            <select
              className={styles.select}
              value=""
              onChange={(e) => {
                const preset = MOOD_PRESETS.find((m) => m.label === e.target.value);
                if (preset) setPrompt(preset.prompt);
                e.target.value = "";
              }}
            >
              <option value="">— 选择风格预设 —</option>
              {MOOD_PRESETS.map((m) => (
                <option key={m.label} value={m.label}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>音乐描述（英文效果更好）</label>
            <textarea
              className={styles.textarea}
              value={prompt}
              placeholder="描述想要的音乐风格、情绪、乐器、节奏等，例如：cinematic, slow piano, melancholic..."
              onChange={(e) => { setPrompt(e.target.value); setError(null); }}
              maxLength={2000}
              rows={6}
            />
          </div>

          <div className={styles.field}>
            <label>目标时长（秒）</label>
            <input
              className={styles.input}
              type="number"
              min={10}
              max={240}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>
        <div className={styles.footer}>
          <button className={styles.secondaryBtn} onClick={onClose}>取消</button>
          <button className={styles.primaryBtn} onClick={handleGenerate} disabled={busy}>
            {busy ? "生成中（最多数分钟）…" : "生成背景音乐"}
          </button>
        </div>
      </div>
    </div>
  );
}
