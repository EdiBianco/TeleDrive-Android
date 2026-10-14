/**
 * Backup visibility — single source of truth for "is this a backup file?".
 *
 * The device-backup runner writes uploaded files under
 * `/TeleDrive Backups/<device>/<source>/<inner>/<file>` (see runner.ts →
 * buildDeviceFolder + the per-file folderPath computation). This file is
 * the only place that knows the magic namespace prefix; every UI call
 * site that needs to ask "should this entry be visible in My Drive?" or
 * "should I render the Backups sidebar entry?" reads from here.
 *
 * If we ever need to rename the namespace (e.g. change "TeleDrive Backups"
 * to "Device Backups"), this is the only file we have to update — every
 * caller reads BACKUP_ROOT, never the literal string.
 */

import type { TeleFile } from "../types";

/**
 * The virtual-folder root under which backup files live. Kept with a
 * trailing-slashless form so the `.startsWith()` check below is strict:
 * a folder literally named `/TeleDrive Backups` (no nested path) is not
 * a backup item.
 *
 * Must match the string built in `runner.ts → buildDeviceFolder()`.
 */
export const BACKUP_ROOT = "/TeleDrive Backups";

/** Prefix used by `.startsWith()` in `isBackupItem` and by callers
 *  that need to strip the namespace from a full path (e.g. building a
 *  URL wildcard from an absolute backup folderPath). Exported so the
 *  string is defined exactly once. */
export const BACKUP_ROOT_PREFIX = `${BACKUP_ROOT}/`;

/**
 * Returns true iff `file` itself lives under the backup namespace —
 * either directly under `/TeleDrive Backups/` (deep child) or its
 * parent path IS `/TeleDrive Backups` (immediate child like a device
 * folder). Folders inside the backup namespace are included so the
 * Backups view renders its own folder tree without leaking those
 * folder entries into My Drive.
 *
 * This is the "is this entry part of the backup subtree?" check.
 * It answers three questions:
 *   - Hide it from My Drive / Recent / Starred / Archived / Search?
 *   - Show it in the Backups view?
 *   - Count it in the Backups sidebar badge?
 *
 * Edge cases handled:
 *   1. The synthetic root, recreated by `reconstructMissingFolders` with
 *      `folderPath === "/"` and `name === "TeleDrive Backups"`.
 *   2. A device-folder entry whose parent path IS exactly BACKUP_ROOT
 *      (i.e. `folderPath === "/TeleDrive Backups"`, not
 *      `"/TeleDrive Backups/..."`). Strict `.startsWith("/TeleDrive
 *      Backups/")` would miss it because the path has no trailing
 *      slash; the additional `===` check covers it.
 */
export function isBackupItem(file: TeleFile): boolean {
  if (!file) return false;
  // Synthetic root: folderPath = "/", name = "TeleDrive Backups".
  if (file.folderPath === "/" && file.name === "TeleDrive Backups") return true;
  if (!file.folderPath || file.folderPath === "/") return false;
  return (
    file.folderPath === BACKUP_ROOT ||
    file.folderPath.startsWith(BACKUP_ROOT_PREFIX)
  );
}

/**
 * Returns true iff `file` would be a valid CHILD to render under
 * `parentPath` inside the Backups view. Distinct from `isBackupItem`:
 * a synthetic root entry (`folderPath === "/", name === "TeleDrive
 * Backups"`) IS a backup item but is only ever rendered when the user
 * navigates to a folder ABOVE it (which they can't, since `/` is the
 * drive root). Use this when filtering `folderEntriesIndex.get(P)`
 * results so device-folder entries whose parent path IS BACKUP_ROOT
 * aren't wrongly stripped.
 */
export function isBackupChildOf(file: TeleFile, parentPath: string): boolean {
  if (!file) return false;
  if (parentPath === BACKUP_ROOT) {
    // All backup items belong here, plus the root itself if anyone
    // ever passes it in (defensive).
    return isBackupItem(file);
  }
  return isBackupItem(file) && file.folderPath === parentPath;
}

/**
 * Returns true iff the given folder path is under the backup namespace.
 * Used by the BackupsPage route handler to validate that a
 * /drive/backups/folder/* URL segment isn't pointing somewhere outside
 * the backup tree (a guard against URL-tampering sneaking private user
 * folders into the Backups view).
 */
export function isUnderBackupRoot(folderPath: string): boolean {
  if (!folderPath) return false;
  return folderPath === BACKUP_ROOT || folderPath.startsWith(BACKUP_ROOT_PREFIX);
}