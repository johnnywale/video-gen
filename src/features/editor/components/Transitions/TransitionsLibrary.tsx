import { useEditorStore } from "../../store/editorStore";
import { TransitionType } from "@/domain/timeline/models";
import styles from "./TransitionsLibrary.module.css";

interface Option {
  id: TransitionType;
  label: string;
  visualClass: string;
}

const OPTIONS: Option[] = [
  { id: "none",        label: "无", visualClass: styles.visualNone },
  { id: "fade",        label: "淡入淡出", visualClass: styles.visualFade },
  { id: "fadeblack",   label: "淡入黑场", visualClass: styles.visualFadeBlack },
  { id: "fadewhite",   label: "淡入白场", visualClass: styles.visualFadeWhite },
  { id: "dissolve",    label: "溶解", visualClass: styles.visualDissolve },
  { id: "wipeleft",    label: "向左擦除", visualClass: styles.visualWipeleft },
  { id: "wiperight",   label: "向右擦除", visualClass: styles.visualWiperight },
  { id: "wipeup",      label: "向上擦除", visualClass: styles.visualWipeup },
  { id: "wipedown",    label: "向下擦除", visualClass: styles.visualWipedown },
  { id: "slideleft",   label: "向左滑动", visualClass: styles.visualSlideleft },
  { id: "slideright",  label: "向右滑动", visualClass: styles.visualSlideright },
  { id: "slideup",     label: "向上滑动", visualClass: styles.visualSlideup },
  { id: "slidedown",   label: "向下滑动", visualClass: styles.visualSlidedown },
  { id: "circleopen",  label: "圆形展开", visualClass: styles.visualCircleopen },
  { id: "circleclose", label: "圆形收拢", visualClass: styles.visualCircleclose },
  { id: "radial",      label: "径向擦除", visualClass: styles.visualRadial },
  { id: "zoomin",      label: "放大进入", visualClass: styles.visualZoomin },
];

export function TransitionsLibrary() {
  const settings = useEditorStore((s) => s.projectSettings);
  const updateSettings = useEditorStore((s) => s.updateProjectSettings);

  // Defensive fallbacks: a project persisted before transitionType existed
  // will have undefined fields here. Treat them as "none" / 1.0 so the UI
  // renders cleanly instead of throwing on .toFixed().
  const current: TransitionType = settings.transitionType ?? "none";
  const duration: number = typeof settings.transitionDuration === "number"
    ? settings.transitionDuration
    : 1.0;
  const currentLabel = OPTIONS.find((o) => o.id === current)?.label ?? "无";

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>转场效果</span>
        <span className={styles.subtitle}>导出时应用于同一视频轨上相邻片段</span>
      </div>

      <div className={styles.body}>
        <div className={styles.summary}>
          当前选择：<strong>{currentLabel}</strong>
          {current !== "none" && (
            <> · 时长 <strong>{duration.toFixed(2)} 秒</strong></>
          )}
        </div>

        {current !== "none" && (
          <div className={styles.durationSection}>
            <div className={styles.durationLabel}>
              <span>转场时长</span>
              <span className={styles.durationValue}>{duration.toFixed(2)} 秒</span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={0.1}
              max={3}
              step={0.05}
              value={duration}
              onChange={(e) => updateSettings({ transitionDuration: Number(e.target.value) })}
            />
          </div>
        )}

        <div className={styles.grid}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`${styles.card} ${opt.visualClass} ${current === opt.id ? styles.active : ""}`}
              onClick={() => updateSettings({ transitionType: opt.id })}
              title={`使用「${opt.label}」转场`}
            >
              <div className={styles.visual} />
              <span className={styles.cardName}>{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
