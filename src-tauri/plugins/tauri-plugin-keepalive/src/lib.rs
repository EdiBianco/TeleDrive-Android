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
use desktop::KeepAlive;
#[cfg(mobile)]
use mobile::KeepAlive;

/// Access to the keep-alive service from Rust (`app.keepalive().start()`). Not exposed to the webview.
pub trait KeepAliveExt<R: Runtime> {
  fn keepalive(&self) -> &KeepAlive<R>;
}

impl<R: Runtime, T: Manager<R>> crate::KeepAliveExt<R> for T {
  fn keepalive(&self) -> &KeepAlive<R> {
    self.state::<KeepAlive<R>>().inner()
  }
}

/// Initializes the plugin. No invoke handler is registered, so JavaScript cannot call it.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("keepalive")
    .setup(|app, api| {
      #[cfg(mobile)]
      let keepalive = mobile::init(app, api)?;
      #[cfg(desktop)]
      let keepalive = desktop::init(app, api)?;
      app.manage(keepalive);
      Ok(())
    })
    .build()
}
