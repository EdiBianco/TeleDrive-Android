import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { downloadFileToBuffer } from "../telegram/downloader";
import { saveBinaryFile } from "../storage/safeFileWriter";
import type { TeleFile } from "../types";

/** Downloads a file, stages it in the app cache, and opens it or shares it with other apps. */
export async function openOrShareFile(file: TeleFile, action: "open" | "share"): Promise<void> {
  const toastId = `external-${file.messageId}`;
  try {
    toast.loading(`Preparing "${file.name}"…`, { id: toastId });
    const bytes = await downloadFileToBuffer(file.channelId, file.messageId);
    const path = await invoke<string>("shared_file_path", { name: file.name });
    await saveBinaryFile(path, bytes);
    if (action === "open") {
      await invoke("file_open", { path, mime: file.mime });
    } else {
      await invoke("file_share", { path, mime: file.mime });
    }
    toast.dismiss(toastId);
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err), { id: toastId });
  }
}
