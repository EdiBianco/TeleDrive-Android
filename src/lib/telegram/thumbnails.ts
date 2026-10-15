/**
 * Telegram thumbnails for grid cards. Requests made within a short window share one
 * getMessages call, and thumbnails download one at a time to stay clear of flood limits.
 * Results are kept as object URLs for the session.
 */
import { getClient } from "./client";
import { resolvePeer } from "./downloader";

const urls = new Map<number, string>();
const waiting = new Map<number, Array<(url: string | null) => void>>();
let batch = new Map<string, Set<number>>();
let scheduled = false;

const BATCH_WINDOW_MS = 80;
const IDS_PER_REQUEST = 100;

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

async function flush() {
  scheduled = false;
  const pending = batch;
  batch = new Map();
  const client = getClient();
  for (const [channelId, idSet] of pending) {
    const ids = Array.from(idSet);
    try {
      const peer = await resolvePeer(channelId);
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        const messages = await client.getMessages(peer, { ids: ids.slice(i, i + IDS_PER_REQUEST) });
        for (const message of messages) {
          if (!message?.media) continue;
          try {
            const buffer = (await client.downloadMedia(message.media, { thumb: 0 })) as Uint8Array | undefined;
            if (buffer && buffer.length > 0) {
              urls.set(message.id, URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" })));
            }
          } catch {
            // No thumbnail for this file; the card keeps its icon.
          }
        }
      }
    } catch (err) {
      console.warn("[thumbnails] batch failed:", err);
    }
    for (const id of ids) settle(id);
  }
}
