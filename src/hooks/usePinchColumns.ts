import { useCallback, useRef, useState, type TouchEvent } from "react";

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = 2;
const STORAGE_KEY = "teledrive_grid_columns";

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return value >= MIN_COLUMNS && value <= MAX_COLUMNS ? value : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function spread(touches: TouchEvent["touches"]): number {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

/** Two-finger pinch on a grid: spread to show fewer, larger columns; pinch to show more. */
export function usePinchColumns() {
  const [columns, setColumns] = useState(readStored);
  const baseline = useRef<number | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) baseline.current = spread(e.touches);
  }, []);

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (baseline.current === null || e.touches.length !== 2) return;
      const ratio = spread(e.touches) / baseline.current;
      if (ratio < 1.25 && ratio > 0.8) return;
      const next = ratio > 1 ? Math.max(MIN_COLUMNS, columns - 1) : Math.min(MAX_COLUMNS, columns + 1);
      baseline.current = spread(e.touches);
      if (next === columns) return;
      setColumns(next);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Storage unavailable; the new size applies for this session only.
      }
    },
    [columns],
  );

  const onTouchEnd = useCallback(() => {
    baseline.current = null;
  }, []);

  return {
    columns,
    style: { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } as const,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
