/**
 * useBackupSchedule — manages the device backup schedule.
 *
 * All users can use backup scheduling — no Pro gate.
 * Backup interval is stored locally via the licenseStore stub.
 */
import { useCallback, useMemo } from "react";
import { useLicenseStore } from "@/stores/licenseStore";
import { useFileStore } from "@/stores/fileStore";
import { applyIntervalChange, runBackupNow } from "@/lib/backup/scheduler";

export type BackupIntervalMinutes = number | null;

export interface UseBackupSchedule {
  /** Current schedule. null = disabled. 1440 = daily, 10080 = weekly. */
  intervalMinutes: BackupIntervalMinutes;
  /** Always true — backup scheduling is available to all users. */
  isPro: boolean;
  /** Last successful or failed backup timestamp (ms), null = never. */
  lastBackupAt: number | null;
  /** True iff a snapshot is currently in flight. */
  isRunning: boolean;
  /** Update the schedule interval and restart the Rust timer accordingly. */
  setIntervalMinutes: (minutes: BackupIntervalMinutes) => Promise<void>;
  /** Trigger a manual snapshot right now. Resolves when done. */
  runNow: () => Promise<void>;
}

export function useBackupSchedule(): UseBackupSchedule {
  const license = useLicenseStore((s) => s.license);
  const lastBackupAt = useFileStore((s) => s.lastBackupAt);
  const indexQueueState = useFileStore((s) => s.indexQueueState);
  const setProSchedule = useLicenseStore((s) => s.setProSchedule);

  const intervalMinutes = useMemo<BackupIntervalMinutes>(() => {
    const v = license?.scheduledBackupIntervalMinutes;
    return typeof v === "number" && v > 0 ? v : null;
  }, [license?.scheduledBackupIntervalMinutes]);

  const setIntervalMinutes = useCallback(
    async (minutes: BackupIntervalMinutes) => {
      await setProSchedule(minutes);
      // Restart the Rust timer with the new value (or stop it).
      await applyIntervalChange(minutes);
    },
    [setProSchedule],
  );

  const runNow = useCallback(async () => {
    await runBackupNow();
  }, []);

  return {
    intervalMinutes,
    isPro: true, // All users have full backup access
    lastBackupAt,
    isRunning: indexQueueState === "backup-running",
    setIntervalMinutes,
    runNow,
  };
}
