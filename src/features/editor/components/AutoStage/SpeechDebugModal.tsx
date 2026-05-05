import { useEffect } from "react";
import type { SpeechError } from "@/infrastructure/tauri/commands";
import styles from "./SpeechDebugModal.module.css";

interface Props {
  failure: SpeechError;
  /** Optional context — which stage failed, what text/voice was sent. */
  stageLabel?: string;
  text?: string;
  voiceId?: string;
  onClose: () => void;
}

/** Try to pretty-print a JSON string; return original on parse failure. */
function tryPrettyJson(raw: string): string {
  try {
    const v = JSON.parse(raw);
    return JSON.stringify(v, null, 2);
  } catch {
    return raw;
  }
}

export function SpeechDebugModal({ failure, stageLabel, text, voiceId, onClose }: Props) {
  // Esc closes — handled here so the AutoStage panel's Esc handler doesn't
  // also fire and close both modals at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const copy = (s: string) => {
    navigator.clipboard?.writeText(s).catch(() => {});
  };

  const responsePretty = failure.response_body
    ? tryPrettyJson(failure.response_body)
    : null;

  return (
    <div className={styles.backdrop} onClick={handleBackdrop}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>配音生成调试</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className={styles.body}>
          <div className={styles.message}>{failure.message}</div>

          <div className={styles.metaRow}>
            {stageLabel && <span>· {stageLabel}</span>}
            {voiceId && <span>· voice <code>{voiceId}</code></span>}
            {failure.endpoint && <span>· <code>POST {failure.endpoint}</code></span>}
            {failure.status !== null && (
              <span>
                · HTTP{" "}
                <code className={failure.status >= 200 && failure.status < 300 ? styles.statusOk : styles.statusBad}>
                  {failure.status}
                </code>
              </span>
            )}
          </div>

          {text && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Text</span>
                <button className={styles.copyBtn} onClick={() => copy(text)}>复制</button>
              </div>
              <pre className={styles.code}>{text}</pre>
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Request body</span>
              <button className={styles.copyBtn} onClick={() => copy(failure.request_body)}>复制</button>
            </div>
            {failure.request_body
              ? <pre className={styles.code}>{failure.request_body}</pre>
              : <span className={styles.empty}>（请求未发出）</span>
            }
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionLabel}>Response body</span>
              {responsePretty && (
                <button className={styles.copyBtn} onClick={() => copy(responsePretty)}>复制</button>
              )}
            </div>
            {responsePretty
              ? <pre className={styles.code}>{responsePretty}</pre>
              : <span className={styles.empty}>（无响应 — 传输错误或未到达服务器）</span>
            }
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.copyBtn} onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
