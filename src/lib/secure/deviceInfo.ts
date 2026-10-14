/**
 * Device identity helpers.
 *
 * Detects the host OS and produces a human-readable device name for the
 * backend's `/api/auth/login` payload. Uses Web APIs only — no Tauri
 * commands needed.
 *
 * The OS string is matched to the backend `OS` enum
 * (`macos | windows | linux | ios | android`). Anything unrecognized falls
 * back to `linux` (the most permissive default for desktop-class devices).
 */
export type OS = 'macos' | 'windows' | 'linux' | 'ios' | 'android';

const USER_AGENT = (typeof navigator !== 'undefined' ? navigator.userAgent : '').toLowerCase();
const PLATFORM =
  (typeof navigator !== 'undefined'
    ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ''
    : '').toLowerCase() || (typeof navigator !== 'undefined' ? navigator.platform : '').toLowerCase();

/**
 * Detect the host OS. Order matters: iOS UA contains 'mac' substrings and
 * 'like mac os x' for iPad, so we check iOS/Android first on UA before
 * falling back to platform strings.
 */
export function detectOS(): OS {
  // iPadOS 13+ reports as Mac in UA but userAgentData.platform is correct.
  if (PLATFORM === 'ios' || /ipad|iphone|ipod/.test(USER_AGENT)) return 'ios';
  if (/android/.test(USER_AGENT)) return 'android';
  if (PLATFORM.startsWith('mac') || /macintosh|mac os x/.test(USER_AGENT)) return 'macos';
  if (PLATFORM.startsWith('win') || /windows/.test(USER_AGENT)) return 'windows';
  if (PLATFORM.startsWith('linux') || /linux|x11/.test(USER_AGENT)) return 'linux';
  // Tauri itself is a desktop app — 'linux' is the safest fallback.
  return 'linux';
}

const OS_LABEL: Record<OS, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
};

/**
 * Human-readable device name shown in the backend's device list and the
 * Settings → Plan & Devices panel. Example: "TeleDrive Desktop on macOS".
 */
export function getDeviceName(): string {
  return `TeleDrive Desktop on ${OS_LABEL[detectOS()]}`;
}
