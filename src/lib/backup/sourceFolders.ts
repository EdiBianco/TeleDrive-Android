/**
 * Device backup — source-folder configuration.
 *
 * The user's backup configuration is a list of absolute local paths plus a
 * list of exclude globs. The walker (walker.ts) consumes this shape and
 * produces a flat file list filtered against the excludes.
 *
 * Excludes are simple glob patterns matched against the path RELATIVE to
 * the source folder root, using forward-slash separators regardless of
 * platform (we normalize before matching). Examples:
 *
 *   `node_modules`         → matches a top-level `node_modules` directory
 *                            anywhere in the tree
 *   `*.tmp`                → matches any file ending in `.tmp`
 *   `build/`               → matches a `build/` directory at any depth
 *   `<globstar>/.DS_Store` → matches the macOS metadata file anywhere
 *
 * We deliberately support a SMALL subset of glob syntax to keep the matcher
 * dependency-free: `` `*` `` (any chars except `/`), `` `**` `` (any chars
 * including `/`), and `` `?` `` (any single char). Anything more exotic
 * (regex-style classes, alternation `{a,b}`) is not supported — power
 * users can refine their folder picks instead.
 */

/** Shape returned by `GET /api/user/me` for backup configuration. */
export interface BackupSourceFolders {
  paths: string[];
  excludes: string[];
}

/** Result of matching a relative path against the user's exclude patterns. */
export interface ExcludeMatch {
  /** True if any exclude pattern matched this relative path. */
  matches: boolean;
  /** The pattern that matched (for logging/diagnostics). Undefined on no-match. */
  pattern?: string;
}

/**
 * Normalize a relative path to forward-slash form so cross-platform glob
 * matching works. Strips a leading `./`, collapses `//` to `/`, strips
 * trailing `/` on directory patterns.
 */
export function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

/**
 * Compile an exclude glob into a RegExp. Returns null if the pattern is
 * invalid (defensive — should never happen since the backend validates
 * lengths and the syntax is small).
 *
 * Supports:
 *   - `*`         → any run of non-slash chars
 *   - `**`        → any run of chars (including `/`)
 *   - `?`         → any single non-slash char
 *   - everything else is a literal (regex-escaped)
 */
export function globToRegex(pattern: string): RegExp | null {
  if (!pattern) return null;
  const normalized = normalizeRelativePath(pattern);
  let regex = "^";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === "*" && normalized[i + 1] === "*") {
      regex += ".*";
      i++;
      // Eat an optional trailing `/` so `**\/` matches a directory boundary
      // cleanly. `**/foo` matches `foo` at any depth including root.
      if (normalized[i + 1] === "/") i++;
    } else if (c === "*") {
      regex += "[^/]*";
    } else if (c === "?") {
      regex += "[^/]";
    } else if (/[.+^$(){}|[\]\\]/.test(c)) {
      regex += "\\" + c;
    } else {
      regex += c;
    }
  }
  regex += "$";
  try {
    return new RegExp(regex);
  } catch {
    return null;
  }
}

export const DEFAULT_EXCLUDES = [
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
  ".DS_Store",
  "**/.DS_Store",
  "._*",
  "**/._*",
  "node_modules",
  "node_modules/**",
  "**/node_modules",
  "**/node_modules/**",
  "Thumbs.db",
  "**/Thumbs.db",
  "desktop.ini",
  "**/desktop.ini",
  "ehthumbs.db",
  "**/ehthumbs.db",
  ".directory",
  "**/.directory",
  "*.tmp",
  "**/*.tmp",
  "*.bak",
  "**/*.bak",
  "*~",
  "**/*~",
];

/**
 * Test whether a single relative path matches any of the user's exclude
 * patterns or default system excludes. Used by the walker to skip files/directories.
 *
 * @param relPath  Path relative to the source-folder root, with forward slashes.
 *                 Example: `node_modules/foo/index.js` or `Documents/report.pdf`.
 * @param excludes The user's exclude patterns (compiled lazily on first use).
 */
export function pathMatchesExclude(
  relPath: string,
  excludes: string[],
): ExcludeMatch {
  const normalized = normalizeRelativePath(relPath);
  const allPatterns = [...DEFAULT_EXCLUDES, ...(excludes || [])];
  for (const pattern of allPatterns) {
    const re = globToRegex(pattern);
    if (re && re.test(normalized)) {
      return { matches: true, pattern };
    }
  }
  return { matches: false };
}

/**
 * Test whether a directory path (used as the walker descends) should be
 * skipped entirely. Same logic as pathMatchesExclude but intended for
 * directory boundaries — a slightly different call site makes intent
 * clearer in the walker.
 */
export function directoryShouldBeExcluded(
  relDirPath: string,
  excludes: string[],
): boolean {
  // Empty path means we're at the source root — never skip the root.
  if (!relDirPath) return false;
  return pathMatchesExclude(relDirPath, excludes).matches;
}