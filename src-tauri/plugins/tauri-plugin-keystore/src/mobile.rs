use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;

// Initializes the Kotlin plugin class (android/src/main/java/com/teledrive/keystore/KeystorePlugin.kt)
pub fn init<R: Runtime, C: DeserializeOwned>(
  _app: &AppHandle<R>,
  api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
  let handle = api.register_android_plugin("com.teledrive.keystore", "KeystorePlugin")?;
  Ok(Keystore(handle))
}

/// Access to the Android Keystore key that protects vault values.
pub struct Keystore<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Keystore<R> {
  /// Encrypts UTF-8 text. Returns base64(iv || ciphertext).
  pub fn seal(&self, plain: &str) -> crate::Result<String> {
    let res: TextResponse = self
      .0
      .run_mobile_plugin("seal", TextRequest { data: plain.to_string() })?;
    Ok(res.data)
  }

  /// Decrypts a blob produced by `seal`.
  pub fn unseal(&self, blob: &str) -> crate::Result<String> {
    let res: TextResponse = self
      .0
      .run_mobile_plugin("unseal", TextRequest { data: blob.to_string() })?;
    Ok(res.data)
  }
}
