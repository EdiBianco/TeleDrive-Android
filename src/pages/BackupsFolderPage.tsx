/**
 * BackupsFolderPage — nested route under /drive/backups/folder/*.
 *
 * Mirrors DriveBrowserPage's shape but keeps the user inside the Backups
 * view rather than letting the URL slingshot them into My Drive.
 *
 * URL convention: the wildcard after `/drive/backups/folder/` carries
 * the path RELATIVE to BACKUP_ROOT — e.g. `/drive/backups/folder/Mac
 * (macOS)/Documents` means folderPath = `/TeleDrive Backups/Mac
 * (macOS)/Documents`. This keeps URLs readable (no doubled `TeleDrive
 * Backups` segment) and matches the breadcrumbs / handleItemDoubleClick
 * contract used elsewhere in FileBrowser.
 *
 * URL tampering (a hand-crafted URL pointing outside the backup
 * namespace) is contained by `isUnderBackupRoot`: any non-backup path
 * is normalised back to the Backups root instead of rendering private
 * user folders here.
 */
import { useParams } from "react-router-dom";
import { FileBrowser } from "@/components/files/FileBrowser";
import { BACKUP_ROOT, BACKUP_ROOT_PREFIX, isUnderBackupRoot } from "@/lib/backup/visibility";

export default function BackupsFolderPage() {
  const { "*": subPath } = useParams();
  // Reconstruct the absolute folderPath by prepending BACKUP_ROOT to the
  // relative wildcard. The wildcard may carry a leading slash (e.g.
  // `Mac (macOS)/Documents` or `/Mac (macOS)/Documents`); normalise so
  // we don't end up with `//` or a doubled prefix.
  const cleaned = (subPath ?? "").replace(/^\/+/, "");
  const candidate = cleaned ? `${BACKUP_ROOT_PREFIX}${cleaned}` : BACKUP_ROOT;
  // The candidate MUST be under the backup namespace. Without this
  // guard, an attacker (or a typo in a saved link) could render a
  // non-backup folder inside the Backups view, breaking the "backups
  // are isolated" promise.
  const folderPath = isUnderBackupRoot(candidate) ? candidate : BACKUP_ROOT;

  return <FileBrowser folderPath={folderPath} mode="backups" />;
}