/**
 * Backup source identities.
 *
 * A source is a string stored in the backup folder list:
 *   - a desktop filesystem path, e.g. "/Users/me/Documents"
 *   - an Android MediaStore collection root (photos or videos)
 *   - an Android Storage Access Framework tree URI (any folder the user picked)
 *
 * Files found under a source always have an absolute path that starts with
 * the source root followed by "/", so the runner can match and name them.
 */

export const MEDIA_IMAGES_ROOT = "content://media/external/images/media";
export const MEDIA_VIDEOS_ROOT = "content://media/external/video/media";

export function isMediaSource(source: string): boolean {
  return source === MEDIA_IMAGES_ROOT || source === MEDIA_VIDEOS_ROOT;
}

export function isTreeSource(source: string): boolean {
  return source.startsWith("content://") && source.includes("/tree/");
}

/**
 * Human name for a source, used in the settings list and as the top-level
 * folder name in Telegram. Tree URIs look like `.../tree/primary%3ADownload%2FWork`.
 */
export function sourceDisplayName(source: string): string {
  if (source === MEDIA_IMAGES_ROOT) return "Photos";
  if (source === MEDIA_VIDEOS_ROOT) return "Videos";
  if (isTreeSource(source)) {
    const encoded = source.slice(source.indexOf("/tree/") + "/tree/".length);
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = encoded;
    }
    // "primary:Download/Work" -> "Download/Work"; other volumes keep their id as a prefix.
    const path = decoded.replace(/^primary:/, "").replace(/\/+$/, "");
    const last = path.split("/").filter(Boolean).pop();
    return last || "Folder";
  }
  const parts = source.replace(/\\/g, "/").replace(/\/$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
