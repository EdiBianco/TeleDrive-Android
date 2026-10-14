import { Api } from "telegram";
import { getClient } from "./client";
import { getSecret, saveSecret, VAULT_KEY_CHANNEL_ID, channelIdKey } from "../secure/vault";

/**
 * Ensures the TeleDrive Storage channel exists for the given phone number.
 *
 * Multi-account design:
 *   Each Telegram account stores its channel ID under a phone-specific vault key:
 *   e.g. "telegram_channel_id_+918653420095"
 *
 *   This means logging in with Account A and Account B never interferes — each
 *   account finds its own channel and its own uploaded files.
 *
 * Lookup order:
 *   1. Phone-specific vault key  (fast path, normal case)
 *   2. Legacy generic key        (migration: single-account installs before this change)
 *   3. Dialog search             (recovery: vault cleared / first run on new device)
 *   4. Create new channel        (first-ever login for this account)
 */
export async function ensureStorageChannel(phone: string): Promise<string> {
  const client = getClient();
  const phoneKey = channelIdKey(phone);

  // ── 1. Phone-specific vault key (fast path) ──────────────────────────────
  let channelId = await getSecret(phoneKey);

  if (channelId) {
    try {
      const peer = await client.getEntity(channelId);
      if (peer) return channelId;
    } catch (err) {
      console.warn(`[channelManager] Phone-keyed channel ${channelId} not accessible, continuing…`, err);
      channelId = null;
    }
  }

  // ── 2. Legacy generic key (migration path for existing installs) ─────────
  if (!channelId) {
    const legacyId = await getSecret(VAULT_KEY_CHANNEL_ID);
    if (legacyId) {
      try {
        const peer = await client.getEntity(legacyId);
        if (peer) {
          // Migrate: write under the phone-specific key so future lookups are fast
          await saveSecret(phoneKey, legacyId);
          console.info(`[channelManager] Migrated legacy channel ID ${legacyId} → ${phoneKey}`);
          return legacyId;
        }
      } catch (err) {
        console.warn(`[channelManager] Legacy channel ${legacyId} not accessible, searching dialogs…`, err);
      }
    }
  }

  // ── 3. Search dialogs for "TeleDrive Storage" ────────────────────────────
  try {
    const dialogs = await client.getDialogs({});
    for (const dialog of dialogs) {
      if (
        dialog.title === "TeleDrive Storage" &&
        (dialog.isChannel || dialog.entity?.className === "Channel") &&
        dialog.id
      ) {
        // dialog.id from GramJS is BigInt; normalise to a plain string
        // Use the absolute value with -100 prefix which is how Telegram identifies supergroups/channels
        const rawId = String(dialog.id);
        await saveSecret(phoneKey, rawId);
        console.info(`[channelManager] Found channel via dialog search: ${rawId}`);
        return rawId;
      }
    }
  } catch (err) {
    console.warn("[channelManager] Dialog search failed:", err);
  }

  // ── 4. Create a new private channel (first-ever login for this account) ──
  try {
    const result = await client.invoke(
      new Api.channels.CreateChannel({
        title: "TeleDrive Storage",
        about: "Private storage channel managed by TeleDrive. Do not delete or modify pinned messages.",
        broadcast: true,
      })
    );

    const chats = (result as any).chats || [];
    const channel = chats[0];
    if (!channel) {
      throw new Error("Failed to create storage channel: channel info missing in updates");
    }

    const idStr = String(channel.id);
    await saveSecret(phoneKey, idStr);
    console.info(`[channelManager] Created new channel: ${idStr} for ${phoneKey}`);
    return idStr;
  } catch (err) {
    console.error("[channelManager] Failed to create storage channel:", err);
    throw err;
  }
}

/**
 * Look up the storage channel id WITHOUT contacting Telegram.
 *
 * Used by the multi-device sync orchestrator and the backup scheduler,
 * both of which need to know the channel id WITHOUT triggering a full
 * `ensureStorageChannel` (which would do dialog searches and potentially
 * create a new channel — too heavy for a background tick).
 *
 * Returns the phone-keyed id if present, else the legacy generic key.
 * Returns null if neither is set yet (i.e. user hasn't completed first
 * login). The caller should treat null as "wait for bootstrap" and
 * retry shortly.
 *
 * @param phone  The authenticated phone number, e.g. "+918653420095".
 *               Falls back to the legacy generic key if empty.
 */
export async function getStorageChannelId(phone?: string | null): Promise<string | undefined> {
  const phoneStr = phone ?? "";
  try {
    if (phoneStr) {
      const phoneKey = channelIdKey(phoneStr);
      const id = await getSecret(phoneKey);
      if (id) return id;
    }
    const legacy = await getSecret(VAULT_KEY_CHANNEL_ID);
    return legacy ?? undefined;
  } catch {
    return undefined;
  }
}

