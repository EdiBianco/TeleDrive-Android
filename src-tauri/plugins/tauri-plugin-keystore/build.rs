const COMMANDS: &[&str] = &["seal", "unseal"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
