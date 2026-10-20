use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::{Error, Result};

// Initializes the Kotlin plugin class (android/src/main/java/com/teledrive/storage/StoragePlugin.kt)
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> Result<Storage<R>> {
  let handle = api.register_android_plugin("com.teledrive.storage", "StoragePlugin")?;
  Ok(Storage(handle))
}

/// Reads photo, video, and folder sources on Android.
pub struct Storage<R: Runtime>(PluginHandle<R>);

fn field_str(value: &serde_json::Value, key: &str) -> Result<String> {
  value
    .get(key)
    .and_then(|v| v.as_str())
    .map(str::to_string)
    .ok_or_else(|| Error::Message(format!("storage plugin response missing {key}")))
}

impl<R: Runtime> Storage<R> {
  /// Opens the system folder picker. `initial` may be "downloads" or "documents" to open there.
  /// Returns the persistent `content://` tree URI of the chosen folder.
  pub fn pick_folder(&self, initial: Option<&str>) -> Result<String> {
    let res: serde_json::Value = self
      .0
      .run_mobile_plugin("pickFolder", serde_json::json!({ "initial": initial }))?;
    field_str(&res, "uri")
  }

  /// Asks Android for photo and video access (runtime permission prompt).
  pub fn request_media(&self) -> Result<()> {
    self
      .0
      .run_mobile_plugin::<serde_json::Value>("requestPermissions", serde_json::json!({}))?;
    Ok(())
  }

  /// The phone's name as set in Android, or manufacturer and model.
  pub fn device_name(&self) -> Result<String> {
    let res: serde_json::Value = self.0.run_mobile_plugin("deviceName", serde_json::json!({}))?;
    Ok(res.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string())
  }

  /// Lists photos (`kind = "images"`) or videos (`kind = "videos"`) from MediaStore.
  pub fn list_media(&self, kind: &str) -> Result<serde_json::Value> {
    self
      .0
      .run_mobile_plugin("listMedia", serde_json::json!({ "kind": kind }))
      .map_err(Into::into)
  }

  /// Recursively lists files under a folder picked with `pick_folder`.
  pub fn list_tree(&self, uri: &str, skip_dirs: &[String]) -> Result<serde_json::Value> {
    self
      .0
      .run_mobile_plugin("listTree", serde_json::json!({ "uri": uri, "skipDirs": skip_dirs }))
      .map_err(Into::into)
  }

  /// A JPEG thumbnail (long edge up to 512 px) of a local photo or video.
  pub fn thumbnail(&self, uri: &str, mime: &str) -> Result<Vec<u8>> {
    let res: serde_json::Value = self
      .0
      .run_mobile_plugin("thumbnail", serde_json::json!({ "uri": uri, "mime": mime }))?;
    let encoded = field_str(&res, "data")?;
    base64::decode(encoded).map_err(|e| Error::Message(format!("thumbnail decode failed: {e}")))
  }

  /// Reads exactly `length` bytes at `offset` from a `content://` URI.
  pub fn read_chunk(&self, uri: &str, offset: u64, length: u64) -> Result<Vec<u8>> {
    let res: serde_json::Value = self
      .0
      .run_mobile_plugin(
        "readChunk",
        serde_json::json!({ "uri": uri, "offset": offset, "length": length }),
      )?;
    let encoded = field_str(&res, "data")?;
    base64::decode(encoded).map_err(|e| Error::Message(format!("chunk decode failed: {e}")))
  }
}
