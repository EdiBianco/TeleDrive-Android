use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::Result;

// Initializes the Kotlin plugin class (android/src/main/java/com/teledrive/fileshare/FileSharePlugin.kt)
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> Result<FileShare<R>> {
  let handle = api.register_android_plugin("com.teledrive.fileshare", "FileSharePlugin")?;
  Ok(FileShare(handle))
}

/// Opens or shares a file staged in the app cache.
pub struct FileShare<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> FileShare<R> {
  pub fn open(&self, path: &str, mime: &str) -> Result<()> {
    self
      .0
      .run_mobile_plugin::<serde_json::Value>("open", serde_json::json!({ "path": path, "mime": mime }))?;
    Ok(())
  }

  pub fn share(&self, path: &str, mime: &str) -> Result<()> {
    self
      .0
      .run_mobile_plugin::<serde_json::Value>("share", serde_json::json!({ "path": path, "mime": mime }))?;
    Ok(())
  }
}
