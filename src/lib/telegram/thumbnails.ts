/**
 * Telegram-backed thumbnails for grid cards.
 *
 * Images are decoded from the stored file and scaled to MAX_EDGE px, because Telegram's
 * own thumbnails for documents top out at 320 px. Videos use the largest thumbnail
 * Telegram provides. Requests made within a short window share one getMessages call,
 * and thumbnails are produced one at a time to stay clear of flood limits.
 * Results are kept as object URLs for the session.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getClient } from "./client";
import { resolvePeer } from "./downloader";

const MAX_EDGE = 512;
const JPEG_QUALITY = 0.85;
const BATCH_WINDOW_MS = 80;
const IDS_PER_REQUEST = 100;

const urls = new Map<number, string>();
const waiting = new Map<number, Array<(url: string | null) => void>>();
let batch = new Map<string, Set<number>>();
let scheduled = false;

export function loadThumbnail(channelId: string, messageId: number): Promise<string | null> {
  const cached = urls.get(messageId);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const list = waiting.get(messageId) ?? [];
    list.push(resolve);
    waiting.set(messageId, list);
    const ids = batch.get(channelId) ?? new Set<number>();
    ids.add(messageId);
    batch.set(channelId, ids);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), BATCH_WINDOW_MS);
    }
  });
}

function settle(messageId: number) {
  const list = waiting.get(messageId) ?? [];
  waiting.delete(messageId);
  const url = urls.get(messageId) ?? null;
  for (const resolve of list) resolve(url);
}

/** Index of Telegram's largest thumbnail for this media, or undefined if it has none. */
function largestThumbIndex(media: any): number | undefined {
  const list: any[] = media?.photo?.sizes ?? media?.document?.thumbs ?? [];
  let best: number | undefined;
  let bestArea = 0;
  list.forEach((t, i) => {
    const area = (t?.w ?? 0) * (t?.h ?? 0);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  return best;
}

async function scaledImage(bytes: Uint8Array, mime: string): Promise<Blob | null> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
  } finally {
    bitmap.close();
  }
}

async function makeThumbnail(client: any, media: any): Promise<Blob | null> {
  const mime: string = media?.document?.mimeType ?? "";
  if (mime.startsWith("image/")) {
    try {
      const bytes = (await client.downloadMedia(media)) as Uint8Array | undefined;
      if (bytes?.length) {
        const blob = await scaledImage(bytes, mime);
        if (blob) return blob;
      }
    } catch {
      // Undecodable here (e.g. HEIC on some WebViews): fall back to Telegram's thumbnail.
    }
  }
  const index = largestThumbIndex(media);
  // No thumbnail at all: skip rather than let the client download the whole file.
  if (index === undefined) return null;
  const bytes = (await client.downloadMedia(media, { thumb: index })) as Uint8Array | undefined;
  return bytes?.length ? new Blob([bytes], { type: "image/jpeg" }) : null;
}

async function flush() {
  scheduled = false;
  const pending = batch;
  batch = new Map();
  const client = getClient();
  for (const [channelId, idSet] of pending) {
    const ids = Array.from(idSet);
    const missing: number[] = [];
    // Disk cache first: a hit costs no Telegram request.
    for (const id of ids) {
      const cached = await invoke<string | null>("thumb_path", { channelId, messageId: id }).catch(() => null);
      if (cached) {
        urls.set(id, convertFileSrc(cached));
        settle(id);
      } else {
        missing.push(id);
      }
    }
    try {
      const peer = await resolvePeer(channelId);
      for (let i = 0; i < missing.length; i += IDS_PER_REQUEST) {
        const messages = await client.getMessages(peer, { ids: missing.slice(i, i + IDS_PER_REQUEST) });
        for (const message of messages) {
          if (!message?.media) continue;
          try {
            const blob = await makeThumbnail(client, message.media);
            if (!blob) continue;
            // Save to disk so the next launch reads it instead of downloading again.
            const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
            const saved = await invoke<string>("thumb_save", {
              channelId,
              messageId: message.id,
              data: bytes,
            }).catch(() => null);
            urls.set(message.id, saved ? convertFileSrc(saved) : URL.createObjectURL(blob));
          } catch {
            // No thumbnail for this file; the card keeps its icon.
          }
        }
      }
    } catch (err) {
      console.warn("[thumbnails] batch failed:", err);
    }
    for (const id of missing) settle(id);
  }
}
