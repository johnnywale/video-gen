pub mod ai;
pub mod commands;
pub mod media;
pub mod media_processing;
pub mod media_server;

/// Port the local HTTP media server is bound to. Stored in tauri::State.
pub struct MediaServerPort(pub u16);
