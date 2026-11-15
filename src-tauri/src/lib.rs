mod dpapi;
mod files;
mod sync;

use tauri::Manager;

/// Run the desktop shell. The context (and therefore the embedded frontend) is
/// built by the binary so unit tests can link the command modules without an
/// already-built web payload.
pub fn run(context: tauri::Context) {
    tauri::Builder::default()
        // Persists window size/position without exposing a window-state command
        // to the webview; restoration happens in Rust.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(sync::SyncState::default())
        .setup(|app| {
            let identifier = app.config().identifier.as_str();
            let title = if identifier == "com.fge.app" {
                "法语语法练习·内部版"
            } else {
                "法语语法练习"
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(title);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync::sync_get_config,
            sync::sync_set_config,
            sync::sync_disconnect,
            sync::sync_request,
            files::save_export_file,
        ])
        .run(context)
        .expect("error while running the Windows application");
}
