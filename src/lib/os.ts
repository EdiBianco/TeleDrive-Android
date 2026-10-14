/**
 * Platform and operating system detection utilities.
 * Ensures consistent behavior and keyboard shortcut representations
 * across macOS, Windows, and Linux.
 */

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent);
}

export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Win/i.test(navigator.platform || navigator.userAgent);
}

export function isLinux(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Linux/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Returns the platform-appropriate primary modifier key prefix:
 * - "⌘" on macOS
 * - "Ctrl+" on Windows and Linux
 */
export function getModKey(): string {
  return isMac() ? "⌘" : "Ctrl+";
}

/**
 * Formats a key combination for display to the user based on their OS.
 * e.g. formatShortcut("F") => "⌘F" on macOS, "Ctrl+F" on Windows/Linux
 */
export function formatShortcut(key: string): string {
  return `${getModKey()}${key}`;
}
