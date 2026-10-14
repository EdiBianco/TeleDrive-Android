use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

// Initializes the Kotlin plugin class (android/src/main/java/com/teledrive/keepalive/KeepAlivePlugin.kt)
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<KeepAlive<R>> {
  let handle = api.register_android_plugin("com.teledrive.keepalive", "KeepAlivePlugin")?;
  Ok(KeepAlive(handle))
}

/// Starts or stops the foreground service that keeps scheduled backups running in the background.
pub struct KeepAlive<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> KeepAlive<R> {
  pub fn start(&self) -> crate::Result<()> {
    self.0.run_mobile_plugin::<serde_json::Value>("start", serde_json::json!({}))?;
    Ok(())
  }

  pub fn stop(&self) -> crate::Result<()> {
    self.0.run_mobile_plugin::<serde_json::Value>("stop", serde_json::json!({}))?;
    Ok(())
  }
}
