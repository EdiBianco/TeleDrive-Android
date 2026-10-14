/**
 * useActivityLog — local activity timeline.
 *
 * The backend event/audit APIs have been removed. This hook now exposes a
 * simplified local-only view built from the fileStore's operation history.
 * All users can see the activity log — no Pro gate.
 *
 * Currently returns an empty list (local event history is not yet persisted);
 * future iterations can populate this from an in-memory or IndexedDB store.
 */
import { useCallback, useState } from "react";

/** Source tag — surfaces in the UI as a small badge next to each row. */
export type ActivitySource = "backup" | "event";

/**
 * Unified timeline entry.
 */
export interface ActivityItem {
  /** Stable id. */
  id: string;
  source: ActivitySource;
  /** Sort key — ISO 8601 string. Newest first. */
  occurredAt: string;
  /** Event type string. */
  type: string;
  /** Event payload. */
  payload: Record<string, unknown>;
  /** Convenience label for the row. */
  label: string;
}

export interface UseActivityLog {
  items: ActivityItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Always true — activity log is available to all users. */
  isPro: boolean;
}

export function useActivityLog(): UseActivityLog {
  const [items] = useState<ActivityItem[]>([]);
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // No-op: activity history currently not persisted locally.
    // Future: read from IndexedDB or in-memory event log.
  }, []);

  return { items, isLoading, error, refresh, isPro: true };
}