/**
 * Compact file index: the minimum needed to place and list each file.
 *
 * Encoded as JSON, with each folder path stored once, then deflated. Per file:
 *   [id, messageId, folderIndex, name, size, flags]
 * Flags: 1 = starred, 2 = trashed, 4 = archived.
 * Dropped on purpose: channelId (one index per channel), mime (derived from the
 * name), upload time (message ids increase with upload order), and folder entries
 * (rebuilt from folder paths on load).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

export interface IndexEntry {
  id: string;
  messageId: number;
  folder: string;
  name: string;
  size: number;
  starred?: boolean;
  trashed?: boolean;
  archived?: boolean;
}

const FORMAT = 3;
const FLAG_STARRED = 1;
const FLAG_TRASHED = 2;
const FLAG_ARCHIVED = 4;

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
      (e.archived ? FLAG_ARCHIVED : 0);
    return [e.id, e.messageId, idx, e.name, e.size, flags];
  });
  const payload: Payload = { v: FORMAT, folders, files };
  return deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
}

export function decodeIndex(bytes: Uint8Array): IndexEntry[] {
  const payload = JSON.parse(strFromU8(inflateSync(bytes))) as Payload;
  if (payload.v !== FORMAT) {
    throw new Error(`Unsupported index format ${payload.v}`);
  }
  return payload.files.map(([id, messageId, folderIdx, name, size, flags]) => {
    const folder = payload.folders[folderIdx];
    if (folder === undefined) {
      throw new Error(`Index row ${id} points at missing folder ${folderIdx}`);
    }
    const entry: IndexEntry = { id, messageId, folder, name, size };
    if (flags & FLAG_STARRED) entry.starred = true;
    if (flags & FLAG_TRASHED) entry.trashed = true;
    if (flags & FLAG_ARCHIVED) entry.archived = true;
    return entry;
  });
}
