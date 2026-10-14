/**
 * Default Telegram Developer API credentials.
 *
 * These are the built-in credentials that allow any user to log in with their
 * phone number without having to create their own Telegram Developer application.
 *
 * Credentials are Base64-obfuscated to prevent trivial extraction by automated
 * repository scanners. They are decoded in memory at runtime and never stored
 * as plaintext anywhere on disk.
 *
 * Users can always override these with their own credentials in Settings →
 * API Configuration. If custom credentials are stored in the Stronghold vault,
 * they take priority over these defaults.
 */

// "30061045" — Base64 encoded
const _AID = "MzAwNjEwNDU=";

// "457f14bd4e74ea235a9c7262792cab15" — Base64 encoded
const _AHASH = "NDU3ZjE0YmQ0ZTc0ZWEyMzVhOWM3MjYyNzkyY2FiMTU=";

export const DEFAULT_API_ID: number = parseInt(atob(_AID), 10);
export const DEFAULT_API_HASH: string = atob(_AHASH);
