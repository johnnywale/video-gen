import { useState, useEffect } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { aiDiagnoseMiniMax, defaultSpeechCacheDir, openPath } from "@/infrastructure/tauri/commands";
import styles from "./SettingsPanel.module.css";

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [showKey, setShowKey] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<string | null>(null);
  // The backend's default cache dir, surfaced as a placeholder so the
  // user can see what they'd be overriding without us having to bake
  // platform paths into the frontend.
  const [defaultCacheDir, setDefaultCacheDir] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    defaultSpeechCacheDir()
      .then((p) => { if (!cancelled) setDefaultCacheDir(p); })
      .catch(() => { /* tolerate older backends */ });
    return () => { cancelled = true; };
  }, []);

  const handleTestConnection = async () => {
    setDiagBusy(true);
    setDiagResult(null);
    try {
      const out = await aiDiagnoseMiniMax(settings.litellmApiKey);
      setDiagResult(out);
    } catch (e) {
      setDiagResult(String(e));
    } finally {
      setDiagBusy(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>设置</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.warning}>
            API 密钥保存在本机浏览器的本地存储中。可访问该用户账号的人都能读取这些数据。请勿粘贴敏感密钥。
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>API 密钥</span>
            <div className={styles.field}>
              <input
                type={showKey ? "text" : "password"}
                value={settings.litellmApiKey}
                placeholder="sk-..."
                onChange={(e) => setSettings({ litellmApiKey: e.target.value })}
                onFocus={() => setShowKey(true)}
                onBlur={() => setShowKey(false)}
              />
            </div>
            <div className={styles.field}>
              <button
                className={styles.secondaryBtn}
                onClick={handleTestConnection}
                disabled={diagBusy || !settings.litellmApiKey.trim()}
                style={{ alignSelf: "flex-start" }}
                type="button"
              >
                {diagBusy ? "测试中…" : "测试连接"}
              </button>
              {diagResult && (
                <pre style={{
                  marginTop: 8,
                  padding: 10,
                  background: "var(--color-surface-deep)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  maxHeight: 240,
                  overflow: "auto",
                }}>
                  {diagResult}
                </pre>
              )}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionTitle}>配音缓存</span>
            <span className={styles.help}>
              生成的 TTS mp3 文件将写入此目录，下次相同 (文字, 音色) 的请求会直接命中缓存。
              留空使用默认路径（位于应用数据目录），重启系统后仍可访问。
            </span>
            <div className={styles.field}>
              <label>缓存目录</label>
              <input
                type="text"
                value={settings.speechCacheDir}
                placeholder={defaultCacheDir || "（默认）"}
                onChange={(e) => setSettings({ speechCacheDir: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <button
                className={styles.secondaryBtn}
                onClick={() => {
                  const target = settings.speechCacheDir.trim() || defaultCacheDir;
                  if (target) openPath(target).catch(() => { /* dir may not exist yet */ });
                }}
                disabled={!settings.speechCacheDir.trim() && !defaultCacheDir}
                style={{ alignSelf: "flex-start" }}
                type="button"
              >
                打开当前目录
              </button>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.dangerBtn}
            onClick={() => {
              if (confirm("确认清除所有已保存的 API 密钥？")) resetSettings();
            }}
          >
            重置
          </button>
          <div className={styles.footerActions}>
            <button className={styles.secondaryBtn} onClick={onClose}>取消</button>
            <button className={styles.primaryBtn} onClick={onClose}>完成</button>
          </div>
        </div>
      </div>
    </div>
  );
}
