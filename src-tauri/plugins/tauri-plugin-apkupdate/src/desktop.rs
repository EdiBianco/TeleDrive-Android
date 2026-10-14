use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, Result};

/// In-app APK updates are Android-only; desktop installs come from the release page.
pub struct ApkUpdate<R: Runtime>(AppHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> Result<ApkUpdate<R>> {
  Ok(ApkUpdate(app.clone()))
}

fn unsupported<T>() -> Result<T> {
  Err(Error::Message("In-app updates are only available on Android".into()))
}

impl<R: Runtime> ApkUpdate<R> {
  pub fn fetch_latest(&self) -> Result<serde_json::Value> {
    unsupported()
  }

  pub fn download(&self, _url: &str, _sha256: &str) -> Result<String> {
    unsupported()
  }

  pub fn status(&self) -> Result<serde_json::Value> {
    unsupported()
  }

  pub fn install(&self, _path: &str) -> Result<serde_json::Value> {
    unsupported()
  }
}
