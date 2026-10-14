/**
 * Backup scheduler — JS-side wrapper around the Rust timer commands.
 *
 * The Rust side (src-tauri/src/lib.rs) owns the timer via
 * `start_backup_scheduler(interval_minutes)` / `stop_backup_scheduler()`.
 * When the timer fires, it emits a `teledrive://backup-tick` Tauri event
 * into the webview. This module:
 *   1. Forwards interval changes to Rust.
 *   2. Listens for tick events and dispatches them to `runBackup` (the
 *      real device-backup orchestrator in `./runner`).
 *   3. Surfaces status to the React layer (currently via fileStore).
 *
 * The interval value is the source of truth in `licenseStore.license.
 * scheduledBackupIntervalMinutes` — when the user picks a new interval,
 * `setProSchedule` updates both the backend AND triggers
 * `applyIntervalChange(intervalMinutes)` here so the timer restarts with
 * the new value.
 *
 * Replaces the previous "metadata-only snapshot" pipeline. The old
 * `takeSnapshot` is preserved in `./snapshot` for the historical audit
 * trail (the text-message breadcrumb it posts is still useful as a
 * timestamped marker in the channel), but it is no longer the active
 * "what runs when the timer fires" path. That's `runBackup` now — it
 * actually walks source folders and uploads real files.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { runBackup } from "./runner";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { useBackupProgressStore } from "@/stores/backupProgressStore";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

let tickUnlisten: UnlistenFn | null = null;
let currentIntervalMinutes: number | null = null;

/**
 * Apply a new interval. Pass null to stop the timer entirely. Pass a
 * positive integer (1..10080) to (re)start it with the new cadence.
 *
 * Idempotent: calling with the same value is a no-op (Rust timer handles
 * the case of restarting with the same interval — start first calls stop,
 * so any interval change is honored).
 */
export async function applyIntervalChange(intervalMinutes: number | null): Promise<void> {
  if (intervalMinutes === currentIntervalMinutes) {
    return;
  }
  currentIntervalMinutes = intervalMinutes;
  try {
    if (intervalMinutes === null || intervalMinutes <= 0) {
      await invoke("stop_backup_scheduler");
      return;
    }
    await invoke("start_backup_scheduler", { intervalMinutes });
  } catch (err) {
    console.warn("[backup.scheduler] Tauri command failed:", err);
    currentIntervalMinutes = null; // back to "unknown" so a retry is possible
    throw err;
  }
}

/**
 * Start listening for tick events. Idempotent: tears down any existing
 * listener first so a re-start (e.g. on logout/login) doesn't double-fire.
 */
export async function ensureTickListenerStarted(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  tickUnlisten = await listen("teledrive://backup-tick", async () => {
    await onTick();
  });
}

/**
 * Stop listening for tick events and stop the Rust timer. Used by logout.
 */
export async function stopBackupSchedule(): Promise<void> {
  if (tickUnlisten) {
    await tickUnlisten();
    tickUnlisten = null;
  }
  try {
    await tauriInvoke("stop_backup_scheduler");
  } catch (err) {
    console.warn("[backup.scheduler] stop_backup_scheduler failed:", err);
  }
  currentIntervalMinutes = null;
}

/**
 * Tick handler. Called by the Tauri event listener. Runs the real device
 * backup (walker → manifest diff → incremental upload → audit row).
 *
 * Pipes progress into the singleton progress store so the bottom-right
 * overlay can render the run regardless of whether the user is on the
 * Settings page or browsing files.
 *
 * The runner itself surfaces most user-facing errors (no folders, PRO
 * gate, channel not ready). If the runner is mid-flight when another
 * tick fires, the runner's internal guards (e.g. concurrent signal) mean
 * the second tick will still proceed but might overlap — that's fine for
 * v1 because the manifest writes are sequential per-file.
 */
async function onTick(): Promise<void> {
  const setIndexQueueState = useFileStore.getState().setIndexQueueState;
  const start = useBackupProgressStore.getState().start;
  const setProgress = useBackupProgressStore.getState().setProgress;
  const finish = useBackupProgressStore.getState().finish;
  setIndexQueueState("backup-running");
  start("auto");
  try {
    const result = await runBackup({
      triggeredBy: "auto",
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
    console.warn("[backup.scheduler] onTick failed:", err);
    finish({
      filesUploaded: 0,
      filesSkipped: 0,
      filesFailed: 0,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setIndexQueueState("idle");
  }
  // `useAuthStore` was previously used to resolve the phone for
  // getStorageChannelId; the runner handles channel resolution itself.
  void useAuthStore;
}

/**
 * Manually trigger a backup right now (the "Run now" button).
 * Doesn't interact with the timer — just runs the real device-backup
 * orchestrator synchronously. Progress is piped into the overlay store.
 */
export async function runBackupNow(): Promise<void> {
  const setIndexQueueState = useFileStore.getState().setIndexQueueState;
  const start = useBackupProgressStore.getState().start;
  const setProgress = useBackupProgressStore.getState().setProgress;
  const finish = useBackupProgressStore.getState().finish;
  setIndexQueueState("backup-running");
  start("manual");
  try {
    const result = await runBackup({
      triggeredBy: "manual",
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
    finish({
      filesUploaded: 0,
      filesSkipped: 0,
      filesFailed: 0,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setIndexQueueState("idle");
  }
}