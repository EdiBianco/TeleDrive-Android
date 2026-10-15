import { useCallback, useRef, useState, type TouchEvent } from "react";

const MIN_COLUMNS = 1;
const MAX_COLUMNS = 6;
const DEFAULT_COLUMNS = 3;
const GAP_PX = 12;
const STORAGE_KEY = "teledrive_grid_columns";

const clamp = (value: number) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, value));

function readStored(): number {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value >= MIN_COLUMNS && value <= MAX_COLUMNS ? value : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function spread(touches: TouchEvent["touches"]): number {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

/**
 * Pinch to zoom a grid, the way photo galleries do. The column count follows the fingers
 * continuously (cards resize live) and snaps to a whole number when the fingers lift.
 * Spreading fingers means fewer, larger columns; pinching means more, smaller ones.
 * Cards in the grid must take `itemStyle` as their width and the grid must be a flex-wrap row
 * with a `gap-3` (12px) gap.
 */
export function usePinchColumns() {
  const [columns, setColumns] = useState(readStored);
  const [live, setLive] = useState(columns);
  const liveRef = useRef(columns);
  const baseline = useRef<{ spread: number; columns: number } | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      baseline.current = { spread: spread(e.touches), columns: liveRef.current };
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!baseline.current || e.touches.length !== 2) return;
    const ratio = spread(e.touches) / baseline.current.spread;
    const next = clamp(baseline.current.columns / ratio);
    liveRef.current = next;
    setLive(next);
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!baseline.current || e.touches.length > 1) return;
    baseline.current = null;
    const snapped = clamp(Math.round(liveRef.current));
    liveRef.current = snapped;
    setLive(snapped);
    setColumns(snapped);
    try {
      localStorage.setItem(STORAGE_KEY, String(snapped));
    } catch {
      // Storage unavailable; the size applies for this session only.
    }
  }, []);

  return {
    columns,
    itemStyle: { width: `calc((100% - ${(live - 1) * GAP_PX}px) / ${live})` } as const,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
