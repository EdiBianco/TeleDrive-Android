/**
 * Device backup — source-folder walker.
 *
 * Walks one or more local source folders recursively and returns a flat
 * list of regular files (no symlinks, no directories) with size and
 * modification time. Excludes matching the user's patterns are filtered
 * at the directory boundary so we never recurse into `node_modules` etc.
 *
 * Implementation
 * --------------
 * The actual filesystem read is delegated to a Rust command
 * (`read_dir_recursive`, see src-tauri/src/lib.rs). Tauri plugin-fs's
 * `readDir` returns entries without size/mtime, which would force a
 * separate `stat` IPC call per file — unacceptable for large folders.
 * The Rust command does everything in one shot and returns the flat list
 * to the webview as JSON.
 *
 * Each entry carries the file's:
 *   - abs_path:  full local path (used as the manifest key — must be stable
 *                across runs, hence absolute, not relative)
 *   - rel_path:  path RELATIVE to the source-folder root, with forward
 *                slashes (used for the exclude match)
 *   - size:      bytes
 *   - mtime_ms:  unix milliseconds
 *
 * IMPORTANT: Rust's serde uses snake_case by default and Tauri does NOT
 * auto-convert to camelCase on the wire. The TS interface below mirrors
 * the Rust struct verbatim — do NOT rename these to camelCase or the
 * walker will silently produce entries with all-undefined fields and
 * the runner will crash with "absPath.replace is not a function".
 *
 * Concurrency / cancellation
 * --------------------------
 * The walker accepts an `AbortSignal`. When aborted mid-recursion it stops
 * issuing further IPC calls and returns whatever it has accumulated so
 * far — the caller can choose to ignore partial results or treat them as
 * the final list. We don't throw on abort because the abort signal is
 * expected behavior (the user clicked Cancel).
 */
import { invoke } from "@tauri-apps/api/core";
import type { BackupSourceFolders } from "./sourceFolders";
import { directoryShouldBeExcluded, normalizeRelativePath, pathMatchesExclude } from "./sourceFolders";
import { isJunkFile } from "../storage/fileSanitizer";

/** A single file produced by the walker. JS-side camelCase; downstream
 *  (manifest, runner) keys everything off `absPath` and `mtimeMs`. */
export interface WalkedFile {
  absPath: string;
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** Raw result returned by the Rust command. Field names match Rust exactly
 *  (Tauri does NOT convert snake_case ↔ camelCase on the wire). Used only
 *  at the IPC boundary — convert to `WalkedFile` (camelCase) before
 *  handing off to the rest of the pipeline. */
interface RustDirEntry {
  abs_path: string;
  rel_path: string;
  is_dir: boolean;
  size: number;
  mtime_ms: number;
}

/** Wait one macrotask to keep the UI responsive during large walks. */
function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Walk all configured source folders and return the flat file list.
 *
 * @param folders  User's source-folder configuration.
 * @param opts.signal  AbortSignal — when triggered, stops recursing.
 * @param opts.deviceRoot  Virtual root prepended to absPath for namespace
 *                         separation (default: empty). Used by the runner
 *                         to compute the channel-side folderPath.
 *
 * NOTE on the Rust command: the Rust side does NOT do exclude matching
 * (we want to keep the Rust binary small). Instead, the TS layer prunes
 * the recursion by passing it ONLY the directories that survived the
 * exclude filter. The Rust command accepts an array of root paths and
 * returns EVERY file under them — we filter by absPath prefix in the
 * exclude check below.
 */
export async function walkSourceFolders(
  folders: BackupSourceFolders,
  opts: { signal?: AbortSignal } = {},
): Promise<WalkedFile[]> {
  if (!folders.paths || folders.paths.length === 0) return [];
  const out: WalkedFile[] = [];

  for (const root of folders.paths) {
    if (opts.signal?.aborted) return out;
    await walkOneFolder(root, folders.excludes ?? [], out, opts.signal);
    // Yield between source folders so a 5-folder config still keeps the
    // UI thread breathing.
    await yieldToUi();
  }

  return out;
}

async function walkOneFolder(
  absRoot: string,
  excludes: string[],
  out: WalkedFile[],
  signal?: AbortSignal,
): Promise<void> {
  let entries: RustDirEntry[];
  try {
    entries = await invoke<RustDirEntry[]>("read_dir_recursive", { path: absRoot });
  } catch (err) {
    // Source folder missing / unreadable / not a directory. Surface a
    // warning and skip — don't fail the whole backup because one path
    // is gone (the user may have removed an external drive mid-day).
    console.warn(`[backup.walker] failed to read ${absRoot}:`, err);
    return;
  }

  for (const entry of entries) {
    if (signal?.aborted) return;

    // Compute the path RELATIVE to the source root for exclude matching.
    // The Rust command returns each entry's rel_path computed against ITS
    // own root (which equals absRoot for this call). If the user has
    // multiple source folders, each gets its own rel_path — that's what
    // we want for matching against a global exclude list.
    const entryRel = normalizeRelativePath(entry.rel_path || "");

    if (entry.is_dir) {
      if (directoryShouldBeExcluded(entryRel, excludes)) {
        continue; // don't recurse; Rust already gave us the children but
                  // we filter them below by abs_path prefix
      }
      // Children of this dir are returned by Rust under the same call
      // (it walks recursively in one shot). We don't need to recurse
      // from TS — just let the loop continue over the flat list.
      continue;
    }

    // Regular file. Skip excludes that match this file's relative path or system defaults.
    if (pathMatchesExclude(entryRel, excludes).matches) {
      continue;
    }

    const fileName = entryRel.split("/").pop() || "";
    if (isJunkFile({ name: fileName, folderPath: entryRel, size: entry.size })) {
      continue;
    }

    // Rust struct is snake_case; convert to camelCase so downstream
    // (manifest.ts, runner.ts) can use a consistent shape.
    out.push({
      absPath: entry.abs_path,
      relPath: entryRel,
      size: entry.size,
      mtimeMs: entry.mtime_ms,
    });
  }

  // Dedupe by absPath — defensive in case the Rust command returned the
  // same file via multiple paths (e.g. trailing-slash quirks).
  const seen = new Set<string>();
  for (let i = out.length - 1; i >= 0; i--) {
    if (seen.has(out[i].absPath)) out.splice(i, 1);
    else seen.add(out[i].absPath);
  }
}

/**
 * Sanitize a string for use as a virtual folder segment. Strips characters
 * that are illegal in Telegram folder names and collapses whitespace.
 *
 * Used to build the per-device namespace: `/TeleDrive Backups/<sanitized>/`.
 */
export function sanitizeFolderSegment(s: string): string {
  return s
    .replace(/[:*?<>|"]/g, "") // illegal on Windows + TFS
    .replace(/\/+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "device";
}