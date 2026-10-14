use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{Error, Result};

/// Desktop has no Android Keystore; sealing is refused rather than silently storing plaintext.
pub struct Keystore<R: Runtime>(AppHandle<R>);

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
  app: &AppHandle<R>,
  _api: PluginApi<R, C>,
) -> Result<Keystore<R>> {
  Ok(Keystore(app.clone()))
}

impl<R: Runtime> Keystore<R> {
  pub fn seal(&self, _plain: &str) -> Result<String> {
    Err(Error::Unsupported)
  }

  pub fn unseal(&self, _blob: &str) -> Result<String> {
    Err(Error::Unsupported)
  }
}
