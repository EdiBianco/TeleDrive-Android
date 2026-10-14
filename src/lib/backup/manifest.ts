/**
 * Device backup — incremental-upload manifest.
 *
 * The walker produces a flat file list. Before uploading, the runner
 * diffs that list against this manifest: any file whose (mtime, size) pair
 * has changed since the last backup is re-uploaded; new files are uploaded;
 * unchanged files are skipped.
 *
 * Manifest storage
 * ----------------
 * Persisted to Tauri app-data dir at `teledrive_backup_manifest.json`.
 * We use the same save_vault_value / load_vault_value commands as the rest
 * of the desktop (see src-tauri/src/lib.rs). The manifest is per-device
 * (lives on the local disk only) and per-user-telegram-id.
 *
 * Schema
 * ------
 * {
 *   version: 1,
 *   deviceName: "MacBook Pro",   // human-readable, used in audit logs
 *   deviceOs:   "macos",
 *   lastRunAt:  1700000000000,    // unix ms; null = never
 *   entries: {
 *     "/Users/me/Documents/report.pdf": {
 *       mtimeMs: 1699999999999,
 *       size: 12345,
 *       messageId: 678,           // Telegram message id of the uploaded document
 *       folderPath: "/TeleDrive Backups/MacBook Pro/Documents"
 *     }
 *   }
 * }
 *
 * Conflict semantics
 * ------------------
 * If the same local path was uploaded in a previous run and is now
 * missing or skipped, the entry STAYS in the manifest. We don't garbage-
 * collect deleted files automatically — that's a future "cleanup" feature.
 * Keeping the entry means the user can find the old backup in the file
 * browser even after they delete the source.
 */

import { invoke } from "@tauri-apps/api/core";
import type { TeleFile } from "../types";

const MANIFEST_KEY = "teledrive_backup_manifest_v1";
const CURRENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Corruption sentinel (Tier 1 — T3.2)
//
// If `loadManifest` fails to parse the JSON or detects a schema mismatch,
// we DON'T silently start fresh (that cascades into a full re-upload).
// Instead we:
//   1. Set this module-level sentinel.
//   2. Move the corrupt value to a backup key in the vault.
//   3. Return an empty manifest so the run can continue.
//
// The runner checks `isManifestCorrupt()` right after loading and refuses to
// upload — it returns `status: "failed"` with an error message instead. The
// user can later inspect the quarantined value via the backup key and either
// manually repair it or delete it and start fresh.
//
// Listeners (via `onManifestCorruptChange`) let the UI surface a toast when
// the corruption is detected — by then the runner has already short-circuited.
// ---------------------------------------------------------------------------

let manifestWasCorrupt = false;
const corruptListeners = new Set<(quarantineKey: string | null) => void>();

/** Returns true if the most recent `loadManifest` detected corruption. */
export function isManifestCorrupt(): boolean {
  return manifestWasCorrupt;
}

/**
 * Clears the corruption sentinel and notifies listeners. Call after the user
 * has reviewed the quarantined value and either deleted it or repaired it.
 */
export function resetManifestCorrupt(): void {
  if (!manifestWasCorrupt) return;
  manifestWasCorrupt = false;
  for (const listener of corruptListeners) listener(null);
}

/**
 * Subscribes to corruption-sentinel changes. Returns an unsubscribe function.
 * The listener receives the vault backup key (where the corrupt value was
 * quarantined) when corruption is detected, or null when reset.
 */
export function onManifestCorruptChange(
  listener: (quarantineKey: string | null) => void,
): () => void {
  corruptListeners.add(listener);
  // Fire immediately with current state so a late subscriber learns the
  // current sentinel value (useful for the UI's mount-time check).
  listener(manifestWasCorrupt ? lastQuarantineKey : null);
  return () => {
    corruptListeners.delete(listener);
  };
}

/**
 * Move the corrupt manifest value to a backup key in the vault. Best-effort:
 * if the quarantine fails (e.g. the vault file itself is unreadable), we
 * still set the sentinel — the user has lost the corrupt value but the
 * runner is still gated, which is the safer failure mode.
 */
async function quarantineCorruptManifest(reason: string): Promise<void> {
  manifestWasCorrupt = true;
  const quarantineKey = `${MANIFEST_KEY}.corrupt-${Date.now()}`;
  lastQuarantineKey = quarantineKey;
  console.warn(
    `[backup.manifest] manifest corruption detected (${reason}); quarantining to ${quarantineKey}`,
  );
  try {
    await invoke("quarantine_vault_value", { key: MANIFEST_KEY, backupKey: quarantineKey });
  } catch (err) {
    console.error("[backup.manifest] quarantine failed (sentinel still set):", err);
  }
  for (const listener of corruptListeners) listener(quarantineKey);
}

let lastQuarantineKey: string | null = null;

/** Per-file entry — records where the local file went on Telegram. */
export interface ManifestEntry {
  /** Local file mtime in unix-ms (used to detect content changes). */
  mtimeMs: number;
  /** Local file size in bytes (second change-detector — catches mtime resets). */
  size: number;
  /** Telegram message id of the uploaded document. */
  messageId: number;
  /**
   * Virtual folder path inside the storage channel where the file lives.
   * Mirrors the source structure under `/TeleDrive Backups/<device>/...`.
   */
  folderPath: string;
  /** ISO 8601 timestamp of the upload that produced this entry. */
  uploadedAt: string;
}

/** Top-level shape persisted to disk. */
export interface BackupManifest {
  version: typeof CURRENT_VERSION;
  /** Human-readable device name, e.g. "MacBook Pro (Sayan)". */
  deviceName: string;
  /** Detected OS: 'macos' | 'windows' | 'linux' | 'ios' | 'android'. */
  deviceOs: string;
  /** Unix-ms timestamp of the most recent run (null = never run). */
  lastRunAt: number | null;
  /** Map of absolute local path → ManifestEntry. */
  entries: Record<string, ManifestEntry>;
}

/**
 * Load the manifest from disk.
 *
 * On success: returns the parsed manifest.
 *
 * On corruption (parse failure OR schema mismatch): quarantines the raw
 * value to a backup key in the vault, sets the module-level sentinel
 * (`isManifestCorrupt()`), and returns an empty manifest. The runner
 * gates on the sentinel and refuses to upload — see T3.2 in the Tier 1
 * plan. Without this gate, a corrupt manifest silently cascading into
 * "upload everything" is a real-world data loss risk: every file gets
 * re-uploaded, but the manifest's metadata about prior uploads is gone,
 * so dedup-by-content has nothing to dedup against.
 *
 * On missing-file: returns an empty manifest without setting the sentinel
 * (a never-existed file is not corruption).
 */
export async function loadManifest(): Promise<BackupManifest> {
  let raw: string | null;
  try {
    raw = await invoke<string | null>("load_vault_value", { key: MANIFEST_KEY });
  } catch (err) {
    // The vault file itself is unreadable — unusual, but treat as a
    // soft failure (don't quarantine, don't gate) and start fresh.
    console.warn("[backup.manifest] load_vault_value threw; starting empty:", err);
    return emptyManifest();
  }
  if (!raw) return emptyManifest();

  let parsed: BackupManifest;
  try {
    parsed = JSON.parse(raw) as BackupManifest;
  } catch (err) {
    await quarantineCorruptManifest(`json parse: ${(err as Error).message ?? err}`);
    return emptyManifest();
  }
  if (parsed.version !== CURRENT_VERSION || typeof parsed.entries !== "object" || parsed.entries === null) {
    await quarantineCorruptManifest(`schema drift: version=${parsed.version}`);
    return emptyManifest();
  }
  return parsed;
}

/** Persist the manifest. Atomic-ish: writes via vault (overwrite). */
export async function saveManifest(manifest: BackupManifest): Promise<void> {
  try {
    await invoke("save_vault_value", {
      key: MANIFEST_KEY,
      value: JSON.stringify(manifest),
    });
    // A successful save implies the corruption (if any) has been cleared —
    // the next run will read the new value, which is well-formed.
    if (manifestWasCorrupt) resetManifestCorrupt();
  } catch (err) {
    console.error("[backup.manifest] save failed (non-fatal):", err);
  }
}

/** Construct an empty manifest with sensible defaults. */
export function emptyManifest(): BackupManifest {
  return {
    version: CURRENT_VERSION,
    deviceName: "",
    deviceOs: "",
    lastRunAt: null,
    entries: {},
  };
}

/**
 * Diff a fresh file list against the manifest. Returns:
 *   - toUpload: files that need a fresh upload (new or changed)
 *   - unchanged: files present in both, with the same (mtime, size)
 *
 * "Changed" = (mtime OR size differs). We don't try to detect content-only
 * changes that preserve mtime/size — the OS gives us those for free, and
 * the failure mode (a missed re-upload) is benign (user just keeps old content).
 */
export interface ManifestDiff {
  toUpload: { absPath: string; relPath: string; mtimeMs: number; size: number }[];
  unchanged: { absPath: string; entry: ManifestEntry }[];
  /** Files in manifest but not in this walk — kept in manifest, not deleted. */
  missing: { absPath: string; entry: ManifestEntry }[];
}

export function diffAgainstManifest(
  manifest: BackupManifest,
  walk: { absPath: string; relPath: string; mtimeMs: number; size: number }[],
): ManifestDiff {
  const toUpload: ManifestDiff["toUpload"] = [];
  const unchanged: ManifestDiff["unchanged"] = [];
  const walkByPath = new Map<string, { mtimeMs: number; size: number }>();
  for (const f of walk) walkByPath.set(f.absPath, { mtimeMs: f.mtimeMs, size: f.size });

  for (const f of walk) {
    const prior = manifest.entries[f.absPath];
    if (!prior) {
      toUpload.push(f);
      continue;
    }
    if (prior.mtimeMs !== f.mtimeMs || prior.size !== f.size) {
      // Changed (or maybe just the user touched the file). Re-upload.
      toUpload.push(f);
    } else {
      unchanged.push({ absPath: f.absPath, entry: prior });
    }
  }

  // Anything in the manifest not seen in the current walk = user deleted
  // the source file. Don't delete the manifest entry — see comment at top
  // of file. Just track them in the diff for telemetry / future cleanup.
  const missing: ManifestDiff["missing"] = [];
  for (const absPath of Object.keys(manifest.entries)) {
    if (!walkByPath.has(absPath)) {
      missing.push({ absPath, entry: manifest.entries[absPath] });
    }
  }

  return { toUpload, unchanged, missing };
}

/**
 * Record a successful upload. Returns a new manifest object (immutable
 * update — caller is responsible for persisting via saveManifest).
 *
 * Single-file update so the caller can stream uploads and persist after
 * each one, minimizing re-upload cost on crash.
 */
export function recordUpload(
  manifest: BackupManifest,
  absPath: string,
  info: { mtimeMs: number; size: number; messageId: number; folderPath: string },
): BackupManifest {
  return {
    ...manifest,
    lastRunAt: Date.now(),
    entries: {
      ...manifest.entries,
      [absPath]: {
        mtimeMs: info.mtimeMs,
        size: info.size,
        messageId: info.messageId,
        folderPath: info.folderPath,
        uploadedAt: new Date().toISOString(),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// MIME helper (shared with the runner)
// ---------------------------------------------------------------------------

/**
 * Extension → MIME map. Mirrors `getMimeFromExtension` in uploadManager.ts
 * (kept as a separate copy because that file is browser-side and we want
 * this one usable from any context, including the bootstrap which doesn't
 * import uploadManager).
 *
 * Files without a known extension fall back to `application/octet-stream`.
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", json: "application/json",
  pdf: "application/pdf", html: "text/html", htm: "text/html", css: "text/css", csv: "text/csv",
  js: "application/javascript", ts: "application/typescript", tsx: "application/typescript",
  jsx: "application/javascript", xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  heic: "image/heic", heif: "image/heif", tiff: "image/tiff", tif: "image/tiff",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", mp3: "audio/mpeg",
  m4a: "audio/mp4", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/opus",
  zip: "application/zip", tar: "application/x-tar", gz: "application/gzip",
  tgz: "application/gzip", bz2: "application/x-bzip2", "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xz: "application/x-xz", iso: "application/x-iso9660-image",
  dmg: "application/x-apple-diskimage",
};

/**
 * Best-effort MIME type for a file by its basename. Used by the runner
 * during upload and by the manifest-merge path in bootstrap to keep the
 * TeleFile shape consistent regardless of whether an entry arrived via
 * a live upload or via cold-start reconciliation.
 */
export function guessMimeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Manifest → TeleFile conversion
// ---------------------------------------------------------------------------

/**
 * Convert one manifest entry into a `TeleFile` ready to be merged into
 * `state.files`. The output mirrors what the runner writes for a live
 * upload (same `id = backup_<messageId>` convention, same `mime` lookup)
 * so the Backups view, deduplication chain, and reconstructor all treat
 * cold-start-recovered entries the same as live ones.
 *
 * `absPath` is the local file path the manifest was keyed under. We use
 * its basename as the `name` field — the channel-side folderPath already
 * encodes the directory structure, so the file name only needs to be the
 * leaf.
 *
 * Returns `null` if the entry is missing a usable messageId or folderPath
 * (defensive — older manifest versions might not have set them). Callers
 * should drop nulls and log a warning.
 */
export function manifestEntryToTeleFile(
  absPath: string,
  entry: ManifestEntry,
  channelId: string,
): TeleFile | null {
  if (!entry.messageId || entry.messageId <= 0) return null;
  if (!entry.folderPath) return null;
  // The runner uses forward-slash paths; the manifest should mirror that.
  // Defensive normalize in case a future version stored OS-native separators.
  const folderPath = entry.folderPath.replace(/\\/g, "/");
  const fileName =
    absPath.split(/[\\/]/).pop() ||
    folderPath.split("/").pop() ||
    `file_${entry.messageId}`;
  const uploadedMs = Date.parse(entry.uploadedAt);
  return {
    id: `backup_${entry.messageId}`,
    name: fileName,
    size: entry.size,
    mime: guessMimeFromName(fileName),
    folderPath,
    messageId: entry.messageId,
    channelId,
    uploadedAt: Number.isFinite(uploadedMs) ? uploadedMs : Date.now(),
    starred: false,
    trashed: false,
    archived: false,
  };
}