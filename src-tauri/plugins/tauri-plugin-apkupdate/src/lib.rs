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
use desktop::ApkUpdate;
#[cfg(mobile)]
use mobile::ApkUpdate;

/// Access to the APK updater from Rust (`app.apkupdate()`). Not exposed to the webview.
pub trait ApkUpdateExt<R: Runtime> {
  fn apkupdate(&self) -> &ApkUpdate<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ApkUpdateExt<R> for T {
  fn apkupdate(&self) -> &ApkUpdate<R> {
    self.state::<ApkUpdate<R>>().inner()
  }
}

/// Initializes the plugin. No invoke handler is registered, so JavaScript cannot call it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("apkupdate")
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
