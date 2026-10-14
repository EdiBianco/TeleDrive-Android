use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::Storage;
#[cfg(mobile)]
use mobile::Storage;

/// Access to Android storage sources from Rust (`app.storage().list_media(..)`). Not exposed to the webview.
pub trait StorageExt<R: Runtime> {
  fn storage(&self) -> &Storage<R>;
}

impl<R: Runtime, T: Manager<R>> crate::StorageExt<R> for T {
  fn storage(&self) -> &Storage<R> {
    self.state::<Storage<R>>().inner()
  }
}

/// Initializes the plugin. No invoke handler is registered, so JavaScript cannot call it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("storage")
    .setup(|app, api| {
      #[cfg(mobile)]
      let storage = mobile::init(app, api)?;
      #[cfg(desktop)]
      let storage = desktop::init(app, api)?;
      app.manage(storage);
      Ok(())
    })
    .build()
}
