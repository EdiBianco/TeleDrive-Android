/**
 * Headless orchestrator that runs the multi-device sync loop AND the
 * scheduled-backup tick listener.
 *
 * Mounted once at the App root (post-auth). Manages the lifecycle of:
 *   - `startRemoteSync` / `stopRemoteSync` based on auth and bootstrap
 *   - `ensureTickListenerStarted` (so the Rust timer's tick events reach
 *     the snapshot sender) on app start
 *
 * Renders nothing. All state lives in module-scoped vars inside
 * remoteSync.ts / scheduler.ts.
 *
 * NOTE: Multi-device sync is now available to all authenticated users.
 * Plan checks have been removed — TeleDrive is a free application.
 */
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import { useFileStore } from "@/stores/fileStore";
import { useLicenseStore } from "@/stores/licenseStore";
import { startRemoteSync, stopRemoteSync } from "@/lib/sync/remoteSync";
import {
  applyIntervalChange,
  ensureTickListenerStarted,
  stopBackupSchedule,
} from "@/lib/backup/scheduler";
import { getStorageChannelId } from "@/lib/telegram/channelManager";

export default function RemoteSyncOrchestrator(): null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const bootstrapComplete = useFileStore((s) => s.bootstrapComplete);
  const lastIndexMsgId = useFileStore((s) => s.lastIndexMsgId);
  const intervalMinutes =
    useLicenseStore((s) => s.license?.scheduledBackupIntervalMinutes) ?? null;

  // Effect 1 — bootstrap listener for backup ticks. Runs once on mount,
  // tears down on unmount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureTickListenerStarted();
      } catch (err) {
        if (!cancelled) console.warn("[RemoteSyncOrchestrator] tick listener failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      void stopBackupSchedule();
    };
  }, []);

  // Effect 2 — react to interval changes. When the user picks a new
  // interval, push it to the Rust timer.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (intervalMinutes === null || intervalMinutes <= 0) {
      void applyIntervalChange(null);
      return;
    }
    void applyIntervalChange(intervalMinutes);
  }, [isAuthenticated, intervalMinutes]);

  // Effect 3 — react to auth + bootstrap changes. Start the remote sync
  // loop when all pre-conditions are met; stop on any pre-condition failing.
  // Multi-device sync is now available to ALL authenticated users.
  useEffect(() => {
    if (!isAuthenticated || !bootstrapComplete) {
      stopRemoteSync();
      return;
    }

    let cancelled = false;
    let retryHandle: ReturnType<typeof setTimeout> | null = null;

    async function tryStart(): Promise<void> {
      if (cancelled) return;
      try {
        const phone = useAuthStore.getState().phoneNumber;
        const channelId = await getStorageChannelId(phone);
        if (cancelled) return;
        if (channelId) {
          startRemoteSync(channelId);
        }
      } catch (err) {
        console.warn(
          "[RemoteSyncOrchestrator] channel id not ready, retrying in 2s:",
          err,
        );
        retryHandle = setTimeout(tryStart, 2000);
      }
    }

    void tryStart();

    return () => {
      cancelled = true;
      if (retryHandle) clearTimeout(retryHandle);
      stopRemoteSync();
    };
  }, [isAuthenticated, bootstrapComplete, lastIndexMsgId]);

  return null;
}
