import { useState } from "react";
import { useTextStylesStore } from "../../store/textStylesStore";
import { TextStylePosition, validateTextStyle } from "@/domain/captions/textStyle";
import styles from "./TextStylesPanel.module.css";

/**
 * Manage text-overlay styles. Built-ins are read-only — user can only
 * inspect them. Custom styles can be added (and later edited / deleted).
 * Each style picks up automatically in the per-stage 样式 dropdown.
 */
export function TextStylesPanel() {
  const list = useTextStylesStore((s) => s.styles);
  const add = useTextStylesStore((s) => s.add);
  const remove = useTextStylesStore((s) => s.remove);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#FFD700");
  const [position, setPosition] = useState<TextStylePosition>("bottom");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setColor("#FFD700");
    setPosition("bottom");
    setError(null);
    setShowForm(false);
  };

  const handleAdd = () => {
    const trimmed = name.trim();
    const err = validateTextStyle(trimmed, color);
    if (err) {
      setError(err);
      return;
    }
    add({ name: trimmed, color, position });
    reset();
  };

  const handleRemove = (id: string, label: string) => {
    if (window.confirm(`删除文字样式 "${label}"？已使用此样式的分段会回退到默认样式。`)) {
      remove(id);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>文字样式</span>
        <button
          className={styles.addBtn}
          onClick={() => setShowForm((v) => !v)}
          title={showForm ? "取消" : "新建样式"}
        >
          {showForm ? "×" : "+"}
        </button>
      </div>

      {showForm && (
        <div className={styles.form}>
          <div className={styles.formRow}>
            <label>名称</label>
            <input
              type="text"
              value={name}
              maxLength={60}
              placeholder="如：橙色（顶部）"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className={styles.formRow}>
            <label>颜色</label>
            <div className={styles.colorRow}>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                aria-label="颜色选择"
              />
              <input
                type="text"
                className={styles.colorHex}
                value={color}
                maxLength={7}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#RRGGBB"
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <label>位置</label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as TextStylePosition)}
            >
              <option value="bottom">底部</option>
              <option value="center">中部</option>
              <option value="top">顶部</option>
            </select>
          </div>
          {error && <div className={styles.formError}>{error}</div>}
          <div className={styles.formActions}>
            <button className={styles.btnSecondary} onClick={reset}>取消</button>
            <button className={styles.btnPrimary} onClick={handleAdd}>保存</button>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {list.map((s) => (
          <div key={s.id} className={styles.item}>
            <span
              className={styles.swatch}
              style={{ background: s.color }}
              aria-label={`color ${s.color}`}
            />
            <div className={styles.info}>
              <span className={styles.name}>{s.name}</span>
              <span className={styles.meta}>
                {s.color} · {s.position === "top" ? "顶部" : s.position === "center" ? "中部" : "底部"}
                {s.builtin ? " · 内置" : ""}
              </span>
            </div>
            {!s.builtin && (
              <button
                className={styles.removeBtn}
                onClick={() => handleRemove(s.id, s.name)}
                title="删除"
                aria-label="删除"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
