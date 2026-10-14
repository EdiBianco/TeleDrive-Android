import { useEffect } from "react";
import { toast } from "sonner";
import { checkForUpdate, isAutoCheckDue, markAutoCheckRan } from "@/lib/updater/updater";
import { useUpdateStore } from "@/stores/updateStore";

/** Checks for a newer release once a day, shortly after launch. Quietly does nothing on failure. */
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    if (!isAutoCheckDue()) return;
    const timer = window.setTimeout(async () => {
      markAutoCheckRan();
      try {
        const info = await checkForUpdate();
        if (!info) return;
        useUpdateStore.getState().setInfo(info);
        toast.info(`TeleDrive ${info.version} is available`, {
          action: { label: "View", onClick: () => useUpdateStore.getState().openDialog() },
        });
      } catch (err) {
        console.warn("[updater] automatic check failed:", err);
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);
}
