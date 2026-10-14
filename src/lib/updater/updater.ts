/**
 * In-app updates for the Android build. Network access and the installer launch happen in
 * native code (tauri-plugin-apkupdate); this module only calls the Rust commands and tracks
 * when the automatic check last ran.
 */
import { invoke } from "@tauri-apps/api/core";

export interface UpdateInfo {
  tag: string;
  version: string;
  notes: string;
  url: string;
  sha256: string;
  size: number;
  current: string;
}

interface DownloadStatus {
  bytes: number;
  total: number;
  done: boolean;
}

const LAST_CHECK_KEY = "teledrive_update_checked_at";
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Returns the latest release if it is newer than the installed app, otherwise null. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("update_check");
}

/** Downloads and checksum-verifies the APK. Reports progress while the download runs. */
export async function downloadUpdate(
  info: UpdateInfo,
  onProgress: (bytes: number, total: number) => void,
): Promise<string> {
  const timer = window.setInterval(async () => {
    try {
      const status = await invoke<DownloadStatus>("update_progress");
      onProgress(status.bytes, status.total || info.size);
    } catch {
      // Progress is advisory; a failed read must not stop the download.
    }
  }, 400);
  try {
    return await invoke<string>("update_download", { url: info.url, sha256: info.sha256 });
  } finally {
    window.clearInterval(timer);
  }
}

/** Opens the Android installer. Resolves true when the user must allow installs from TeleDrive first. */
export function installUpdate(path: string): Promise<boolean> {
  return invoke<boolean>("update_install", { path });
}

export function isAutoCheckDue(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0) > AUTO_CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markAutoCheckRan(): void {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable; worst case the check runs again next launch.
  }
}
