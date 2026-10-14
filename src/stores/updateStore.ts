import { create } from "zustand";
import type { UpdateInfo } from "@/lib/updater/updater";

interface UpdateState {
  info: UpdateInfo | null;
  dialogOpen: boolean;
  setInfo: (info: UpdateInfo | null) => void;
  openDialog: (info?: UpdateInfo) => void;
  closeDialog: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  info: null,
  dialogOpen: false,
  setInfo: (info) => set({ info }),
  openDialog: (info) => set((state) => ({ info: info ?? state.info, dialogOpen: true })),
  closeDialog: () => set({ dialogOpen: false }),
}));
