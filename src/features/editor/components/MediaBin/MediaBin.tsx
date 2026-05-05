import { useState, useMemo, useEffect, useRef, type CSSProperties } from "react";
import { MediaFile } from "@/domain/timeline/models";
import { useEditorStore } from "../../store/editorStore";
import { SidebarTabs, type TabId } from "./SidebarTabs";
import { AIAudioModal } from "../AIAudio/AIAudioModal";
import { TransitionsLibrary } from "../Transitions/TransitionsLibrary";
import { TextStylesPanel } from "../TextStyles/TextStylesPanel";
import styles from "./MediaBin.module.css";

interface Props {
  mediaFiles: MediaFile[];
  onAddToTimeline: (mediaFileId: string) => void;
  onImport: () => void;
  style?: CSSProperties;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function tabForFile(f: MediaFile): TabId {
  return f.hasVideo ? "media" : "audio";
}

export function MediaBin({ mediaFiles, onAddToTimeline, onImport, style }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("media");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [aiAudioOpen, setAiAudioOpen] = useState(false);
  const setDraggingMediaId = useEditorStore((s) => s.setDraggingMediaId);
  const selectedAudioId = useEditorStore((s) => s.selectedAudioMediaId);
  const selectAudioMedia = useEditorStore((s) => s.selectAudioMedia);
  const removeMediaFile = useEditorStore((s) => s.removeMediaFile);

  const handleRemove = (file: MediaFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`从素材库移除 "${file.name}"？时间线上已添加的片段不会被删除。`)) {
      removeMediaFile(file.id);
    }
  };

  // Auto-switch the active tab to match the most recently added file's type.
  // Without this, importing an mp3 while on the Media (video) tab would make
  // the file invisible — it lands in the audio bucket but the user is
  // looking at the video bucket.
  const prevCount = useRef(mediaFiles.length);
  useEffect(() => {
    if (mediaFiles.length > prevCount.current) {
      const newest = mediaFiles[mediaFiles.length - 1];
      const targetTab = tabForFile(newest);
      if (targetTab === "media" || targetTab === "audio") {
        setActiveTab(targetTab);
      }
    }
    prevCount.current = mediaFiles.length;
  }, [mediaFiles]);

  // Filter by tab, then by search query.
  const filtered = useMemo(() => {
    let list: MediaFile[] = mediaFiles;
    if (activeTab === "media") list = list.filter((f) => f.hasVideo);
    else if (activeTab === "audio") list = list.filter((f) => !f.hasVideo);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return list;
  }, [mediaFiles, activeTab, searchQuery]);

  const isMediaListTab = activeTab === "media" || activeTab === "audio";

  return (
    <div className={styles.mediaBin} style={style}>
      <SidebarTabs activeTab={activeTab} onTabChange={setActiveTab} />
      <div className={styles.tabContent}>
        {isMediaListTab ? (
          <>
            <div className={styles.header}>
              <span className={styles.title}>{activeTab === "audio" ? "音频" : "素材"}</span>
              <div className={styles.headerActions}>
                <button
                  className={`${styles.viewToggle} ${viewMode === "list" ? styles.viewToggleActive : ""}`}
                  onClick={() => setViewMode("list")}
                  aria-label="列表视图"
                  title="列表视图"
                >
                  &#x2630;
                </button>
                <button
                  className={`${styles.viewToggle} ${viewMode === "grid" ? styles.viewToggleActive : ""}`}
                  onClick={() => setViewMode("grid")}
                  aria-label="网格视图"
                  title="网格视图"
                >
                  &#x25A6;
                </button>
                {activeTab === "audio" && (
                  <button
                    className={styles.importBtn}
                    onClick={() => setAiAudioOpen(true)}
                    aria-label="AI 背景音乐生成"
                    title="AI 背景音乐生成（纯器乐，无人声）"
                    style={{ borderColor: "rgba(102, 117, 255, 0.6)", color: "var(--color-accent)" }}
                  >
                    ✨
                  </button>
                )}
                <button className={styles.importBtn} onClick={onImport} aria-label="导入素材">
                  +
                </button>
              </div>
            </div>
            <div className={styles.searchBar}>
              <div className={styles.searchInputWrap}>
                <input
                  className={styles.searchInput}
                  type="text"
                  placeholder="搜索素材..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className={viewMode === "grid" ? styles.grid : styles.list}>
              {filtered.length === 0 ? (
                <div className={styles.empty}>
                  {mediaFiles.length === 0 ? (
                    <>
                      <p>暂无导入素材</p>
                      <p className={styles.hint}>点击右上角导入或将文件拖入</p>
                    </>
                  ) : (
                    <p>未找到与 &ldquo;{searchQuery}&rdquo; 匹配的内容</p>
                  )}
                </div>
              ) : viewMode === "list" ? (
                filtered.map((file) => (
                  <div
                    key={file.id}
                    className={`${styles.item} ${selectedAudioId === file.id ? styles.itemSelected : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-media-id", file.id);
                      e.dataTransfer.effectAllowed = "copy";
                      setDraggingMediaId(file.id);
                    }}
                    onDragEnd={() => setDraggingMediaId(null)}
                    onClick={() => {
                      if (!file.hasVideo) {
                        // Audio-only file → toggle selection.
                        selectAudioMedia(selectedAudioId === file.id ? null : file.id);
                      }
                    }}
                    onDoubleClick={() => onAddToTimeline(file.id)}
                    title={file.hasVideo ? "拖至时间线或双击添加" : "单击选中（用于自动分段背景音）· 双击添加到时间线"}
                  >
                    <div className={styles.thumb}>
                      {file.hasVideo ? (
                        <video src={file.src} className={styles.thumbVideo} muted preload="metadata" />
                      ) : (
                        <div className={styles.audioThumb}>&#9835;</div>
                      )}
                    </div>
                    <div className={styles.info}>
                      <span className={styles.fileName}>{file.name}</span>
                      <span className={styles.meta}>
                        {formatDuration(file.duration)}
                        {file.width && file.height ? ` \u00B7 ${file.width}x${file.height}` : ""}
                      </span>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => handleRemove(file, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                      aria-label="\u79FB\u9664"
                      title="\u4ECE\u7D20\u6750\u5E93\u79FB\u9664"
                    >
                      &times;
                    </button>
                  </div>
                ))
              ) : (
                filtered.map((file) => (
                  <div
                    key={file.id}
                    className={styles.gridItem}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-media-id", file.id);
                      e.dataTransfer.effectAllowed = "copy";
                      setDraggingMediaId(file.id);
                    }}
                    onDragEnd={() => setDraggingMediaId(null)}
                    onDoubleClick={() => onAddToTimeline(file.id)}
                    title={`${file.name}（双击添加到时间线）`}
                  >
                    <div className={styles.gridThumb}>
                      {file.hasVideo ? (
                        <video src={file.src} className={styles.thumbVideo} muted preload="metadata" />
                      ) : (
                        <div className={styles.audioThumb}>&#9835;</div>
                      )}
                      <span className={styles.gridDuration}>{formatDuration(file.duration)}</span>
                      <button
                        className={styles.deleteBtn}
                        onClick={(e) => handleRemove(file, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => e.preventDefault()}
                        aria-label="移除"
                        title="从素材库移除"
                      >
                        &times;
                      </button>
                    </div>
                    <span className={styles.gridName}>{file.name}</span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : activeTab === "transitions" ? (
          <TransitionsLibrary />
        ) : activeTab === "text" ? (
          <TextStylesPanel />
        ) : (
          <div className={styles.comingSoon}>
            <span className={styles.comingSoonLabel}>{activeTab}</span>
            <p>Coming Soon</p>
          </div>
        )}
      </div>
      {aiAudioOpen && <AIAudioModal onClose={() => setAiAudioOpen(false)} />}
    </div>
  );
}
