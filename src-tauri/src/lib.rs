use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_keepalive::KeepAliveExt;
use tauri_plugin_apkupdate::ApkUpdateExt;
use tauri_plugin_fileshare::FileShareExt;
use tauri_plugin_storage::StorageExt;
use tauri_plugin_keystore::KeystoreExt;
use tokio::sync::Mutex as AsyncMutex;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn log_vault_state(state: String) {
    use std::fs::OpenOptions;
    use std::io::Write;
    let log_path = std::path::Path::new("vault_state.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        writeln!(file, "{state}").ok();
    }
}

/// Returns the last N lines of vault_state.log for the diagnostics page.
/// Reads the same file the frontend writes to via log_vault_state, so the
/// output mirrors the live state of the index pipeline without requiring
/// any extra instrumentation on the JS side.
#[tauri::command]
fn get_vault_state(lines: Option<usize>) -> Result<String, String> {
    let limit = lines.unwrap_or(200);
    let log_path = std::path::Path::new("vault_state.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    let contents = std::fs::read_to_string(log_path)
        .map_err(|e| format!("Failed to read vault_state.log: {e}"))?;

    // Take the last `limit` lines without loading more than needed.
    let collected: Vec<&str> = contents.lines().rev().take(limit).collect();
    let mut out: Vec<&str> = collected;
    out.reverse();
    Ok(out.join("\n"))
}



/// Wraps a plaintext value so only sealed (Keystore-encrypted) bytes reach disk.
fn seal_entry(app: &AppHandle, plain: &str) -> Result<serde_json::Value, String> {
    let blob = app
        .keystore()
        .seal(plain)
        .map_err(|e| format!("Failed to seal value: {e}"))?;
    Ok(serde_json::json!({ "enc": blob }))
}

/// Reads a stored entry. A bare string is a legacy plaintext value written before sealing;
/// callers accept it and re-seal it on read.
fn open_entry(app: &AppHandle, entry: &serde_json::Value) -> Result<Option<String>, String> {
    match entry {
        serde_json::Value::String(plain) => Ok(Some(plain.clone())),
        serde_json::Value::Object(obj) => match obj.get("enc").and_then(|v| v.as_str()) {
            Some(blob) => app
                .keystore()
                .unseal(blob)
                .map(Some)
                .map_err(|e| format!("Failed to open value: {e}")),
            None => Ok(None),
        },
        _ => Ok(None),
    }
}

/// Saves the Telegram session and phone, sealed. Session grants full account access, so it is never plaintext on disk.
#[tauri::command]
fn save_session(app: tauri::AppHandle, session: String, phone: String) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    let json = serde_json::json!({
        "session": seal_entry(&app, &session)?,
        "phone": seal_entry(&app, &phone)?,
    });
    std::fs::write(&session_path, json.to_string())
        .map_err(|e| format!("Failed to write session file: {e}"))
}

/// Loads the Telegram session and phone. Returns null fields if no session file exists.
#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(serde_json::json!({ "session": null, "phone": null }));
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {e}"))?;
    let parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {e}"))?;

    let session = match parsed.get("session") {
        Some(entry) => open_entry(&app, entry)?,
        None => None,
    };
    let phone = match parsed.get("phone") {
        Some(entry) => open_entry(&app, entry)?,
        None => None,
    };

    // Migrate a legacy plaintext session file to sealed form.
    let legacy = matches!(parsed.get("session"), Some(serde_json::Value::String(_)))
        || matches!(parsed.get("phone"), Some(serde_json::Value::String(_)));
    if legacy {
        if let (Some(s), Some(p)) = (session.as_deref(), phone.as_deref()) {
            let _ = save_session(app.clone(), s.to_string(), p.to_string());
        }
    }

    Ok(serde_json::json!({ "session": session, "phone": phone }))
}

/// Clears the saved session file (used on logout).
#[tauri::command]
fn clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if session_path.exists() {
        std::fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {e}"))?;
    }
    Ok(())
}

/// Clears ONLY the session token while preserving the phone number.
/// Used during logout so the phone-keyed channel ID can still be found on next login.
#[tauri::command]
fn clear_session_only(app: tauri::AppHandle) -> Result<(), String> {
    let session_path = get_session_path(&app)?;
    if !session_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&session_path)
        .map_err(|e| format!("Failed to read session file: {e}"))?;
    let mut parsed: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file: {e}"))?;
    // Null out the session token but keep the phone number
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert("session".to_string(), serde_json::Value::Null);
    }
    std::fs::write(&session_path, parsed.to_string())
        .map_err(|e| format!("Failed to write session file: {e}"))
}

/// Saves a key-value pair to the vault file. The value is sealed before it is written.
#[tauri::command]
fn save_vault_value(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    let mut data = if vault_path.exists() {
        let contents = std::fs::read_to_string(&vault_path)
            .map_err(|e| format!("Failed to read vault file: {e}"))?;
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&contents)
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    data.insert(key, seal_entry(&app, &value)?);

    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
}

/// Loads a value for a key from the vault file. Legacy plaintext entries are re-sealed on read.
#[tauri::command]
fn load_vault_value(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(None);
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    let Some(entry) = data.get(&key) else {
        return Ok(None);
    };
    let plain = open_entry(&app, entry)?;
    if let (serde_json::Value::String(_), Some(p)) = (entry, plain.as_deref()) {
        let _ = save_vault_value(app.clone(), key.clone(), p.to_string());
    }
    Ok(plain)
}

/// Deletes a key-value pair from the vault file.
#[tauri::command]
fn delete_vault_value(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    data.remove(&key);

    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
}

/// Quarantines a vault value: reads the value at `key` and copies it under
/// `backup_key` (so it can be inspected/recovered later), then deletes the
/// original. No-op if `key` is missing.
///
/// Used by the backup manifest layer to preserve corrupt JSON instead of
/// silently losing it. The runner checks the sentinel after a failed
/// loadManifest and refuses to upload — the user can manually inspect
/// the quarantined value and decide what to do.
#[tauri::command]
fn quarantine_vault_value(
    app: tauri::AppHandle,
    key: String,
    backup_key: String,
) -> Result<(), String> {
    let vault_path = get_vault_path(&app)?;
    if !vault_path.exists() {
        return Ok(());
    }
    let contents = std::fs::read_to_string(&vault_path)
        .map_err(|e| format!("Failed to read vault file: {e}"))?;
    let mut data: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse vault file: {e}"))?;

    if let Some(value) = data.remove(&key) {
        data.insert(backup_key, value);
    }

    std::fs::write(&vault_path, serde_json::to_string(&data).unwrap())
        .map_err(|e| format!("Failed to write vault file: {e}"))
}

fn get_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(data_dir.join("teledrive_vault.json"))
}

fn get_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(data_dir.join("teledrive_session.json"))
}

// ============================================================================
// Scheduled backup timer (Pro feature)
//
// The desktop owns the actual schedule timer — the backend stores the
// user-configured cadence on the License, but the backend never has the
// Telegram session so it can't run the snapshot. The Rust side is just a
// reliable interval timer that emits a `teledrive://backup-tick` Tauri event
// into the webview; the JS handler in App.tsx does the actual Telegram
// send + audit POST.
//
// Only ONE timer can be active at a time. Calling start_backup_scheduler
// while another timer is running first stops the existing one. This makes
// changing the interval safe and idempotent.
// ============================================================================

static SCHEDULED_BACKUP_HANDLE: OnceLock<AsyncMutex<Option<JoinHandle<()>>>> = OnceLock::new();

fn handle_slot() -> &'static AsyncMutex<Option<JoinHandle<()>>> {
    SCHEDULED_BACKUP_HANDLE.get_or_init(|| AsyncMutex::new(None))
}

/// Start the scheduled backup timer. `interval_minutes` must be > 0.
/// Replaces any existing timer. The first tick fires after `interval_minutes`
/// (no immediate fire on start — that would surprise the user right after
/// they click "Daily").
#[tauri::command]
async fn start_backup_scheduler(app: AppHandle, interval_minutes: u64) -> Result<(), String> {
    if interval_minutes == 0 {
        return Err("interval_minutes must be greater than 0".into());
    }

    // Stop any existing timer first so the interval change is honored.
    stop_backup_scheduler_internal(&app).await;

    let app_handle = app.clone();
    let period = Duration::from_secs(interval_minutes * 60);
    let handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        // First tick fires immediately by default — skip it so we wait one
        // full period before the first backup, matching user expectations.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(err) = app_handle.emit("teledrive://backup-tick", ()) {
                eprintln!("[backup_scheduler] failed to emit tick: {err}");
                // Don't break the loop on emit error — keep ticking. The JS
                // side just won't hear this one. The next tick is N minutes
                // away, so it's recoverable.
            }
        }
    });

    let mut guard = handle_slot().lock().await;
    *guard = Some(handle);
    drop(guard);
    log_vault_state(format!(
        "BACKUP_SCHEDULER_START interval_minutes={interval_minutes}"
    ));
    // Keep the process alive so the timer keeps running with the app in the background.
    // Starting a foreground service fails if the app is not in the foreground; the timer
    // still runs while the app is open, so log and continue.
    if let Err(err) = app.keepalive().start() {
        log_vault_state(format!("BACKUP_KEEPALIVE_START_FAILED {err}"));
    }
    Ok(())
}

/// Stop the scheduled backup timer. No-op if no timer is running.
#[tauri::command]
async fn stop_backup_scheduler(app: AppHandle) -> Result<(), String> {
    stop_backup_scheduler_internal(&app).await;
    log_vault_state("BACKUP_SCHEDULER_STOP".to_string());
    Ok(())
}

async fn stop_backup_scheduler_internal(app: &AppHandle) {
    let mut guard = handle_slot().lock().await;
    if let Some(handle) = guard.take() {
        // tauri::async_runtime::JoinHandle has an inherent .abort() that
        // delegates to the underlying Tokio handle. We always spawn on
        // Tokio (via tauri::async_runtime::spawn), so this is safe.
        handle.abort();
    }
    drop(guard);
    if let Err(err) = app.keepalive().stop() {
        log_vault_state(format!("BACKUP_KEEPALIVE_STOP_FAILED {err}"));
    }
}

// ============================================================================
// Device-backup filesystem walker (Pro feature)
//
// Used by the JS-side backup runner to enumerate a user-chosen source
// folder. Tauri's plugin-fs `readDir` returns DirEntry records WITHOUT
// size or mtime — that would force a separate `stat` IPC per file,
// unacceptable for a 100k-file folder. This single Rust command does the
// whole walk in one shot, returning flat entries the JS layer can
// deserialize and diff against its local manifest.
//
// Output shape (matches `RustDirEntry` in src/lib/backup/walker.ts):
//   { absPath: string, relPath: string, isDir: bool, size: number, mtimeMs: number }
//
// We skip symlinks (would loop on `/var -> /private/var`) and unreadable
// files (logged as warnings, walker continues with the rest). The JS side
// does exclude-glob filtering; Rust just returns everything raw so the
// filter happens in one place the user can read.
// ============================================================================

use serde::Serialize;

#[derive(Serialize)]
struct DirEntry {
    abs_path: String,
    rel_path: String,
    is_dir: bool,
    size: u64,
    mtime_ms: u64,
}

fn unix_ms(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn walk_recursive(root: &Path, current: &Path, skip: &[String], out: &mut Vec<DirEntry>) {
    let entries = match std::fs::read_dir(current) {
        Ok(it) => it,
        Err(err) => {
            eprintln!("[read_dir_recursive] read_dir({current:?}) failed: {err}");
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue, // skip non-UTF8 names
        };

        // Symlink check via metadata — read_link would also work but we
        // want to skip BEFORE stat so we don't follow the link.
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue, // dangling or unreadable — skip
        };

        let is_dir = meta.is_dir();
        let size = if is_dir { 0 } else { meta.len() };
        let mtime_ms = unix_ms(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));

        // Compute relPath relative to the source root.
        let rel_path = match path.strip_prefix(root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => file_name.clone(),
        };

        out.push(DirEntry {
            abs_path: path.to_string_lossy().into_owned(),
            rel_path,
            is_dir,
            size,
            mtime_ms,
        });

        // Recurse into directories, except cache/trash/thumbnail folders.
        if is_dir && !skip.iter().any(|s| s.eq_ignore_ascii_case(&file_name)) {
            walk_recursive(root, &path, skip, out);
        }
    }
}

#[tauri::command]
async fn read_dir_recursive(path: String, skip_dirs: Vec<String>) -> Result<Vec<DirEntry>, String> {
    let root = Path::new(&path);
    let meta = std::fs::metadata(root).map_err(|e| format!("stat({path}) failed: {e}"))?;
    if !meta.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    // Run the walk on a blocking thread — std::fs::read_dir is sync and
    // can be slow on huge trees. Tokio would block the runtime otherwise.
    let path_owned = path.clone();
    let entries = tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<DirEntry> = Vec::new();
        walk_recursive(Path::new(&path_owned), Path::new(&path_owned), &skip_dirs, &mut out);
        out
    })
    .await
    .map_err(|e| format!("walker join failed: {e}"))?;
    Ok(entries)
}

/// Reads `length` bytes from `path` starting at `offset`. Returns the bytes
/// as a Vec<u8>; the JS side wraps them in a Uint8Array for upload chunks.
///
/// This is the Rust-side replacement for `@tauri-apps/plugin-fs`'s `open()`
/// + `seek()` + `read()`. The JS plugin-fs is constrained by capability
/// scopes (`fs:allow-open` etc.) — for backup source folders the user picks
/// arbitrary paths that are NOT in any scope, so the plugin denies every
/// read. The Rust side runs with full filesystem access (Tauri's Rust
/// commands are not subject to the JS plugin-fs scope), so this command
/// works for any path the OS can read.
/// Path where a file is staged for open/share: <app cache>/shared/<safe name>.
/// The directory is created if needed; the caller writes the bytes there.
#[tauri::command]
fn shared_file_path(app: AppHandle, name: String) -> Result<String, String> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir unavailable: {e}"))?
        .join("shared");
    std::fs::create_dir_all(&base).map_err(|e| format!("create shared dir failed: {e}"))?;
    // Keep only the file name: no folders, no path tricks.
    let safe: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .chars()
        .map(|c| if "<>:\"|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let safe = if safe.trim().is_empty() || safe == "." || safe == ".." { "file".to_string() } else { safe };
    Ok(base.join(safe).to_string_lossy().into_owned())
}

/// Viewer cache: full-size media played from disk through the asset protocol.
const VIEWER_CACHE_LIMIT: u64 = 400 * 1024 * 1024;

#[derive(serde::Serialize)]
struct ViewerEntry {
    path: String,
    part: String,
    ready: bool,
}

/// Where the viewer keeps one file: <app cache>/viewer/<channel>_<message>.<ext>.
/// `ready` means a finished copy exists; otherwise write to `part`, then commit.
#[tauri::command]
fn viewer_cache_entry(app: AppHandle, channel_id: String, message_id: i64, name: String) -> Result<ViewerEntry, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir unavailable: {e}"))?
        .join("viewer");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create viewer dir failed: {e}"))?;
    let stem = thumb_stem(&channel_id, message_id)?;
    let ext: String = name
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let file = if ext.is_empty() { stem } else { format!("{stem}.{ext}") };
    let path = dir.join(&file);
    if path.is_file() {
        if let Ok(f) = std::fs::File::open(&path) {
            let _ = f.set_modified(SystemTime::now());
        }
    }
    Ok(ViewerEntry {
        ready: path.is_file(),
        part: dir.join(format!("{file}.part")).to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
    })
}

/// Turns a finished `.part` file into the cached copy and trims the cache to its size limit.
#[tauri::command]
fn viewer_cache_commit(app: AppHandle, part: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir unavailable: {e}"))?
        .join("viewer");
    let part = PathBuf::from(part);
    if part.parent() != Some(dir.as_path()) || part.extension().and_then(|e| e.to_str()) != Some("part") {
        return Err("invalid viewer path".into());
    }
    std::fs::rename(&part, part.with_extension("")).map_err(|e| format!("commit failed: {e}"))?;
    let mut entries: Vec<(SystemTime, u64, PathBuf)> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let md = e.metadata().ok()?;
            md.is_file().then(|| (md.modified().unwrap_or(SystemTime::UNIX_EPOCH), md.len(), e.path()))
        })
        .collect();
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    entries.sort_by_key(|e| e.0);
    for (_, len, path) in entries {
        if total <= VIEWER_CACHE_LIMIT {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
    Ok(())
}

/// Opens a staged file with the default app for its type.
#[tauri::command]
async fn file_open(app: AppHandle, path: String, mime: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.fileshare().open(&path, &mime).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("open join failed: {e}"))?
}

/// Sends a staged file to other apps through the Android share sheet.
#[tauri::command]
async fn file_share(app: AppHandle, path: String, mime: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.fileshare().share(&path, &mime).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("share join failed: {e}"))?
}

/// The phone's name, shown as the top backup folder.
#[tauri::command]
async fn device_name(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app.storage().device_name().map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("device name join failed: {e}"))?
}

/// Largest the on-disk thumbnail cache may grow before the least recently shown are removed.
const THUMB_CACHE_MAX_BYTES: u64 = 200 * 1024 * 1024;
/// Largest single thumbnail accepted from the webview or the phone.
const THUMB_MAX_BYTES: usize = 2 * 1024 * 1024;

fn thumb_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("cache dir unavailable: {e}"))?
        .join("thumbs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create thumbs dir failed: {e}"))?;
    Ok(dir)
}

/// "<channel>_<message>": channel ids are numeric (optionally negative).
fn thumb_stem(channel_id: &str, message_id: i64) -> Result<String, String> {
    if channel_id.is_empty() || !channel_id.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("invalid channel id".into());
    }
    Ok(format!("{channel_id}_{message_id}"))
}

/// Tiers: "s" is Telegram's small thumbnail, "l" is a sharper 512 px one.
fn thumb_tier(tier: &str) -> Result<&'static str, String> {
    match tier {
        "s" => Ok("s"),
        "l" => Ok("l"),
        _ => Err("invalid thumbnail tier".into()),
    }
}

/// Removes the least recently used thumbnails until the cache is under the cap.
fn prune_thumbs(dir: &Path) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<(PathBuf, u64, SystemTime)> = read
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some((entry.path(), meta.len(), meta.modified().ok()?))
        })
        .collect();
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    if total <= THUMB_CACHE_MAX_BYTES {
        return;
    }
    entries.sort_by_key(|e| e.2);
    for (path, size, _) in entries {
        if total <= THUMB_CACHE_MAX_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= size;
        }
    }
}

/// Writes a thumbnail atomically and prunes the cache. Returns the file path.
fn write_thumb(dir: &Path, stem: &str, tier: &str, data: &[u8]) -> Result<String, String> {
    if data.is_empty() || data.len() > THUMB_MAX_BYTES {
        return Err("thumbnail size out of range".into());
    }
    let path = dir.join(format!("{stem}_{tier}.jpg"));
    let tmp = dir.join(format!("{stem}_{tier}.part"));
    std::fs::write(&tmp, data).map_err(|e| format!("write thumbnail failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("save thumbnail failed: {e}"))?;
    prune_thumbs(dir);
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
struct ThumbLookup {
    small: Option<String>,
    large: Option<String>,
    /// True when an earlier attempt found this file has no thumbnail, so it is not retried.
    none: bool,
}

/// What the cache holds for one file. Marks any hit as recently used.
#[tauri::command]
fn thumb_lookup(app: AppHandle, channel_id: String, message_id: i64) -> Result<ThumbLookup, String> {
    let dir = thumb_dir(&app)?;
    let stem = thumb_stem(&channel_id, message_id)?;
    let find = |tier: &str| -> Option<String> {
        let path = dir.join(format!("{stem}_{tier}.jpg"));
        if !path.is_file() {
            return None;
        }
        if let Ok(file) = std::fs::File::open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }
        Some(path.to_string_lossy().into_owned())
    };
    Ok(ThumbLookup {
        small: find("s"),
        large: find("l"),
        none: dir.join(format!("{stem}.none")).is_file(),
    })
}

/// Stores a thumbnail made in the webview.
#[tauri::command]
fn thumb_save(
    app: AppHandle,
    channel_id: String,
    message_id: i64,
    tier: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let dir = thumb_dir(&app)?;
    write_thumb(&dir, &thumb_stem(&channel_id, message_id)?, thumb_tier(&tier)?, &data)
}

/// Records that this file has no usable thumbnail.
#[tauri::command]
fn thumb_mark_none(app: AppHandle, channel_id: String, message_id: i64) -> Result<(), String> {
    let dir = thumb_dir(&app)?;
    let stem = thumb_stem(&channel_id, message_id)?;
    std::fs::write(dir.join(format!("{stem}.none")), b"").map_err(|e| format!("mark failed: {e}"))
}

/// Builds a 512 px thumbnail from the phone's own copy of a file (a content:// URI) and caches
/// it, so this device never has to download the file back just to show it.
#[tauri::command]
async fn thumb_from_source(
    app: AppHandle,
    channel_id: String,
    message_id: i64,
    uri: String,
    mime: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stem = thumb_stem(&channel_id, message_id)?;
        let bytes = app.storage().thumbnail(&uri, &mime).map_err(|e| e.to_string())?;
        let dir = thumb_dir(&app)?;
        write_thumb(&dir, &stem, "l", &bytes)
    })
    .await
    .map_err(|e| format!("thumbnail join failed: {e}"))?
}

/// A newer published release than the installed app.
#[derive(serde::Serialize)]
struct UpdateInfo {
    tag: String,
    version: String,
    notes: String,
    url: String,
    sha256: String,
    size: u64,
    current: String,
}

/// Parses "major.minor.patch". Returns None for anything else.
fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// Asks GitHub for the latest release. Returns it only if its version is newer than the installed app.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let value = tauri::async_runtime::spawn_blocking(move || {
        app.apkupdate().fetch_latest().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("update check join failed: {e}"))??;

    // Tags look like "v0.1.4-android.12": the version is the part before the first "-".
    let tag = value["tag"].as_str().unwrap_or_default().to_string();
    let version = tag.trim_start_matches('v').split('-').next().unwrap_or_default().to_string();
    let latest = parse_version(&version).ok_or_else(|| format!("unrecognised release tag {tag}"))?;
    let installed = parse_version(&current).ok_or_else(|| format!("unrecognised app version {current}"))?;
    if latest <= installed {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        tag,
        version,
        notes: value["notes"].as_str().unwrap_or_default().to_string(),
        url: value["url"].as_str().unwrap_or_default().to_string(),
        sha256: value["sha256"].as_str().unwrap_or_default().to_string(),
        size: value["size"].as_u64().unwrap_or(0),
        current,
    }))
}

/// Downloads the verified APK into app cache. Returns its local path.
#[tauri::command]
async fn update_download(app: AppHandle, url: String, sha256: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.apkupdate().download(&url, &sha256).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("download join failed: {e}"))?
}

/// Bytes downloaded so far for the update in progress.
#[tauri::command]
async fn update_progress(app: AppHandle) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.apkupdate().status().map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("progress join failed: {e}"))?
}

/// Opens the system installer. Returns true when the user must first allow installs from TeleDrive.
#[tauri::command]
async fn update_install(app: AppHandle, path: String) -> Result<bool, String> {
    let value = tauri::async_runtime::spawn_blocking(move || {
        app.apkupdate().install(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("install join failed: {e}"))??;
    Ok(value["needsPermission"].as_bool().unwrap_or(false))
}

/// Converts the storage plugin's `{ entries: [{ uri, relPath, size, mtimeMs }] }` into walker entries.
fn storage_entries(value: serde_json::Value) -> Result<Vec<DirEntry>, String> {
    let items = value
        .get("entries")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "storage response missing entries".to_string())?;
    Ok(items
        .iter()
        .map(|item| DirEntry {
            abs_path: item["uri"].as_str().unwrap_or_default().to_string(),
            rel_path: item["relPath"].as_str().unwrap_or_default().to_string(),
            is_dir: false,
            size: item["size"].as_u64().unwrap_or(0),
            mtime_ms: item["mtimeMs"].as_u64().unwrap_or(0),
        })
        .collect())
}

/// Opens the Android folder picker. `initial` is "downloads", "documents", or null.
#[tauri::command]
async fn storage_pick_folder(app: AppHandle, initial: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.storage()
            .pick_folder(initial.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("folder picker join failed: {e}"))?
}

/// Asks Android for photo and video access.
#[tauri::command]
async fn storage_request_media(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.storage().request_media().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("permission request join failed: {e}"))?
}

/// Lists photos ("images") or videos ("videos") as backup source entries.
#[tauri::command]
async fn storage_list_media(app: AppHandle, kind: String) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = app.storage().list_media(&kind).map_err(|e| e.to_string())?;
        storage_entries(value)
    })
    .await
    .map_err(|e| format!("media listing join failed: {e}"))?
}

/// Lists every file under a folder picked with `storage_pick_folder`.
#[tauri::command]
async fn storage_list_tree(app: AppHandle, uri: String, skip_dirs: Vec<String>) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value = app.storage().list_tree(&uri, &skip_dirs).map_err(|e| e.to_string())?;
        storage_entries(value)
    })
    .await
    .map_err(|e| format!("folder listing join failed: {e}"))?
}

#[tauri::command]
async fn read_file_chunk(
    app: AppHandle,
    path: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    use std::io::{Read, Seek, SeekFrom};
    // Android content:// sources (photos, videos, SAF folders) are not filesystem paths.
    if path.starts_with("content://") {
        let bytes = tauri::async_runtime::spawn_blocking(move || {
            app.storage()
                .read_chunk(&path, offset, length)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| format!("read_file_chunk join failed: {e}"))??;
        return Ok(tauri::ipc::Response::new(bytes));
    }
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path_owned)
            .map_err(|e| format!("open({path_owned}) failed: {e}"))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("seek({offset}) failed: {e}"))?;
        let mut buf = vec![0u8; length as usize];
        file.read_exact(&mut buf)
            .map_err(|e| format!("read({length} bytes @{offset}) failed: {e}"))?;
        Ok::<tauri::ipc::Response, String>(tauri::ipc::Response::new(buf))
    })
    .await
    .map_err(|e| format!("read_file_chunk join failed: {e}"))?
}

/// Native binary file writer that bypasses tauri-plugin-fs IPC quirks,
/// capability scope limits, and Windows WebView2 payload drops.
/// Automatically creates parent directories if needed.
#[tauri::command]
async fn write_file_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path_owned);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = std::fs::File::create(p)
            .map_err(|e| format!("Failed to create file {path_owned}: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write data to {path_owned}: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("write_file_binary task join error: {e}"))?
}

/// Appends or writes a chunk of binary data to disk.
/// Useful for chunked streaming writes of large files without memory spikes.
#[tauri::command]
async fn write_file_chunk(path: String, data: Vec<u8>, append: bool) -> Result<(), String> {
    use std::io::Write;
    let path_owned = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path_owned);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(!append)
            .append(append)
            .open(p)
            .map_err(|e| format!("Failed to open file {path_owned}: {e}"))?;
        file.write_all(&data)
            .map_err(|e| format!("Failed to write chunk to {path_owned}: {e}"))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("write_file_chunk task join error: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // Fixed salt for local vault key derivation
                let salt = b"teledrive-vault-salt-value";
                let params = argon2::Params::new(1024, 2, 1, Some(32)).unwrap();
                let argon2 = argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
                let mut output_key = [0u8; 32];
                argon2.hash_password_into(password.as_bytes(), salt, &mut output_key)
                    .expect("stronghold password hashing failed");
                output_key.to_vec()
            })
            .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(tauri_plugin_keepalive::init())
        .plugin(tauri_plugin_storage::init())
        .plugin(tauri_plugin_apkupdate::init())
        .plugin(tauri_plugin_fileshare::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            log_vault_state,
            get_vault_state,
            save_session,
            load_session,
            clear_session,
            clear_session_only,
            save_vault_value,
            load_vault_value,
            delete_vault_value,
            quarantine_vault_value,
            start_backup_scheduler,
            stop_backup_scheduler,
            read_dir_recursive,
            read_file_chunk,
            write_file_binary,
            write_file_chunk,
            storage_pick_folder,
            storage_request_media,
            storage_list_media,
            storage_list_tree,
            update_check,
            update_download,
            update_progress,
            update_install,
            shared_file_path,
            viewer_cache_entry,
            viewer_cache_commit,
            file_open,
            file_share,
            thumb_lookup,
            thumb_save,
            thumb_mark_none,
            thumb_from_source,
            device_name,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
