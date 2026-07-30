// Deedwell desktop shell. The webview is a thin, secure client: no model
// provider credentials live here, and the CSP in tauri.conf.json restricts
// network access to the Deedwell API origins.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Deedwell");
}
