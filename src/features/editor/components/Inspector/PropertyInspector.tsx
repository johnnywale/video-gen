import { type CSSProperties } from "react";
import { Clip, Track, ProjectSettings, TimeRange } from "@/domain/timeline/models";
import { clipDuration } from "@/domain/timeline/clip";
import styles from "./Inspector.module.css";

interface Props {
  clip: Clip | null;
  track: Track | null;
  projectSettings: ProjectSettings;
  timeRanges: TimeRange[];
  onTrimClip: (trackId: string, clipId: string, start: number, end: number) => void;
  onMoveClip: (trackId: string, clipId: string, timelineStart: number) => void;
  onToggleClipAudio: (trackId: string, clipId: string) => void;
  onSetClipVolume: (trackId: string, clipId: string, volume: number) => void;
  onUpdateProjectSettings: (settings: Partial<ProjectSettings>) => void;
  onUpdateTimeRange: (id: string, updates: Partial<Pick<TimeRange, "inPoint" | "outPoint" | "label">>) => void;
  onRemoveTimeRange: (id: string) => void;
  style?: CSSProperties;
}

const RESOLUTION_PRESETS = [
  { label: "4K (3840×2160)", w: 3840, h: 2160 },
  { label: "1080p (1920×1080)", w: 1920, h: 1080 },
  { label: "720p (1280×720)", w: 1280, h: 720 },
  { label: "9:16 1080×1920", w: 1080, h: 1920 },
  { label: "1:1 1080×1080", w: 1080, h: 1080 },
  { label: "480p (854×480)", w: 854, h: 480 },
];

const FPS_OPTIONS = [24, 25, 30, 50, 60];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, "0")}`;
}

export function PropertyInspector({ clip, track, projectSettings, timeRanges, onTrimClip, onMoveClip, onToggleClipAudio, onSetClipVolume, onUpdateProjectSettings, onUpdateTimeRange, onRemoveTimeRange, style }: Props) {
  if (!clip || !track) {
    return (
      <div className={styles.inspector} style={style}>
        <div className={styles.header}>
          <span className={styles.title}>项目设置</span>
        </div>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>分辨率</div>
            <div className={styles.row}>
              <label className={styles.label}>预设</label>
              <select
                className={styles.select}
                value={`${projectSettings.width}x${projectSettings.height}`}
                onChange={(e) => {
                  const preset = RESOLUTION_PRESETS.find((p) => `${p.w}x${p.h}` === e.target.value);
                  if (preset) onUpdateProjectSettings({ width: preset.w, height: preset.h });
                }}
              >
                {RESOLUTION_PRESETS.map((p) => (
                  <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.row}>
              <label className={styles.label}>宽度</label>
              <input
                className={styles.input}
                type="number"
                step="2"
                min="128"
                max="7680"
                value={projectSettings.width}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 128) onUpdateProjectSettings({ width: val });
                }}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>高度</label>
              <input
                className={styles.input}
                type="number"
                step="2"
                min="128"
                max="4320"
                value={projectSettings.height}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 128) onUpdateProjectSettings({ height: val });
                }}
              />
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>播放</div>
            <div className={styles.row}>
              <label className={styles.label}>帧率</label>
              <select
                className={styles.select}
                value={projectSettings.fps}
                onChange={(e) => onUpdateProjectSettings({ fps: parseInt(e.target.value) })}
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>导出</div>
            <div className={styles.row}>
              <label className={styles.label}>
                编码
                <span className={styles.helpHint} title="视频压缩格式。H.264 兼容性最佳；H.265 文件更小但部分播放器不支持；VP9 适合网页。">?</span>
              </label>
              <select
                className={styles.select}
                value={projectSettings.codec}
                onChange={(e) => onUpdateProjectSettings({ codec: e.target.value as ProjectSettings["codec"] })}
              >
                <option value="libx264">H.264</option>
                <option value="libx265">H.265 (HEVC)</option>
                <option value="libvpx-vp9">VP9</option>
              </select>
            </div>
            <div className={styles.row}>
              <label className={styles.label}>
                质量 (CRF)
                <span className={styles.helpHint} title="恒定速率因子（CRF）：数值越小画质越好但文件更大。常用范围 18-28：18 几乎无损；23 默认；28 较小体积。">?</span>
              </label>
              <input
                className={styles.input}
                type="number"
                step="1"
                min="0"
                max="51"
                value={projectSettings.crf}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 0 && val <= 51) onUpdateProjectSettings({ crf: val });
                }}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>
                预设
                <span className={styles.helpHint} title="编码速度与压缩效率的平衡。越慢压缩效率越好（同样质量下文件更小），但导出耗时更长。">?</span>
              </label>
              <select
                className={styles.select}
                value={projectSettings.preset}
                onChange={(e) => onUpdateProjectSettings({ preset: e.target.value as ProjectSettings["preset"] })}
              >
                <option value="ultrafast">极快</option>
                <option value="superfast">超快</option>
                <option value="veryfast">很快</option>
                <option value="faster">较快</option>
                <option value="fast">快速</option>
                <option value="medium">中等</option>
                <option value="slow">慢速（最佳质量）</option>
              </select>
            </div>
          </div>

          {timeRanges.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>时间范围（{timeRanges.length}）</div>
              {timeRanges.map((range) => (
                <div key={range.id} className={styles.rangeItem}>
                  <div className={styles.rangeHeader}>
                    <span className={styles.rangeColor} style={{ backgroundColor: range.color }} />
                    <input
                      className={styles.rangeLabel}
                      value={range.label}
                      onChange={(e) => onUpdateTimeRange(range.id, { label: e.target.value })}
                    />
                    <button
                      className={styles.rangeDelete}
                      onClick={() => onRemoveTimeRange(range.id)}
                      title="删除范围"
                    >
                      ×
                    </button>
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>入点</label>
                    <input
                      className={styles.input}
                      type="number"
                      step="0.1"
                      min="0"
                      value={range.inPoint.toFixed(2)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0 && val < range.outPoint) {
                          onUpdateTimeRange(range.id, { inPoint: val });
                        }
                      }}
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>出点</label>
                    <input
                      className={styles.input}
                      type="number"
                      step="0.1"
                      min="0"
                      value={range.outPoint.toFixed(2)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val > range.inPoint) {
                          onUpdateTimeRange(range.id, { outPoint: val });
                        }
                      }}
                    />
                  </div>
                  <div className={styles.row}>
                    <label className={styles.label}>时长</label>
                    <span className={styles.value}>{formatTime(range.outPoint - range.inPoint)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const duration = clipDuration(clip);

  return (
    <div className={styles.inspector} style={style}>
      <div className={styles.header}>
        <span className={styles.title}>片段属性</span>
      </div>
      <div className={styles.content}>
        <div className={styles.clipName}>{clip.name}</div>
        <div className={styles.trackBadge}>{track.type === "video" ? "视频" : "音频"}</div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>源</div>
          <div className={styles.row}>
            <label className={styles.label}>入点</label>
            <input
              className={styles.input}
              type="number"
              step="0.1"
              min="0"
              max={clip.end}
              value={clip.start}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0 && val < clip.end) {
                  onTrimClip(track.id, clip.id, val, clip.end);
                }
              }}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label}>出点</label>
            <input
              className={styles.input}
              type="number"
              step="0.1"
              min={clip.start}
              value={clip.end}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > clip.start) {
                  onTrimClip(track.id, clip.id, clip.start, val);
                }
              }}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label}>时长</label>
            <span className={styles.value}>{formatTime(duration)}</span>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>时间线</div>
          <div className={styles.row}>
            <label className={styles.label}>位置</label>
            <input
              className={styles.input}
              type="number"
              step="0.1"
              min="0"
              value={clip.timelineStart}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) {
                  onMoveClip(track.id, clip.id, val);
                }
              }}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.label}>结束</label>
            <span className={styles.value}>{formatTime(clip.timelineStart + duration)}</span>
          </div>
        </div>

        {track.type === "video" && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>音频</div>
            <div className={styles.row}>
              <label className={styles.label}>原声</label>
              <button
                className={`${styles.toggleBtn} ${clip.audioEnabled !== false ? styles.toggleBtnOn : ""}`}
                onClick={() => onToggleClipAudio(track.id, clip.id)}
              >
                {clip.audioEnabled !== false ? "开" : "关"}
              </button>
            </div>
          </div>
        )}

        {track.type === "audio" && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>音量</div>
            <div className={styles.row}>
              <label className={styles.label}>
                增益
                <span className={styles.helpHint} title="0 = 静音；1.0 = 原始音量；2.0 ≈ +6 dB；最大 4.0 ≈ +12 dB。预览时受浏览器限制最高为 1.0，导出按实际值生效。">?</span>
              </label>
              <input
                className={styles.input}
                type="range"
                min="0"
                max="4"
                step="0.05"
                value={clip.volume ?? 1}
                onChange={(e) => onSetClipVolume(track.id, clip.id, parseFloat(e.target.value))}
              />
            </div>
            <div className={styles.row}>
              <label className={styles.label}>数值</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                max="4"
                step="0.05"
                value={Number((clip.volume ?? 1).toFixed(2))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) onSetClipVolume(track.id, clip.id, val);
                }}
              />
            </div>
            <div className={styles.row}>
              <button
                className={styles.toggleBtn}
                onClick={() => onSetClipVolume(track.id, clip.id, 1)}
                title="重置为 1.0（原始音量）"
              >
                重置 1.0
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
