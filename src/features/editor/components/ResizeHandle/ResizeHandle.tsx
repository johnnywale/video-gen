import { useCallback, useEffect, useState } from "react";
import styles from "./ResizeHandle.module.css";

interface Props {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction, onResize }: Props) {
  const [dragging, setDragging] = useState(false);
  const [startPos, setStartPos] = useState(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    setStartPos(direction === "horizontal" ? e.clientX : e.clientY);
  }, [direction]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const current = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = current - startPos;
      if (delta !== 0) {
        onResize(delta);
        setStartPos(current);
      }
    };

    const handleMouseUp = () => setDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, startPos, direction, onResize]);

  return (
    <div
      className={`${styles.handle} ${direction === "horizontal" ? styles.horizontal : styles.vertical} ${dragging ? styles.active : ""}`}
      onMouseDown={handleMouseDown}
    />
  );
}
