/**
 * Thumbnails for grid cards.
 *
 * Two tiers per file:
 *   small - Telegram's own thumbnail (a few KB). Fast; good enough at 3+ columns.
 *   large - a 512 px thumbnail, used when cards are big. For photos it is made from the stored
 *           file; photos backed up from this phone already have one on disk (made at upload).
 *
 * Work is queued, newest request first, and run by a few workers. A request for a card that has
 * scrolled away is dropped before it starts. Files with no thumbnail are remembered so they are
 * not retried on every launch. Telegram flood waits pause the workers. Finished thumbnails are
 * kept on disk (see the Rust thumb_* commands) and as a capped in-memory cache.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getClient } from "./client";
import { resolvePeer } from "./downloader";

export type ThumbTier = "small" | "large";

const MAX_EDGE = 512;
const JPEG_QUALITY = 0.85;
const WORKERS = 3;
const MEMORY_CAP = 400;
const MESSAGE_BATCH_MS = 60;
const MESSAGE_CACHE_MS = 30_000;
/** Files above this size are decoded at reduced size to keep memory low. */
const RESIZE_ON_DECODE_BYTES = 1_500_000;
const LOG_EVERY = 25;

interface Job {
  key: string;
  channelId: string;
  messageId: number;
  mime: string;
  tier: ThumbTier;
  seq: number;
  waiters: Array<(url: string | null) => void>;
  started: boolean;
}

export interface ThumbRequest {
  promise: Promise<string | null>;
  /** Drops the request if it has not started. Safe to call more than once. */
  cancel: () => void;
}

export interface ThumbStats {
  requested: number;
  finished: number;
  diskHits: number;
  telegramThumbs: number;
  fullDownloads: number;
  noThumbnail: number;
  failed: number;
  floodWaits: number;
  lastError: string | null;
}

const stats: ThumbStats = {
  requested: 0,
  finished: 0,
  diskHits: 0,
  telegramThumbs: 0,
  fullDownloads: 0,
  noThumbnail: 0,
  failed: 0,
  floodWaits: 0,
  lastError: null,
};

export function getThumbStats(): ThumbStats {
  return { ...stats };
}

// ---- memory cache (LRU) --------------------------------------------------------------------
const memory = new Map<string, string>();

function memGet(key: string): string | undefined {
  const url = memory.get(key);
  if (url !== undefined) {
    memory.delete(key);
    memory.set(key, url);
  }
  return url;
}

function memSet(key: string, url: string) {
  memory.delete(key);
  memory.set(key, url);
  while (memory.size > MEMORY_CAP) {
    const oldest = memory.keys().next().value as string;
    const evicted = memory.get(oldest);
    memory.delete(oldest);
    if (evicted?.startsWith("blob:")) URL.revokeObjectURL(evicted);
  }
}

// ---- queue ---------------------------------------------------------------------------------
const jobs = new Map<string, Job>();
let seq = 0;
let active = 0;
let pausedUntil = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;

export function requestThumbnail(
  channelId: string,
  messageId: number,
  mime: string,
  tier: ThumbTier,
): ThumbRequest {
  const key = `${channelId}:${messageId}:${tier}`;
  const cached = memGet(key);
  if (cached) return { promise: Promise.resolve(cached), cancel: () => {} };

  stats.requested++;
  let waiter!: (url: string | null) => void;
  const promise = new Promise<string | null>((resolve) => {
    waiter = resolve;
  });
  let job = jobs.get(key);
  if (!job) {
    job = { key, channelId, messageId, mime, tier, seq: ++seq, waiters: [], started: false };
    jobs.set(key, job);
  }
  job.waiters.push(waiter);
  schedulePump();

  let cancelled = false;
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      const current = jobs.get(key);
      if (!current || current.started) return;
      current.waiters = current.waiters.filter((w) => w !== waiter);
      waiter(null);
      if (current.waiters.length === 0) jobs.delete(key);
    },
  };
}

function schedulePump() {
  if (pumpTimer) return;
  const wait = Math.max(0, pausedUntil - Date.now());
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, wait);
}

/** Small thumbnails first, then the newest request (what the user is looking at now). */
function nextJob(): Job | null {
  let best: Job | null = null;
  for (const job of jobs.values()) {
    if (job.started) continue;
    if (
      !best ||
      (job.tier === "small" && best.tier === "large") ||
      (job.tier === best.tier && job.seq > best.seq)
    ) {
      best = job;
    }
  }
  return best;
}

function pump() {
  if (Date.now() < pausedUntil) {
    schedulePump();
    return;
  }
  while (active < WORKERS) {
    const job = nextJob();
    if (!job) return;
    job.started = true;
    active++;
    void run(job).finally(() => {
      active--;
      // A job re-queued after a flood wait has started=false and stays in the queue.
      if (job.started) {
        jobs.delete(job.key);
        stats.finished++;
        if (stats.finished % LOG_EVERY === 0) void logStats();
      }
      pump();
    });
  }
}

function settle(job: Job, url: string | null) {
  if (url) memSet(job.key, url);
  for (const resolve of job.waiters) resolve(url);
  job.waiters = [];
}

function logStats() {
  return invoke("log_vault_state", {
    state: `THUMB_STATS ${JSON.stringify(stats)}`,
  }).catch(() => {});
}

// ---- one job -------------------------------------------------------------------------------
interface Lookup {
  small: string | null;
  large: string | null;
  none: boolean;
}

async function run(job: Job): Promise<void> {
  try {
    const cached = await invoke<Lookup>("thumb_lookup", {
      channelId: job.channelId,
      messageId: job.messageId,
    }).catch(() => null);

    // A large file also satisfies a small request.
    const hit = job.tier === "large" ? cached?.large : (cached?.large ?? cached?.small);
    if (hit) {
      stats.diskHits++;
      settle(job, convertFileSrc(hit));
      return;
    }
    // Known to have no thumbnail: do not ask Telegram again.
    if (cached?.none && job.tier === "small") {
      stats.noThumbnail++;
      settle(job, null);
      return;
    }

    const message = await getMessage(job.channelId, job.messageId);
    if (!message?.media) {
      settle(job, null);
      return;
    }
    const blob = await makeThumbnail(getClient(), message.media, job.tier);
    if (!blob) {
      if (job.tier === "small") {
        stats.noThumbnail++;
        await invoke("thumb_mark_none", { channelId: job.channelId, messageId: job.messageId }).catch(() => {});
      }
      settle(job, null);
      return;
    }
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const saved = await invoke<string>("thumb_save", {
      channelId: job.channelId,
      messageId: job.messageId,
      tier: job.tier === "large" ? "l" : "s",
      data: bytes,
    }).catch(() => null);
    settle(job, saved ? convertFileSrc(saved) : URL.createObjectURL(blob));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const flood = /FLOOD_WAIT_(\d+)/.exec(message);
    if (flood) {
      // Telegram asked us to slow down: pause every worker and retry this job afterwards.
      stats.floodWaits++;
      pausedUntil = Date.now() + Number(flood[1]) * 1000;
      job.started = false;
      jobs.set(job.key, job);
      return;
    }
    stats.failed++;
    stats.lastError = message.slice(0, 160);
    if (stats.failed <= 5) void logStats();
    settle(job, null);
  }
}

// ---- Telegram access -----------------------------------------------------------------------
const messageCache = new Map<string, { message: any; at: number }>();
const fetchQueue = new Map<string, Map<number, Array<(m: any) => void>>>();
const fetchTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Fetches a message. Requests within a short window share one getMessages call. */
function getMessage(channelId: string, messageId: number): Promise<any> {
  const cached = messageCache.get(`${channelId}:${messageId}`);
  if (cached && Date.now() - cached.at < MESSAGE_CACHE_MS) return Promise.resolve(cached.message);
  return new Promise((resolve, reject) => {
    const group = fetchQueue.get(channelId) ?? new Map<number, Array<(m: any) => void>>();
    const waiters = group.get(messageId) ?? [];
    waiters.push((m) => (m instanceof Error ? reject(m) : resolve(m)));
    group.set(messageId, waiters);
    fetchQueue.set(channelId, group);
    if (!fetchTimers.has(channelId)) {
      fetchTimers.set(
        channelId,
        setTimeout(() => void flushMessages(channelId), MESSAGE_BATCH_MS),
      );
    }
  });
}

async function flushMessages(channelId: string) {
  fetchTimers.delete(channelId);
  const group = fetchQueue.get(channelId);
  fetchQueue.delete(channelId);
  if (!group) return;
  const ids = Array.from(group.keys());
  try {
    const peer = await resolvePeer(channelId);
    const messages = await getClient().getMessages(peer, { ids });
    const byId = new Map<number, any>();
    for (const m of messages) if (m?.id) byId.set(m.id, m);
    for (const [id, waiters] of group) {
      const message = byId.get(id) ?? null;
      if (message) messageCache.set(`${channelId}:${id}`, { message, at: Date.now() });
      for (const w of waiters) w(message);
    }
  } catch (err) {
    for (const waiters of group.values()) for (const w of waiters) w(err instanceof Error ? err : new Error(String(err)));
  }
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
  const source = new Blob([bytes], { type: mime });
  // Big photos are decoded at reduced size so a 12 MP image does not cost 48 MB of memory.
  const bitmap =
    bytes.length > RESIZE_ON_DECODE_BYTES
      ? await createImageBitmap(source, { resizeWidth: MAX_EDGE, resizeQuality: "medium" })
      : await createImageBitmap(source);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  } finally {
    bitmap.close();
  }
}

async function makeThumbnail(client: any, media: any, tier: ThumbTier): Promise<Blob | null> {
  const mime: string = media?.document?.mimeType ?? "";
  if (tier === "large" && mime.startsWith("image/")) {
    try {
      const bytes = (await client.downloadMedia(media)) as Uint8Array | undefined;
      if (bytes?.length) {
        stats.fullDownloads++;
        const blob = await scaledImage(bytes, mime);
        if (blob) return blob;
      }
    } catch (err) {
      if (/FLOOD_WAIT/.test(String((err as Error)?.message))) throw err;
      // Undecodable here (e.g. HEIC on some WebViews): fall back to Telegram's thumbnail.
    }
  }
  const index = largestThumbIndex(media);
  // No thumbnail at all: skip rather than let the client download the whole file.
  if (index === undefined) return null;
  const bytes = (await client.downloadMedia(media, { thumb: index })) as Uint8Array | undefined;
  if (!bytes?.length) return null;
  stats.telegramThumbs++;
  return new Blob([bytes], { type: "image/jpeg" });
}
