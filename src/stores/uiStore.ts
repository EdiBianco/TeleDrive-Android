import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  viewMode: "grid" | "list";
  theme: "light" | "dark" | "system";
  sidebarOpen: boolean;
  sortBy: string;
  filterType: string;
  setViewMode: (viewMode: "grid" | "list") => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSortBy: (sortBy: string) => void;
  setFilterType: (filterType: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      viewMode: "grid",
      theme: "system",
      sidebarOpen: false,
      sortBy: "name_asc",
      filterType: "All",
      setViewMode: (viewMode) => set({ viewMode }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setSortBy: (sortBy) => set({ sortBy }),
      setFilterType: (filterType) => set({ filterType }),
    }),
    {
      name: "teledrive-ui-storage",
    }
  )
);
