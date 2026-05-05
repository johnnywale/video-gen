import { useState } from "react";
import { useTopicsStore } from "../../store/topicsStore";
import { validateTopic, DEFAULT_PROMPT_TEMPLATE } from "@/domain/topics/topic";
import styles from "./TopicsManagerModal.module.css";

interface Props {
  onClose: () => void;
}

export function TopicsManagerModal({ onClose }: Props) {
  const topics = useTopicsStore((s) => s.topics);
  const upsert = useTopicsStore((s) => s.upsert);
  const remove = useTopicsStore((s) => s.remove);

  const [newName, setNewName] = useState("");
  const [newTheme, setNewTheme] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newError, setNewError] = useState<string | null>(null);

  const handleAdd = () => {
    const err = validateTopic(newName, newTheme);
    if (err) {
      setNewError(err);
      return;
    }
    upsert({
      name: newName.trim(),
      theme: newTheme.trim(),
      prompt: newPrompt.trim() || undefined,
    });
    setNewName("");
    setNewTheme("");
    setNewPrompt("");
    setNewError(null);
  };

  const handleEdit = (
    id: string,
    field: "name" | "theme" | "prompt",
    value: string
  ) => {
    const t = topics.find((t) => t.id === id);
    if (!t) return;
    if (field === "prompt") {
      // Empty prompt clears the override (falls back to default).
      upsert({ ...t, prompt: value.trim() || undefined });
    } else {
      upsert({ ...t, [field]: value });
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>主题管理</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.help}>
            可为每个主题设置自定义 prompt（可选）。占位符 <code>{"{topic}"}</code> 会被替换为「主题」字段，<code>{"{count}"}</code> 会被替换为分段数。留空则使用默认模板。
          </div>

          {topics.length === 0 ? (
            <div className={styles.empty}>暂无主题，请在下方添加。</div>
          ) : (
            <div className={styles.list}>
              {topics.map((t) => (
                <div key={t.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <input
                      className={styles.nameInput}
                      type="text"
                      value={t.name}
                      placeholder="名称"
                      onChange={(e) => handleEdit(t.id, "name", e.target.value)}
                    />
                    <input
                      className={styles.themeInput}
                      type="text"
                      value={t.theme}
                      placeholder="主题（用于 AI 生成）"
                      onChange={(e) => handleEdit(t.id, "theme", e.target.value)}
                    />
                    <button
                      className={`${styles.iconBtn} ${styles.dangerBtn}`}
                      onClick={() => {
                        if (confirm(`确认删除主题"${t.name}"？`)) remove(t.id);
                      }}
                      title="删除"
                    >
                      删除
                    </button>
                  </div>
                  <div className={styles.promptRow}>
                    <textarea
                      className={styles.promptInput}
                      rows={4}
                      value={t.prompt ?? ""}
                      placeholder={`留空使用默认模板：\n${DEFAULT_PROMPT_TEMPLATE}`}
                      onChange={(e) => handleEdit(t.id, "prompt", e.target.value)}
                    />
                    {t.prompt && (
                      <button
                        className={styles.iconBtn}
                        onClick={() => handleEdit(t.id, "prompt", "")}
                        title="重置为默认 prompt"
                      >
                        重置
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.addCard}>
            <div className={styles.addRow}>
              <input
                className={styles.nameInput}
                type="text"
                value={newName}
                placeholder="名称"
                onChange={(e) => { setNewName(e.target.value); setNewError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd(); }}
              />
              <input
                className={styles.themeInput}
                type="text"
                value={newTheme}
                placeholder="主题"
                onChange={(e) => { setNewTheme(e.target.value); setNewError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd(); }}
              />
              <button className={styles.primaryBtn} onClick={handleAdd}>+ 添加</button>
            </div>
            <textarea
              className={styles.promptInput}
              rows={3}
              value={newPrompt}
              placeholder="可选：自定义 prompt 模板（留空使用默认）"
              onChange={(e) => setNewPrompt(e.target.value)}
            />
          </div>
          {newError && <div className={styles.error}>{newError}</div>}
        </div>

        <div className={styles.footer}>
          <button className={styles.secondaryBtn} onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
