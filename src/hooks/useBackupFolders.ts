/**
 * useBackupFolders — manages the backup source-folder configuration.
 *
 * Config is now stored in localStorage via the licenseStore stub.
 * All users can configure backup folders — no Pro gate.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLicenseStore } from "@/stores/licenseStore";

export interface UseBackupFolders {
  /** Source folder paths (absolute local paths). */
  paths: string[];
  /** Exclude glob patterns (matched relative to each source root). */
  excludes: string[];
  /** Always true — backup is available to all users. */
  isPro: boolean;
  /** True while a save is currently in flight. */
  isSaving: boolean;
  /** Add a folder path. No-op if already present (dedupe). */
  addFolder: (absPath: string) => void;
  /** Remove a folder path by exact match. */
  removeFolder: (absPath: string) => void;
  /** Add an exclude glob pattern. No-op if already present (dedupe). */
  addExclude: (pattern: string) => void;
  /** Remove an exclude pattern by exact match. */
  removeExclude: (pattern: string) => void;
}

export function useBackupFolders(): UseBackupFolders {
  const persisted = useLicenseStore((s) => s.backupFolders);
  const setLicenseBackupFolders = useLicenseStore((s) => s.setProBackupFolders);

  const paths = persisted?.paths ?? [];
  const excludes = persisted?.excludes ?? [];

  const [isSaving, setIsSaving] = useState(false);
  const inflight = useRef<{ paths: string[]; excludes: string[] } | null>(null);

  useEffect(() => {
    const w = inflight.current;
    if (!w) return;
    const same =
      sameArr(w.paths, persisted?.paths ?? []) &&
      sameArr(w.excludes, persisted?.excludes ?? []);
    if (same) {
      inflight.current = null;
      setIsSaving(false);
    }
  }, [persisted?.paths, persisted?.excludes]);

  const persist = useCallback(
    async (nextPaths: string[], nextExcludes: string[]) => {
      inflight.current = { paths: nextPaths, excludes: nextExcludes };
      setIsSaving(true);
      try {
        await setLicenseBackupFolders({ paths: nextPaths, excludes: nextExcludes });
      } catch {
        // ignore
      } finally {
        const w = inflight.current;
        if (w && sameArr(w.paths, nextPaths) && sameArr(w.excludes, nextExcludes)) {
          inflight.current = null;
          setIsSaving(false);
        }
      }
    },
    [setLicenseBackupFolders],
  );

  const addFolder = useCallback(
    (absPath: string) => {
      const trimmed = absPath.trim();
      if (!trimmed) return;
      if (paths.includes(trimmed)) return;
      void persist([...paths, trimmed], excludes);
    },
    [paths, excludes, persist],
  );

  const removeFolder = useCallback(
    (absPath: string) => {
      const next = paths.filter((p) => p !== absPath);
      if (next.length === paths.length) return;
      void persist(next, excludes);
    },
    [paths, excludes, persist],
  );

  const addExclude = useCallback(
    (pattern: string) => {
      const trimmed = pattern.trim();
      if (!trimmed) return;
      if (excludes.includes(trimmed)) return;
      void persist(paths, [...excludes, trimmed]);
    },
    [paths, excludes, persist],
  );

  const removeExclude = useCallback(
    (pattern: string) => {
      const next = excludes.filter((p) => p !== pattern);
      if (next.length === excludes.length) return;
      void persist(paths, next);
    },
    [paths, excludes, persist],
  );

  return {
    paths,
    excludes,
    isPro: true, // Always true — backup available to all users
    isSaving,
    addFolder,
    removeFolder,
    addExclude,
    removeExclude,
  };
}

function sameArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}