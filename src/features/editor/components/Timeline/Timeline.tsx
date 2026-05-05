import React, { useRef, useState, useCallback, useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { Track } from "./Track";
import { clipDuration } from "@/domain/timeline/clip";
import { PIXELS_PER_SECOND, MIN_TIMELINE_DURATION } from "@/shared/constants";
import styles from "./Timeline.module.css";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 5;

export function Timeline() {
  const { timeline, playheadPosition, setPlayheadPosition, snapLine, undo, redo, deleteSelectedClip, selectedClipId, timeRanges, markingInPoint, setMarkingInPoint, addTimeRange } = useEditorStore();
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [scrollAreaWidth, setScrollAreaWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Observe the visible width of the scrollable area so we can compute a
  // zoom that fits the entire timeline into view.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const measure = () => setScrollAreaWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = PIXELS_PER_SECOND * zoom;
  const totalDuration = Math.max(timeline.duration + 10, MIN_TIMELINE_DURATION);
  const totalWidth = totalDuration * pps;

  // Auto-compress: when content (timeline duration + playhead) would overflow
  // the visible scroll area at the current zoom, scale zoom down to fit.
  // The track header column is part of scrollAreaWidth — subtract a rough
  // estimate so the remaining track-body area fits the content.
  useEffect(() => {
    if (!autoFit || scrollAreaWidth <= 0) return;
    const TRACK_HEADER_PX = 80;
    const usable = Math.max(100, scrollAreaWidth - TRACK_HEADER_PX);
    const required = Math.max(timeline.duration + 1, MIN_TIMELINE_DURATION, playheadPosition + 1);
    const fitZoom = usable / (required * PIXELS_PER_SECOND);
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom));
    setZoom((cur) => (Math.abs(cur - clamped) < 1e-4 ? cur : clamped));
  }, [autoFit, scrollAreaWidth, timeline.duration, playheadPosition]);

  const posFromEvent = useCallback((clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clientX - rect.left;
    return Math.max(0, x / pps);
  }, [pps]);

  const handleRulerMouseDown = useCallback((e: React.MouseEvent) => {
    setPlayheadPosition(posFromEvent(e.clientX));
    setIsScrubbing(true);
  }, [posFromEvent, setPlayheadPosition]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMove = (e: MouseEvent) => setPlayheadPosition(posFromEvent(e.clientX));
    const handleUp = () => setIsScrubbing(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isScrubbing, posFromEvent, setPlayheadPosition]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setAutoFit(false);
      setZoom((prev) => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * delta));
      });
    }
  }, []);

  const handleSplitAtPlayhead = useCallback(() => {
    const state = useEditorStore.getState();
    for (const track of state.timeline.tracks) {
      for (const clip of track.clips) {
        const end = clip.timelineStart + clipDuration(clip);
        if (state.playheadPosition > clip.timelineStart && state.playheadPosition < end) {
          state.splitClipAtPlayhead(track.id, clip.id);
          return;
        }
      }
    }
  }, []);

  // Smart tick interval: adapts to both zoom and total duration
  // Cap at ~200 ticks max for DOM performance
  const MAX_TICKS = 200;
  const niceIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const minIntervalFromDuration = totalDuration / MAX_TICKS;
  const minIntervalFromPixels = Math.max(40, Math.min(120, pps * 5)) / pps;
  const rawInterval = Math.max(minIntervalFromDuration, minIntervalFromPixels);
  const tickInterval = niceIntervals.find((n) => n >= rawInterval) ?? 7200;

  const ticks: number[] = [];
  for (let i = 0; i <= totalDuration; i += tickInterval) ticks.push(i);
  // (#39) Major ticks every 5th interval — they get a longer line + label,
  // minor ticks are shorter (controlled by .tick vs .tickMajor classes).
  const majorEvery = 5;

  return (
    <div className={styles.timelineContainer} onWheel={handleWheel}>
      {/* Toolbar */}
      <div className={styles.zoomBar}>
        <button className={styles.zoomBtn} onClick={undo} aria-label="撤销" title="撤销 (Ctrl+Z)">
          &#x21A9;
        </button>
        <button className={styles.zoomBtn} onClick={redo} aria-label="重做" title="重做 (Ctrl+Shift+Z)">
          &#x21AA;
        </button>
        <div className={styles.zoomSeparator} />
        <button className={styles.zoomBtn} onClick={handleSplitAtPlayhead} aria-label="分割片段" title="在播放头处分割 (Ctrl+B)">
          &#x2702;
        </button>
        <button className={styles.zoomBtn} onClick={deleteSelectedClip} disabled={!selectedClipId} aria-label="删除选中" title="删除选中片段 (Del)">
          &#x1F5D1;
        </button>
        <div className={styles.zoomSeparator} />
        <button
          className={`${styles.zoomBtn} ${markingInPoint !== null ? styles.zoomBtnActive : ""}`}
          onClick={() => {
            if (markingInPoint !== null) {
              setMarkingInPoint(null); // cancel
            } else {
              setMarkingInPoint(playheadPosition);
            }
          }}
          aria-label="标记入点"
          title="标记入点 (I)"
        >
          I
        </button>
        <button
          className={styles.zoomBtn}
          onClick={() => {
            if (markingInPoint !== null) {
              addTimeRange(markingInPoint, playheadPosition);
              setMarkingInPoint(null);
            }
          }}
          disabled={markingInPoint === null}
          aria-label="标记出点"
          title="标记出点 (O)"
        >
          O
        </button>
        <div className={styles.zoomSeparator} />
        <button className={styles.zoomBtn} onClick={() => { setAutoFit(false); setZoom((z) => Math.max(MIN_ZOOM, z * 0.8)); }} aria-label="缩小">
          &minus;
        </button>
        {/* (#34) Logarithmic zoom slider — thick track + large handle.
            Linear position [0,1] maps to zoom in [MIN_ZOOM, MAX_ZOOM] via
            an exponential so the slider feels uniform across orders of
            magnitude (0.02× ↔ 5× spans 8 doublings). */}
        <input
          type="range"
          className={styles.zoomSlider}
          min={0}
          max={1}
          step={0.001}
          value={Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)}
          onChange={(e) => {
            const t = Number(e.target.value);
            const z = MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, t);
            setAutoFit(false);
            setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)));
          }}
          aria-label="时间线缩放"
          title={`缩放 ${Math.round(zoom * 100)}%`}
        />
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%{autoFit ? " · 适配" : ""}</span>
        <button className={styles.zoomBtn} onClick={() => { setAutoFit(false); setZoom((z) => Math.min(MAX_ZOOM, z * 1.25)); }} aria-label="放大">
          +
        </button>
        <button
          className={`${styles.zoomBtn} ${autoFit ? styles.zoomBtnActive : ""}`}
          onClick={() => setAutoFit(true)}
          aria-label="适配视口"
          title="自动适配时间线宽度"
        >
          适配
        </button>
      </div>

      {/* Scrollable area for ruler + tracks */}
      <div className={styles.scrollArea} ref={scrollAreaRef}>
        {/* Ruler */}
        <div className={styles.rulerRow}>
          <div className={styles.trackHeaderSpacer} />
          <div
            className={styles.ruler}
            ref={rulerRef}
            style={{ width: totalWidth }}
            onMouseDown={handleRulerMouseDown}
          >
            {ticks.map((t, i) => {
              const isMajor = i % majorEvery === 0;
              return (
                <div
                  key={t}
                  className={`${styles.tick} ${isMajor ? styles.tickMajor : ""}`}
                  style={{ left: t * pps }}
                >
                  {isMajor && <span className={styles.tickLabel}>{formatTime(t)}</span>}
                </div>
              );
            })}
            {/* Time range markers */}
            {timeRanges.map((range) => (
              <div
                key={range.id}
                className={styles.timeRange}
                style={{
                  left: range.inPoint * pps,
                  width: (range.outPoint - range.inPoint) * pps,
                  backgroundColor: range.color,
                }}
                title={`${range.label}: ${formatTime(range.inPoint)} - ${formatTime(range.outPoint)}`}
              />
            ))}
            {/* In-point marker while marking */}
            {markingInPoint !== null && (
              <div className={styles.markingLine} style={{ left: markingInPoint * pps }} />
            )}
            <div className={styles.playhead} style={{ left: playheadPosition * pps }} />
            {snapLine !== null && (
              <div className={styles.snapLine} style={{ left: snapLine * pps }} />
            )}
          </div>
        </div>

        {/* Tracks */}
        <div className={styles.tracks}>
          {timeline.tracks.map((track) => (
            <Track key={track.id} track={track} pixelsPerSecond={pps} totalWidth={totalWidth} />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
