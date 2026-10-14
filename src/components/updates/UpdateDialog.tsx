import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUpdateStore } from "@/stores/updateStore";
import { downloadUpdate, installUpdate } from "@/lib/updater/updater";

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; bytes: number; total: number }
  | { kind: "installing" }
  | { kind: "needs-permission" }
  | { kind: "error"; message: string };

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UpdateDialog() {
  const info = useUpdateStore((s) => s.info);
  const open = useUpdateStore((s) => s.dialogOpen);
  const closeDialog = useUpdateStore((s) => s.closeDialog);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (!info) return null;

  const busy = phase.kind === "downloading" || phase.kind === "installing";

  async function handleInstall() {
    if (!info) return;
    try {
      setPhase({ kind: "downloading", bytes: 0, total: info.size });
      const path = await downloadUpdate(info, (bytes, total) =>
        setPhase({ kind: "downloading", bytes, total }),
      );
      setPhase({ kind: "installing" });
      const needsPermission = await installUpdate(path);
      if (needsPermission) {
        setPhase({ kind: "needs-permission" });
      } else {
        closeDialog();
        toast.success("Confirm the install in Android to finish updating.");
      }
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && !next && closeDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>TeleDrive {info.version} is available</DialogTitle>
          <DialogDescription>
            You have {info.current}. Your files and settings stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-60 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs whitespace-pre-wrap">
          {info.notes.trim() || "No release notes for this version."}
        </div>

        {phase.kind === "downloading" && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-[#0B57D0] transition-all"
                style={{ width: `${phase.total ? Math.min(100, (phase.bytes / phase.total) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-[#747775]">
              Downloading {formatMb(phase.bytes)} of {formatMb(phase.total)}
            </p>
          </div>
        )}
        {phase.kind === "installing" && <p className="text-xs text-[#747775]">Opening the Android installer…</p>}
        {phase.kind === "needs-permission" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Allow installs from TeleDrive in the Android settings that just opened, then press Install again.
          </p>
        )}
        {phase.kind === "error" && <p className="text-xs text-rose-600 dark:text-rose-400">{phase.message}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog} disabled={busy} className="rounded-full">
            Later
          </Button>
          <Button onClick={handleInstall} disabled={busy} className="rounded-full">
            {phase.kind === "error" || phase.kind === "needs-permission" ? "Try again" : "Download & install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
