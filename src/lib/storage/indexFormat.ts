/**
 * Compact file index: the minimum needed to place and list each file.
 *
 * Each index chunk is a Telegram text message:
 *   {"teledrive_index":true,"version":3,"chunkIndex":0,"totalChunks":N,"data":"<base64>"}
 * where `data` is a deflated JSON payload holding that chunk's rows only, so every
 * chunk decodes on its own. Payload per chunk:
 *   { v: 3, folders: [path, ...], files: [[id, messageId, folderIndex, name, size, flags], ...] }
 * Folder paths are stored once per chunk. Flags: 1 starred, 2 trashed, 4 archived, 8 directory.
 *
 * Dropped on purpose: channelId (one index per channel), mime (derived from the name),
 * upload time (message ids increase with upload order).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { TeleFile } from "../types";

export interface IndexEntry {
  id: string;
  messageId: number;
  folder: string;
  name: string;
  size: number;
  directory?: boolean;
  starred?: boolean;
  trashed?: boolean;
  archived?: boolean;
}

export const INDEX_VERSION = 3;

/** Base64 characters allowed per message. Telegram caps text at 4096 chars; this leaves room for the envelope. */
export const MAX_CHUNK_DATA_CHARS = 3800;
const FILES_PER_CHUNK = 150;

const FLAG_STARRED = 1;
const FLAG_TRASHED = 2;
const FLAG_ARCHIVED = 4;
const FLAG_DIRECTORY = 8;

type Row = [string, number, number, string, number, number];

interface Payload {
  v: number;
  folders: string[];
  files: Row[];
}

export function encodeIndex(entries: IndexEntry[]): Uint8Array {
  const folders: string[] = [];
  const folderIndex = new Map<string, number>();
  const files: Row[] = entries.map((e) => {
    let idx = folderIndex.get(e.folder);
    if (idx === undefined) {
      idx = folders.length;
      folders.push(e.folder);
      folderIndex.set(e.folder, idx);
    }
    const flags =
      (e.starred ? FLAG_STARRED : 0) |
      (e.trashed ? FLAG_TRASHED : 0) |
      (e.archived ? FLAG_ARCHIVED : 0) |
      (e.directory ? FLAG_DIRECTORY : 0);
    return [e.id, e.messageId, idx, e.name, e.size, flags];
  });
  const payload: Payload = { v: INDEX_VERSION, folders, files };
  return deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
}

export function decodeIndex(bytes: Uint8Array): IndexEntry[] {
  const payload = JSON.parse(strFromU8(inflateSync(bytes))) as Payload;
  if (payload.v !== INDEX_VERSION) {
    throw new Error(`Unsupported index format ${payload.v}`);
  }
  return payload.files.map(([id, messageId, folderIdx, name, size, flags]) => {
    const folder = payload.folders[folderIdx];
    if (folder === undefined) {
      throw new Error(`Index row ${id} points at missing folder ${folderIdx}`);
    }
    const entry: IndexEntry = { id, messageId, folder, name, size };
    if (flags & FLAG_DIRECTORY) entry.directory = true;
    if (flags & FLAG_STARRED) entry.starred = true;
    if (flags & FLAG_TRASHED) entry.trashed = true;
    if (flags & FLAG_ARCHIVED) entry.archived = true;
    return entry;
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** TeleFile -> minimal entry. Folder rows are kept so empty user-created folders survive a reload. */
export function toIndexEntry(file: TeleFile): IndexEntry {
  const directory = file.mime === "inode/directory";
  return {
    id: file.id,
    messageId: file.messageId ?? 0,
    folder: file.folderPath,
    name: file.name,
    size: file.size,
    directory,
    starred: file.starred,
    trashed: file.trashed,
    archived: file.archived,
  };
}

/** Minimal entry -> TeleFile. `mimeFor` derives the MIME type from the name. */
export function fromIndexEntry(
  entry: IndexEntry,
  channelId: string,
  mimeFor: (name: string) => string,
): TeleFile {
  return {
    id: entry.id,
    name: entry.name,
    size: entry.directory ? 0 : entry.size,
    mime: entry.directory ? "inode/directory" : mimeFor(entry.name),
    folderPath: entry.folder,
    messageId: entry.messageId,
    channelId,
    uploadedAt: 0,
    starred: !!entry.starred,
    trashed: !!entry.trashed,
    archived: !!entry.archived,
  };
}

/**
 * Splits the index into chunk `data` strings. Each chunk is compressed on its own and
 * kept under MAX_CHUNK_DATA_CHARS, so a chunk can be read without the others.
 */
export function packIndexChunks(files: TeleFile[]): string[] {
  const entries = files.map(toIndexEntry);
  const out: string[] = [];
  let start = 0;
  do {
    let count = Math.min(FILES_PER_CHUNK, entries.length - start);
    let data = toBase64(encodeIndex(entries.slice(start, start + count)));
    while (data.length > MAX_CHUNK_DATA_CHARS && count > 1) {
      count = Math.ceil(count / 2);
      data = toBase64(encodeIndex(entries.slice(start, start + count)));
    }
    out.push(data);
    start += count;
  } while (start < entries.length);
  return out;
}

/** Reads one chunk's `data` back into TeleFile rows. Throws if the data is malformed. */
export function unpackIndexChunk(
  data: string,
  channelId: string,
  mimeFor: (name: string) => string,
): TeleFile[] {
  return decodeIndex(fromBase64(data)).map((e) => fromIndexEntry(e, channelId, mimeFor));
}
