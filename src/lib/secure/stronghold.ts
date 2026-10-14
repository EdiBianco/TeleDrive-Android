/**
 * Tauri Stronghold wrapper.
 *
 * Stronghold is an encrypted, password-derived secret store that lives inside
 * the app data dir. This is the first time we actually use it (the plugin
 * has been wired in Cargo.toml + JS deps + capabilities but unused until now).
 *
 * We use it for:
 *   - The backend JWT (`backend_jwt`)
 *   - The raw installation ID (`installation_id`) — only the SHA-256 hash
 *     ever leaves the device; the raw UUID stays encrypted at rest.
 *
 * If Stronghold fails to init (corrupted snapshot, platform mismatch, etc.)
 * `initStronghold()` throws so the caller can fall back to the existing
 * plaintext JSON vault (`src/lib/secure/vault.ts`). That keeps the app usable
 * on weird configurations at the cost of these two values being in plaintext.
 *
 * The Stronghold "password" passed to `load()` is a static JS-only constant.
 * Defense in depth comes from the Rust-side KDF in the plugin and the OS's
 * per-user file permissions on the snapshot file.
 */
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { appDataDir, join } from '@tauri-apps/api/path';

const STRONGHOLD_PASSWORD = 'teledrive-desktop-stronghold-v1';
const CLIENT_NAME = 'teledrive';

let initPromise: Promise<{ get: typeof shGet; set: typeof shSet; remove: typeof shRemove; save: () => Promise<void> }> | null = null;
let stronghold: Stronghold | null = null;

/**
 * Lazy, idempotent Stronghold initialization. Resolves to a tuple of bound
 * get/set/remove/save helpers. Multiple callers share the same promise so
 * we never race on initialization.
 *
 * Throws on init failure — caller should fall back to plaintext vault.
 */
export async function initStronghold(): Promise<{
  get: typeof shGet;
  set: typeof shSet;
  remove: typeof shRemove;
  save: () => Promise<void>;
}> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dir = await appDataDir();
    const snapshotPath = await join(dir, 'stronghold.bin');
    stronghold = await Stronghold.load(snapshotPath, STRONGHOLD_PASSWORD);
    return { get: shGet, set: shSet, remove: shRemove, save: shSave };
  })().catch((err) => {
    initPromise = null; // allow retry on next call
    throw err;
  });

  return initPromise;
}

/** Get the cached Stronghold instance, or null if not yet initialized. */
async function getStore() {
  if (!stronghold) {
    throw new Error('Stronghold not initialized — call initStronghold() first.');
  }
  const client = await stronghold.loadClient(CLIENT_NAME);
  return client.getStore();
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Read a string value. Returns null if missing. */
export async function shGet(key: string): Promise<string | null> {
  const store = await getStore();
  const bytes = await store.get(key);
  return bytes ? decoder.decode(bytes) : null;
}

/** Write a string value. Does not auto-persist — call `shSave()` to flush. */
export async function shSet(key: string, value: string): Promise<void> {
  const store = await getStore();
  await store.insert(key, Array.from(encoder.encode(value)));
}

/** Remove a key. Returns the previous value if any, else null. */
export async function shRemove(key: string): Promise<string | null> {
  const store = await getStore();
  const bytes = await store.remove(key);
  return bytes ? decoder.decode(bytes) : null;
}

/** Flush Stronghold state to disk. Call after a batch of writes. */
export async function shSave(): Promise<void> {
  if (!stronghold) return;
  await stronghold.save();
}
