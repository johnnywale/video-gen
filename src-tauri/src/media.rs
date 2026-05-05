use ffmpeg_next as ffmpeg;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub has_audio: bool,
    pub has_video: bool,
}

/// Probe a media file using ffmpeg-next (libav*).
pub fn probe_media_file(path: &str) -> Result<MediaInfo, String> {
    ffmpeg::init().map_err(|e| format!("FFmpeg init error: {e}"))?;

    let context = ffmpeg::format::input(&path)
        .map_err(|e| format!("Failed to open media file: {e}"))?;

    // Container-level duration (microseconds)
    let mut duration = context.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE);

    let mut has_video = false;
    let mut has_audio = false;
    let mut width: Option<u32> = None;
    let mut height: Option<u32> = None;

    for stream in context.streams() {
        // If container duration is missing/invalid, try stream duration
        if duration <= 0.0 {
            let stream_dur = stream.duration();
            let time_base = stream.time_base();
            if stream_dur > 0 && time_base.1 > 0 {
                let stream_secs = stream_dur as f64 * time_base.0 as f64 / time_base.1 as f64;
                if stream_secs > duration {
                    duration = stream_secs;
                }
            }
        }

        match stream.parameters().medium() {
            ffmpeg::media::Type::Video => {
                has_video = true;
                let decoder = ffmpeg::codec::context::Context::from_parameters(stream.parameters())
                    .map_err(|e| format!("Codec context error: {e}"))?;
                let video = decoder
                    .decoder()
                    .video()
                    .map_err(|e| format!("Video decoder error: {e}"))?;
                width = Some(video.width());
                height = Some(video.height());
            }
            ffmpeg::media::Type::Audio => {
                has_audio = true;
            }
            _ => {}
        }
    }

    // Final fallback: if still no duration, estimate from file size + bitrate
    if duration <= 0.0 {
        // Try metadata
        for (key, value) in context.metadata().iter() {
            if key == "DURATION" || key == "duration" {
                if let Some(d) = parse_duration_str(&value) {
                    duration = d;
                    break;
                }
            }
        }
    }

    Ok(MediaInfo {
        duration: if duration > 0.0 { duration } else { 0.0 },
        width,
        height,
        has_audio,
        has_video,
    })
}

fn parse_duration_str(s: &str) -> Option<f64> {
    // Parse "HH:MM:SS.xxx" or just seconds
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let sec: f64 = parts[2].parse().ok()?;
            Some(h * 3600.0 + m * 60.0 + sec)
        }
        1 => parts[0].parse().ok(),
        _ => None,
    }
}
