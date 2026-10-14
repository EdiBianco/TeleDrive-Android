use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::Result;

/// Desktop processes are not suspended, so there is nothing to keep alive.
pub struct KeepAlive<R: Runtime>(AppHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> Result<KeepAlive<R>> {
  Ok(KeepAlive(app.clone()))
}

impl<R: Runtime> KeepAlive<R> {
  pub fn start(&self) -> Result<()> {
    Ok(())
  }

  pub fn stop(&self) -> Result<()> {
    Ok(())
  }
}
