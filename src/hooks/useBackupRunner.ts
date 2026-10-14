/**
 * useBackupRunner — React hook that drives `runBackup()` for the
 * "Run backup now" button, and pipes progress into the singleton
 * `useBackupProgressStore` so a global overlay can show it.
 *
 * State shape
 * -----------
 * Local: `AbortController` for cancel + a `isRunning` flag for the
 *   triggering button's spinner.
 * Global (via backupProgressStore): active / uploaded / total /
 *   currentFile / lastResult — consumed by BackupProgressOverlay
 *   regardless of where the run was kicked off from.
 *
 * Cancellation: clicking the overlay's Cancel button aborts the local
 * AbortController; the runner sees it on the next file boundary.
 */
import { useCallback, useRef, useState } from "react";
import { runBackup, type BackupTrigger } from "@/lib/backup/runner";
import { useBackupProgressStore } from "@/stores/backupProgressStore";

export interface UseBackupRunner {
  /** True iff a manual run is currently in flight (triggered by THIS hook). */
  isRunning: boolean;
  /** Trigger a manual backup right now. No-op if already running. */
  runNow: () => Promise<void>;
  /** Cancel the in-flight manual run. */
  cancel: () => void;
}

export function useBackupRunner(): UseBackupRunner {
  const [isRunning, setIsRunning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useBackupProgressStore((s) => s.start);
  const setProgress = useBackupProgressStore((s) => s.setProgress);
  const finish = useBackupProgressStore((s) => s.finish);
  const fail = useBackupProgressStore((s) => s.fail);
  const cancelStore = useBackupProgressStore((s) => s.cancel);

  const runNow = useCallback(async () => {
    if (isRunning) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    start("manual");
    try {
      const result = await runBackup({
        triggeredBy: "manual" as BackupTrigger,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      finish({
        filesUploaded: result.filesUploaded,
        filesSkipped: result.filesSkipped,
        filesFailed: result.filesFailed,
        status: result.status,
        error: result.error,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The runner is supposed to never throw — failures surface in
      // result.status. This catch is a safety net for unexpected throws.
      fail(msg);
    } finally {
      setIsRunning(false);
      controllerRef.current = null;
    }
  }, [isRunning, start, setProgress, finish, fail]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    cancelStore();
  }, [cancelStore]);

  return {
    isRunning,
    runNow,
    cancel,
  };
}