import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getClient } from "../telegram/client";
import { resolvePeer } from "../telegram/downloader";
import { readOfflineCache, isCachedOffline } from "../storage/offlineStorage";
import { saveBinaryFile } from "../storage/safeFileWriter";
import type { TeleFile } from "../types";

const CHUNK = 512 * 1024;

interface Entry {
  path: string;
  part: string;
  ready: boolean;
}

/**
 * Makes sure the file is in the viewer cache (downloading it if needed) and
 * returns a URL the webview can play. `isCancelled` is polled between chunks.
 */
export async function loadForViewer(
  file: TeleFile,
  onProgress: (pct: number) => void,
  isCancelled: () => boolean
): Promise<string | null> {
  const entry = await invoke<Entry>("viewer_cache_entry", {
    channelId: file.channelId,
    messageId: file.messageId,
    name: file.name,
  });
  if (entry.ready) return convertFileSrc(entry.path);

  if (file.offline && (await isCachedOffline(file.id))) {
    await saveBinaryFile(entry.part, await readOfflineCache(file.id));
  } else {
    const client = getClient();
    if (!client.connected) await client.connect();
    const peer = await resolvePeer(file.channelId);
    const [message] = await client.getMessages(peer, { ids: [file.messageId] });
    if (!message?.media) throw new Error("File not found on Telegram.");

    let received = 0;
    let first = true;
    for await (const chunk of client.iterDownload({ file: message.media, requestSize: CHUNK })) {
      if (isCancelled()) return null;
      await invoke("write_file_chunk", { path: entry.part, data: Array.from(chunk as Uint8Array), append: !first });
      first = false;
      received += (chunk as Uint8Array).byteLength;
      if (file.size > 0) onProgress(Math.min(99, Math.round((received / file.size) * 100)));
    }
    if (first) await saveBinaryFile(entry.part, new Uint8Array(0));
  }
  if (isCancelled()) return null;
  await invoke("viewer_cache_commit", { part: entry.part });
  onProgress(100);
  return convertFileSrc(entry.path);
}
