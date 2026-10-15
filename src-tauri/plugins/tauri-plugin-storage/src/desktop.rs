use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, Result};

/// Storage sources are Android-only; desktop uses the normal folder picker and filesystem walker.
pub struct Storage<R: Runtime>(AppHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> Result<Storage<R>> {
  Ok(Storage(app.clone()))
}

impl<R: Runtime> Storage<R> {
  pub fn pick_folder(&self, _initial: Option<&str>) -> Result<String> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }

  pub fn device_name(&self) -> Result<String> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }

  pub fn request_media(&self) -> Result<()> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }

  pub fn list_media(&self, _kind: &str) -> Result<serde_json::Value> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }

  pub fn list_tree(&self, _uri: &str) -> Result<serde_json::Value> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }

  pub fn read_chunk(&self, _uri: &str, _offset: u64, _length: u64) -> Result<Vec<u8>> {
    Err(Error::Message("Android storage sources are not available on this platform".into()))
  }
}
