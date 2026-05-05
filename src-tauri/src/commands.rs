use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::media::{MediaInfo, probe_media_file};
use crate::media_processing;

/// Build a URL pointing at the local media HTTP server for an absolute file
/// path. The path is percent-encoded but path separators are preserved so
/// the server's routing receives the absolute path unmangled in the URL
/// path component.
#[tauri::command]
pub fn get_media_url(
    file_path: String,
    port: State<'_, crate::MediaServerPort>,
) -> String {
    let encoded: String = file_path
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' => c.to_string(),
            _ => {
                let mut buf = [0u8; 4];
                let s = c.encode_utf8(&mut buf);
                s.bytes()
                    .map(|b| format!("%{b:02X}"))
                    .collect::<String>()
            }
        })
        .collect();
    let path = if encoded.starts_with('/') { encoded } else { format!("/{encoded}") };
    format!("http://127.0.0.1:{}{}", port.inner().0, path)
}

/// Render a video by executing ffmpeg with the given args.
/// Emits `render_progress`, `render_complete`, and `render_error` events.
#[tauri::command]
pub async fn render_video(
    app: AppHandle,
    command: Vec<String>,
) -> Result<(), String> {
    // Find ffmpeg binary (expects it on PATH)
    let ffmpeg = which_ffmpeg()?;

    // Log the exact command for debugging — user can copy/paste to a
    // terminal to verify, and the filter_complex string makes any xfade /
    // drawtext / atempo logic visible.
    eprintln!("[render_video] {} {}", ffmpeg, command.iter()
        .map(|a| if a.contains(' ') || a.contains(';') { format!("'{}'", a.replace('\'', "\\'")) } else { a.clone() })
        .collect::<Vec<_>>()
        .join(" "));

    let mut child = Command::new(&ffmpeg)
        .args(&command)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    // ffmpeg writes progress + diagnostics to stderr
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        let app_clone = app.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                // Parse `time=HH:MM:SS.ms` for progress
                if let Some(pct) = parse_progress(&line) {
                    let _ = app_clone.emit("render_progress", pct);
                } else if line.contains("Error")
                    || line.contains("error")
                    || line.contains("Invalid")
                    || line.contains("No such filter")
                {
                    // Surface filter-graph errors (e.g. unknown xfade type)
                    // to the terminal so the user can see why a render failed.
                    eprintln!("[ffmpeg] {line}");
                }
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ffmpeg wait error: {e}"))?;

    if status.success() {
        let _ = app.emit("render_complete", ());
        Ok(())
    } else {
        let msg = format!("ffmpeg exited with status: {status}");
        let _ = app.emit("render_error", &msg);
        Err(msg)
    }
}

/// Open a native save-file dialog and return the chosen path (or None).
#[tauri::command]
pub async fn save_file_picker(default_path: Option<String>, default_name: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("选择导出位置")
        .add_filter("MP4", &["mp4"])
        .add_filter("MKV", &["mkv"])
        .add_filter("MOV", &["mov"]);
    if let Some(p) = default_path {
        dialog = dialog.set_directory(p);
    }
    if let Some(n) = default_name {
        dialog = dialog.set_file_name(n);
    }
    Ok(dialog.save_file().await.map(|f| f.path().to_string_lossy().to_string()))
}

/// Open a native file picker dialog and return selected file paths.
#[tauri::command]
pub async fn open_file_picker(multiple: bool) -> Result<Vec<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Import Media")
        .add_filter("Media Files", &["mp4", "mov", "mkv", "avi", "webm", "mp3", "wav", "aac", "flac", "m4a"]);

    if multiple {
        let files = dialog.pick_files().await.unwrap_or_default();
        Ok(files.iter().map(|f| f.path().to_string_lossy().to_string()).collect())
    } else {
        let file = dialog.pick_file().await;
        match file {
            Some(f) => Ok(vec![f.path().to_string_lossy().to_string()]),
            None => Ok(vec![]),
        }
    }
}

/// Return a sensible default output path in the user's home/Movies directory.
#[tauri::command]
pub fn get_default_output_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!("{}/Movies/output.mp4", home)
}

/// Open a path with the OS default handler. Used by the editor to launch
/// the just-exported mp4 in the user's video player.
#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("empty path".to_string());
    }
    if !std::path::Path::new(&path).exists() {
        return Err(format!("file not found: {path}"));
    }

    #[cfg(target_os = "macos")]
    let (cmd, args): (&str, Vec<&str>) = ("open", vec![&path]);
    #[cfg(target_os = "windows")]
    let (cmd, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", &path]);
    #[cfg(target_os = "linux")]
    let (cmd, args): (&str, Vec<&str>) = ("xdg-open", vec![&path]);

    std::process::Command::new(cmd)
        .args(args)
        .spawn()
        .map_err(|e| format!("failed to open {path}: {e}"))?;
    Ok(())
}

/// Probe a media file — runs on background thread.
#[tauri::command]
pub async fn probe_media(file_path: String) -> Result<MediaInfo, String> {
    tokio::task::spawn_blocking(move || probe_media_file(&file_path))
        .await
        .map_err(|e| format!("task error: {e}"))?
}

/// Extract thumbnails — runs on background thread, non-blocking.
#[tauri::command]
pub async fn extract_thumbnails(
    file_path: String,
    count: u32,
    width: u32,
    height: u32,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        media_processing::extract_thumbnails(&file_path, count, width, height)
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Extract one frame per given timestamp. Indexes correspond.
#[tauri::command]
pub async fn extract_frames_at_times(
    file_path: String,
    times: Vec<f64>,
    width: u32,
    height: u32,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        media_processing::extract_frames_at_times(&file_path, &times, width, height)
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Extract waveform peaks — runs on background thread, non-blocking.
#[tauri::command]
pub async fn extract_waveform(
    file_path: String,
    sample_count: u32,
) -> Result<Vec<f32>, String> {
    tokio::task::spawn_blocking(move || {
        media_processing::extract_waveform(&file_path, sample_count)
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Diagnostic — POST a tiny request to the music_generation endpoint and
/// return whatever MiniMax replies, status + raw body. Used by the
/// "Test connection" button in Settings.
#[tauri::command]
pub async fn ai_diagnose_minimax(
    api_key: String,
    base_url: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || crate::ai::diagnose_minimax(&api_key, &base_url))
        .await
        .map_err(|e| format!("task error: {e}"))?
}

/// Generate instrumental background music via MiniMax `music_generation`.
/// Always called with is_instrumental=true so the result is vocal-free.
/// `base_url` selects the region (api.minimax.io / api.minimaxi.com).
/// Returns the saved mp3 file path.
#[tauri::command]
pub async fn ai_generate_music(
    prompt: String,
    duration_seconds: Option<f32>,
    api_key: String,
    base_url: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        crate::ai::music_generate(&prompt, duration_seconds, &api_key, &base_url)
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Generate captions via an OpenAI-compat chat-completions endpoint.
/// Credentials come from the user's Settings panel. If `prompt_template`
/// is provided, it's used (with `{topic}` and `{count}` substituted)
/// instead of the built-in default.
#[tauri::command]
pub async fn ai_generate_captions(
    topic: String,
    count: u32,
    base_url: String,
    api_key: String,
    model: Option<String>,
    prompt_template: Option<String>,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        crate::ai::generate_captions(
            &topic,
            count as usize,
            &base_url,
            &api_key,
            model.as_deref(),
            prompt_template.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("task error: {e}"))?
}

/// Save file bytes to a temp location and return the file path.
#[tauri::command]
pub async fn save_temp_media(data: Vec<u8>, file_name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || media_processing::save_temp_file(&data, &file_name))
        .await
        .map_err(|e| format!("task error: {e}"))?
}

// ────────────────────────────────────────────────────────────────────────────

fn which_ffmpeg() -> Result<String, String> {
    // Try common locations
    for candidate in &["ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"] {
        if std::process::Command::new(candidate)
            .arg("-version")
            .output()
            .is_ok()
        {
            return Ok(candidate.to_string());
        }
    }
    Err("ffmpeg not found on PATH".to_string())
}

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    percent: f64,
    current_time: f64,
}

fn parse_progress(line: &str) -> Option<ProgressPayload> {
    // ffmpeg prints: "frame= ... time=00:00:05.12 ..."
    if let Some(pos) = line.find("time=") {
        let rest = &line[pos + 5..];
        let time_str: String = rest.chars().take(11).collect(); // HH:MM:SS.xx
        if let Ok(secs) = parse_time(&time_str) {
            return Some(ProgressPayload {
                percent: 0.0,        // caller can compute from total duration
                current_time: secs,
            });
        }
    }
    None
}

fn parse_time(s: &str) -> Result<f64, ()> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return Err(());
    }
    let h: f64 = parts[0].parse().map_err(|_| ())?;
    let m: f64 = parts[1].parse().map_err(|_| ())?;
    let sec: f64 = parts[2].parse().map_err(|_| ())?;
    Ok(h * 3600.0 + m * 60.0 + sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn parse_time_zero() {
        assert!(approx_eq(parse_time("00:00:00.00").unwrap(), 0.0));
    }

    #[test]
    fn parse_time_hms_with_fraction() {
        // 1h 2m 3.5s = 3723.5s
        assert!(approx_eq(parse_time("01:02:03.50").unwrap(), 3723.5));
    }

    #[test]
    fn parse_time_minutes_seconds() {
        // 5m 12.25s = 312.25s
        assert!(approx_eq(parse_time("00:05:12.25").unwrap(), 312.25));
    }

    #[test]
    fn parse_time_rejects_two_colon_parts() {
        assert!(parse_time("12:34").is_err());
    }

    #[test]
    fn parse_time_rejects_non_numeric() {
        assert!(parse_time("aa:bb:cc.dd").is_err());
    }

    #[test]
    fn parse_time_rejects_empty() {
        assert!(parse_time("").is_err());
    }

    #[test]
    fn parse_progress_extracts_time_from_typical_ffmpeg_line() {
        let line = "frame=  120 fps= 30 q=28.0 size=    256kB time=00:00:05.12 bitrate= 409.6kbits/s speed=1.02x";
        let p = parse_progress(line).expect("should parse");
        assert!(approx_eq(p.current_time, 5.12), "got {}", p.current_time);
        // percent is computed downstream, so it stays 0 here
        assert_eq!(p.percent, 0.0);
    }

    #[test]
    fn parse_progress_handles_long_duration() {
        let line = "size=1024kB time=02:30:45.00 bitrate=100.0kbits/s";
        let p = parse_progress(line).expect("should parse");
        // 2h 30m 45s = 9045s
        assert!(approx_eq(p.current_time, 9045.0), "got {}", p.current_time);
    }

    #[test]
    fn parse_progress_returns_none_when_no_time_field() {
        // Lines like ffmpeg's banner / config dump have no time= token
        assert!(parse_progress("ffmpeg version 6.0 Copyright (c) 2000-2023").is_none());
        assert!(parse_progress("").is_none());
    }

    #[test]
    fn parse_progress_returns_none_on_malformed_time() {
        // time= token is present but the value isn't HH:MM:SS.xx
        let line = "frame=10 time=not-a-time bitrate=0";
        assert!(parse_progress(line).is_none());
    }
}
