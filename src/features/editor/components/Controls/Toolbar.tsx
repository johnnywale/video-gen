import { useState, useEffect } from "react";
import { RenderState } from "../../hooks/useEditor";
import { saveFilePicker, openPath } from "@/infrastructure/tauri/commands";
import styles from "./Controls.module.css";

interface Props {
  onRender: () => void;
  onOpenAutoStage: () => void;
  onOpenSettings: () => void;
  renderState: RenderState;
  outputPath: string;
  onSetOutputPath: (path: string) => void;
}

export function Toolbar({ onRender, onOpenAutoStage, onOpenSettings, renderState, outputPath, onSetOutputPath }: Props) {
  // (#17) Editable project name. Persists in component state for now —
  // a real "project model" lives in the timeline store; we can wire it
  // there in a follow-up.
  const [projectName, setProjectName] = useState("未命名项目");
  const [isEditingName, setIsEditingName] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Show a success banner for ~6 s after a render completes; the auto-open
  // hook in useEditor already kicks off the OS default player.
  useEffect(() => {
    if (!renderState.lastOutputPath || renderState.isRendering) return;
    setShowSuccess(true);
    const t = setTimeout(() => setShowSuccess(false), 6000);
    return () => clearTimeout(t);
  }, [renderState.lastOutputPath, renderState.isRendering]);

  const handleBrowse = async () => {
    try {
      const dir = outputPath ? outputPath.replace(/[\\/][^\\/]*$/, "") : undefined;
      const name = outputPath ? outputPath.split(/[\\/]/).pop() : "output.mp4";
      const picked = await saveFilePicker({ defaultPath: dir, defaultName: name });
      if (picked) onSetOutputPath(picked);
    } catch (e) {
      console.error("save dialog failed:", e);
    }
  };

  return (
    <div className={styles.toolbar}>
      {/* (#1/15) Logo with explicit divider so it doesn't visually glue to
          the next button. */}
      <div className={styles.brand} title="视频剪辑">
        <span className={styles.brandMark}>VE</span>
        <span>视频剪辑</span>
      </div>

      <div className={styles.toolbarGroup}>
        <button className={styles.btnSecondary} onClick={onOpenAutoStage} aria-label="自动分段" title="自动从源视频中抽取片段并生成时间线">
          ✨ 自动分段
        </button>
      </div>

      {/* (#7/16/17) Centered project name — clickable to rename. */}
      <div className={styles.projectName}>
        {isEditingName ? (
          <input
            className={styles.pathInput}
            style={{ width: 220, fontFamily: "inherit" }}
            value={projectName}
            autoFocus
            onChange={(e) => setProjectName(e.target.value)}
            onBlur={() => setIsEditingName(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setIsEditingName(false); }}
          />
        ) : (
          <span
            className={styles.projectNameLabel}
            onClick={() => setIsEditingName(true)}
            title="点击重命名项目"
          >
            {projectName}
          </span>
        )}
        <span className={styles.saveBadge}>已自动保存</span>
      </div>

      <div className={styles.toolbarGroup}>
        <span className={styles.pathInputWrap}>
          <input
            className={styles.pathInput}
            value={outputPath}
            onChange={(e) => onSetOutputPath(e.target.value)}
            placeholder="输出文件路径"
            aria-label="输出文件路径"
          />
          <button
            className={styles.pathPickerBtn}
            onClick={handleBrowse}
            aria-label="选择导出位置"
            title="选择导出位置"
          >
            📁
          </button>
        </span>
        <button
          className={`${styles.btn} ${styles.btnRender}`}
          onClick={onRender}
          disabled={renderState.isRendering}
          aria-label={renderState.isRendering ? "导出中" : "导出视频"}
        >
          {renderState.isRendering
            ? `导出中… ${Math.round(renderState.progress)}%`
            : "导出"}
        </button>
        {/* (#18) Settings now lives at the far right — the global-settings
            convention most apps follow. */}
        <button
          className={styles.btnSecondary}
          onClick={onOpenSettings}
          aria-label="全局设置"
          title="全局设置（API 密钥）"
          style={{ padding: "6px 10px" }}
        >
          ⚙
        </button>
      </div>

      {renderState.error && (
        <div className={styles.error} role="alert">{renderState.error}</div>
      )}

      {showSuccess && renderState.lastOutputPath && (
        <div className={styles.success} role="status">
          <span className={styles.successIcon}>✓</span>
          <span>导出完成</span>
          <code className={styles.successPath}>{renderState.lastOutputPath}</code>
          <button
            type="button"
            className={styles.successAction}
            onClick={() => openPath(renderState.lastOutputPath!).catch(() => {})}
          >
            打开
          </button>
          <button
            type="button"
            className={styles.successDismiss}
            onClick={() => setShowSuccess(false)}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
