// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use video_editor::{commands, media_server, MediaServerPort};

fn main() {
    // Start the local media HTTP server before Tauri so the port is available
    // to commands. The accept loop continues running on tauri's async runtime.
    let port = tauri::async_runtime::block_on(async {
        media_server::start()
            .await
            .expect("failed to start media server")
    });
    eprintln!("[media_server] listening on http://127.0.0.1:{port}");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(MediaServerPort(port))
        .invoke_handler(tauri::generate_handler![
            commands::render_video,
            commands::open_file_picker,
            commands::save_file_picker,
            commands::get_default_output_path,
            commands::probe_media,
            commands::extract_thumbnails,
            commands::extract_frames_at_times,
            commands::extract_waveform,
            commands::save_temp_media,
            commands::get_media_url,
            commands::ai_generate_captions,
            commands::ai_generate_music,
            commands::ai_generate_speech,
            commands::ai_diagnose_minimax,
            commands::default_speech_cache_dir,
            commands::list_system_fonts,
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
