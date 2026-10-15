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
use desktop::FileShare;
#[cfg(mobile)]
use mobile::FileShare;

/// Access to file sharing from Rust (`app.fileshare()`). Not exposed to the webview.
pub trait FileShareExt<R: Runtime> {
  fn fileshare(&self) -> &FileShare<R>;
}

impl<R: Runtime, T: Manager<R>> crate::FileShareExt<R> for T {
  fn fileshare(&self) -> &FileShare<R> {
    self.state::<FileShare<R>>().inner()
  }
}

/// Initializes the plugin. No invoke handler is registered, so JavaScript cannot call it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("fileshare")
    .setup(|app, api| {
      #[cfg(mobile)]
      let updater = mobile::init(app, api)?;
      #[cfg(desktop)]
      let updater = desktop::init(app, api)?;
      app.manage(updater);
      Ok(())
    })
    .build()
}
