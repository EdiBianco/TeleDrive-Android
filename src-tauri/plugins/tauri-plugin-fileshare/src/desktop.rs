use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, Result};

/// Android intents only; desktop uses the regular save dialog.
pub struct FileShare<R: Runtime>(AppHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> Result<FileShare<R>> {
  Ok(FileShare(app.clone()))
}

fn unsupported() -> Result<()> {
  Err(Error::Message("Open and share are only available on Android".into()))
}

impl<R: Runtime> FileShare<R> {
  pub fn open(&self, _path: &str, _mime: &str) -> Result<()> {
    unsupported()
  }

  pub fn share(&self, _path: &str, _mime: &str) -> Result<()> {
    unsupported()
  }
}
