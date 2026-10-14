use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::Result;

// Initializes the Kotlin plugin class (android/src/main/java/com/teledrive/apkupdate/ApkUpdatePlugin.kt)
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> Result<ApkUpdate<R>> {
  let handle = api.register_android_plugin("com.teledrive.apkupdate", "ApkUpdatePlugin")?;
  Ok(ApkUpdate(handle))
}

/// Checks GitHub for the latest release, downloads its APK, and opens the system installer.
pub struct ApkUpdate<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ApkUpdate<R> {
  /// Returns `{ tag, notes, url, size, sha256 }` for the latest published release.
  pub fn fetch_latest(&self) -> Result<serde_json::Value> {
    self
      .0
      .run_mobile_plugin("fetchLatest", serde_json::json!({}))
      .map_err(Into::into)
  }

  /// Downloads to app cache and verifies the SHA-256. Returns the local file path.
  pub fn download(&self, url: &str, sha256: &str) -> Result<String> {
    let res: serde_json::Value = self
      .0
      .run_mobile_plugin("download", serde_json::json!({ "url": url, "sha256": sha256 }))?;
    res
      .get("path")
      .and_then(|v| v.as_str())
      .map(str::to_string)
      .ok_or_else(|| crate::Error::Message("download response missing path".into()))
  }

  /// Returns `{ bytes, total, done }` for the download in progress.
  pub fn status(&self) -> Result<serde_json::Value> {
    self
      .0
      .run_mobile_plugin("status", serde_json::json!({}))
      .map_err(Into::into)
  }

  /// Opens the system installer for a downloaded APK. Returns `{ needsPermission }`; when true,
  /// the user must allow installs from TeleDrive first, then try again.
  pub fn install(&self, path: &str) -> Result<serde_json::Value> {
    self
      .0
      .run_mobile_plugin("install", serde_json::json!({ "path": path }))
      .map_err(Into::into)
  }
}
