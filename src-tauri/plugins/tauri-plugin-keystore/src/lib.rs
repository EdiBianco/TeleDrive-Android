use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Keystore;
#[cfg(mobile)]
use mobile::Keystore;

/// Access to the keystore from Rust (`app.keystore().seal(..)`). Not exposed to the webview.
pub trait KeystoreExt<R: Runtime> {
  fn keystore(&self) -> &Keystore<R>;
}

impl<R: Runtime, T: Manager<R>> crate::KeystoreExt<R> for T {
  fn keystore(&self) -> &Keystore<R> {
    self.state::<Keystore<R>>().inner()
  }
}

/// Initializes the plugin. No invoke handler is registered, so JavaScript cannot call it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("keystore")
    .setup(|app, api| {
      #[cfg(mobile)]
      let keystore = mobile::init(app, api)?;
      #[cfg(desktop)]
      let keystore = desktop::init(app, api)?;
      app.manage(keystore);
      Ok(())
    })
    .build()
}
