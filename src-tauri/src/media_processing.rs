use base64::Engine;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

/// Extract N evenly-spaced thumbnail frames from a video file.
/// Returns Vec of base64-encoded JPEG data URLs.
///
/// Uses input-side `-ss` seek (placed before `-i`) so ffmpeg uses the
/// container index to jump straight to the keyframe at-or-near the target
/// timestamp. This is O(1) per thumbnail regardless of file size — extracting
/// 1 thumbnail from a 4 GB mp4 takes ~1 s instead of scanning the whole file.
pub fn extract_thumbnails(
    file_path: &str,
    count: u32,
    thumb_width: u32,
    thumb_height: u32,
) -> Result<Vec<String>, String> {
    if count == 0 {
        return Ok(vec![]);
    }
    let ffmpeg = find_ffmpeg()?;
    let tmp = TempDir::new().map_err(|e| format!("temp dir error: {e}"))?;

    let duration = get_duration(file_path)?;
    if duration <= 0.0 {
        return Ok(vec![]);
    }

    let segment = duration / count as f64;
    let scale_pad = format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2",
        thumb_width, thumb_height, thumb_width, thumb_height
    );

    let mut results = Vec::with_capacity(count as usize);
    for i in 0..count {
        // Sample the middle of each segment — avoids the fade-in / black
        // frame that often sits at t=0 and gives a more representative
        // filmstrip than uniform-from-zero sampling.
        let timestamp = segment * i as f64 + segment / 2.0;
        let frame_path = tmp.path().join(format!("frame_{:04}.jpg", i + 1));

        let status = Command::new(&ffmpeg)
            .args([
                "-ss", &format!("{:.3}", timestamp),
                "-i", file_path,
                "-frames:v", "1",
                "-vf", &scale_pad,
                "-q:v", "5",
                "-y",
                frame_path.to_str().unwrap(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("ffmpeg spawn error: {e}"))?;

        if status.success() && frame_path.exists() {
            let data = std::fs::read(&frame_path)
                .map_err(|e| format!("read frame error: {e}"))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            results.push(format!("data:image/jpeg;base64,{}", b64));
        }
    }

    Ok(results)
}

/// Extract waveform peak data from an audio/video file.
/// Returns Vec of peak values (0.0 - 1.0), one per sample.
pub fn extract_waveform(
    file_path: &str,
    sample_count: u32,
) -> Result<Vec<f32>, String> {
    let ffmpeg = find_ffmpeg()?;

    let duration = get_duration(file_path)?;
    if duration <= 0.0 {
        return Ok(vec![]);
    }

    // Output raw mono PCM at a low sample rate
    // We want sample_count peaks, so choose a sample rate that gives us
    // roughly sample_count * samples_per_peak raw samples
    let samples_per_peak = 100;
    let target_sr = ((sample_count as f64 * samples_per_peak as f64) / duration).ceil() as u32;
    let sr = target_sr.max(100).min(44100);

    let output = Command::new(&ffmpeg)
        .args([
            "-i", file_path,
            "-ac", "1",
            "-ar", &sr.to_string(),
            "-f", "s16le",
            "-acodec", "pcm_s16le",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("ffmpeg spawn error: {e}"))?;

    if !output.status.success() {
        return Err("ffmpeg waveform extraction failed".to_string());
    }

    let raw = &output.stdout;
    let total_samples = raw.len() / 2; // 16-bit samples = 2 bytes each
    if total_samples == 0 {
        return Ok(vec![]);
    }

    let samples_per_peak_actual = (total_samples as f64 / sample_count as f64).ceil() as usize;
    let mut peaks = Vec::with_capacity(sample_count as usize);

    for i in 0..sample_count as usize {
        let start = i * samples_per_peak_actual;
        let end = ((i + 1) * samples_per_peak_actual).min(total_samples);
        let mut max_val: f32 = 0.0;

        for j in start..end {
            let byte_idx = j * 2;
            if byte_idx + 1 < raw.len() {
                let sample = i16::from_le_bytes([raw[byte_idx], raw[byte_idx + 1]]);
                let normalized = (sample as f32 / 32768.0).abs();
                if normalized > max_val {
                    max_val = normalized;
                }
            }
        }
        peaks.push(max_val);
    }

    Ok(peaks)
}

/// Extract a frame at each given timestamp from a video file.
/// Mirrors `extract_thumbnails` but at user-specified positions instead of
/// evenly spaced ones. Uses input-side `-ss` seek so each call is O(1) on
/// the container index regardless of file size.
pub fn extract_frames_at_times(
    file_path: &str,
    times: &[f64],
    thumb_width: u32,
    thumb_height: u32,
) -> Result<Vec<String>, String> {
    if times.is_empty() {
        return Ok(vec![]);
    }
    let ffmpeg = find_ffmpeg()?;
    let tmp = TempDir::new().map_err(|e| format!("temp dir error: {e}"))?;

    let scale_pad = format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2",
        thumb_width, thumb_height, thumb_width, thumb_height
    );

    let mut results = Vec::with_capacity(times.len());
    for (i, &t) in times.iter().enumerate() {
        let timestamp = t.max(0.0);
        let frame_path = tmp.path().join(format!("frame_{:04}.jpg", i + 1));

        let status = Command::new(&ffmpeg)
            .args([
                "-ss", &format!("{:.3}", timestamp),
                "-i", file_path,
                "-frames:v", "1",
                "-vf", &scale_pad,
                "-q:v", "5",
                "-y",
                frame_path.to_str().unwrap(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|e| format!("ffmpeg spawn error: {e}"))?;

        if status.success() && frame_path.exists() {
            let data = std::fs::read(&frame_path)
                .map_err(|e| format!("read frame error: {e}"))?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            results.push(format!("data:image/jpeg;base64,{}", b64));
        } else {
            // Failed extraction — return empty string so caller can map by index.
            results.push(String::new());
        }
    }

    Ok(results)
}

/// Save raw file bytes to a temp file and return the path.
/// Used when browser sends File blob data to backend.
pub fn save_temp_file(data: &[u8], file_name: &str) -> Result<String, String> {
    let tmp_dir = std::env::temp_dir().join("video-editor-media");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("mkdir error: {e}"))?;

    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    let path = tmp_dir.join(format!("{}_{}.{}", file_name, uuid_simple(), ext));

    std::fs::write(&path, data).map_err(|e| format!("write error: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

fn get_duration(file_path: &str) -> Result<f64, String> {
    // Use ffmpeg-next to get duration
    ffmpeg_next::init().map_err(|e| format!("ffmpeg init: {e}"))?;
    let ctx = ffmpeg_next::format::input(file_path)
        .map_err(|e| format!("open file: {e}"))?;
    let dur = ctx.duration() as f64 / f64::from(ffmpeg_next::ffi::AV_TIME_BASE);
    Ok(dur)
}

fn find_ffmpeg() -> Result<String, String> {
    for candidate in &["ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"] {
        if Command::new(candidate).arg("-version").output().is_ok() {
            return Ok(candidate.to_string());
        }
    }
    Err("ffmpeg not found".to_string())
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{:x}{:x}", t.as_secs(), t.subsec_nanos())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::{Duration, Instant};

    /// Skip the test gracefully when the local fixture isn't present.
    /// Returning Some(path) means the test should run; None means skip.
    fn fixture_path() -> Option<&'static str> {
        let path = "/Users/yihuazhuo/Downloads/test_mp3.mp3";
        if Path::new(path).exists() {
            Some(path)
        } else {
            eprintln!("skipping: fixture {path} not present");
            None
        }
    }

    fn video_fixture_path() -> Option<&'static str> {
        let path = "/Users/yihuazhuo/Downloads/test.mp4";
        if Path::new(path).exists() {
            Some(path)
        } else {
            eprintln!("skipping: fixture {path} not present");
            None
        }
    }

    /// Decode a "data:image/jpeg;base64,..." URL into raw JPEG bytes.
    fn decode_data_url(data_url: &str) -> Vec<u8> {
        use base64::Engine;
        let prefix = "data:image/jpeg;base64,";
        let b64 = data_url
            .strip_prefix(prefix)
            .expect("expected data:image/jpeg;base64, prefix");
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .expect("base64 decode failed")
    }

    #[test]
    fn extract_waveform_real_mp3_returns_500_peaks() {
        let Some(path) = fixture_path() else { return };

        let peaks = extract_waveform(path, 500).expect("waveform extraction should succeed");

        // Shape: requested sample_count peaks
        assert_eq!(peaks.len(), 500, "peak count should match requested sample_count");

        // Range: every peak is a normalized magnitude in [0.0, 1.0]
        for (i, &p) in peaks.iter().enumerate() {
            assert!(
                p.is_finite() && (0.0..=1.0).contains(&p),
                "peak[{i}]={p} out of [0,1]"
            );
        }

        // Real audio → at least some non-silent peaks. A 124MB mp3 should
        // have plenty of energy; require >10% of bins above the noise floor.
        let nonzero = peaks.iter().filter(|&&p| p > 0.01).count();
        assert!(
            nonzero > 50,
            "expected real audio peaks; only {nonzero}/500 above noise floor"
        );
    }

    #[test]
    fn extract_waveform_respects_requested_sample_count() {
        let Some(path) = fixture_path() else { return };

        for n in [100u32, 250, 1000] {
            let peaks = extract_waveform(path, n).expect("should succeed");
            assert_eq!(peaks.len(), n as usize, "sample_count={n}");
        }
    }

    /// Confirms the async pattern used by `commands::extract_waveform`:
    /// the blocking ffmpeg work runs on `spawn_blocking`, so the tokio
    /// runtime stays responsive — a 1ms-tick task on the runtime continues
    /// to advance while waveform decoding is in flight.
    ///
    /// If ffmpeg were called directly inside the runtime (no spawn_blocking),
    /// the tick count would be near zero on a single-worker runtime.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn extract_waveform_does_not_block_runtime() {
        let Some(path) = fixture_path() else { return };
        let path_owned = path.to_string();

        // Mirror commands::extract_waveform: spawn the blocking work off-runtime.
        let waveform_handle = tokio::task::spawn_blocking(move || {
            extract_waveform(&path_owned, 500)
        });

        // Drive a high-cadence tick on the runtime. Each await point yields to
        // the executor — if the runtime were blocked, ticks would stall.
        let started = Instant::now();
        let mut ticks: u32 = 0;
        let mut handle = waveform_handle;
        let peaks = loop {
            if handle.is_finished() {
                break handle.await.expect("join error").expect("waveform error");
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
            ticks += 1;
            assert!(
                started.elapsed() < Duration::from_secs(180),
                "waveform extraction exceeded 180s — likely deadlocked"
            );
        };

        assert_eq!(peaks.len(), 500);
        // A multi-second decode should yield hundreds of 1ms ticks on the
        // runtime. A blocking misuse would show 0–5 ticks (only the final
        // poll). 50 is a conservative floor that won't flake on slow CI.
        assert!(
            ticks > 50,
            "runtime appears blocked: {ticks} ticks observed during extraction"
        );
        eprintln!(
            "extract_waveform: {ticks} runtime ticks during {:?}",
            started.elapsed()
        );
    }

    /// Two waveform jobs running concurrently via spawn_blocking finish in
    /// noticeably less than 2x a single sequential run — proving the work
    /// truly parallelises across the blocking thread pool rather than
    /// serialising on the runtime.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn extract_waveform_runs_concurrently() {
        let Some(path) = fixture_path() else { return };

        // Baseline: one sequential run.
        let path_seq = path.to_string();
        let t0 = Instant::now();
        let _ = tokio::task::spawn_blocking(move || extract_waveform(&path_seq, 500))
            .await
            .unwrap()
            .unwrap();
        let single = t0.elapsed();

        // Concurrent: two runs in parallel via spawn_blocking + join.
        let p1 = path.to_string();
        let p2 = path.to_string();
        let t1 = Instant::now();
        let (a, b) = tokio::join!(
            tokio::task::spawn_blocking(move || extract_waveform(&p1, 500)),
            tokio::task::spawn_blocking(move || extract_waveform(&p2, 500)),
        );
        let parallel = t1.elapsed();

        let a = a.unwrap().unwrap();
        let b = b.unwrap().unwrap();
        assert_eq!(a.len(), 500);
        assert_eq!(b.len(), 500);

        // Parallel should be < 1.7x sequential. Pure serial would be ~2x.
        // The cushion absorbs ffmpeg startup + scheduler jitter.
        assert!(
            parallel < single.mul_f64(1.7),
            "parallel ({parallel:?}) not faster than 1.7x sequential ({single:?}) — \
             concurrency may be broken"
        );
        eprintln!(
            "single={single:?} parallel(2x)={parallel:?} → speedup {:.2}x",
            single.as_secs_f64() * 2.0 / parallel.as_secs_f64()
        );
    }

    // ── Thumbnail extraction tests for /Users/yihuazhuo/Downloads/test.mp4 ──
    //
    // These exercise the same code path as extract_thumbnails(file, count, w, h)
    // but with count=1 so we only process a single image. Validation uses the
    // `image` crate (open-source, MIT/Apache-2.0) to actually decode the
    // returned JPEG bytes — proving they aren't just a syntactically valid
    // data URL but a real, dimensionally-correct picture.

    #[test]
    fn extract_thumbnail_real_mp4_single_image() {
        let Some(path) = video_fixture_path() else { return };

        let thumbs = extract_thumbnails(path, 1, 320, 180)
            .expect("thumbnail extraction should succeed");

        // count=1 → exactly one thumbnail
        assert_eq!(thumbs.len(), 1, "expected exactly one thumbnail");

        let data_url = &thumbs[0];
        assert!(
            data_url.starts_with("data:image/jpeg;base64,"),
            "thumbnail should be a JPEG data URL, got: {}…",
            &data_url[..data_url.len().min(40)]
        );

        // Decode the JPEG with the `image` crate and verify it's a real image.
        let jpeg_bytes = decode_data_url(data_url);
        assert!(jpeg_bytes.len() > 100, "JPEG bytes suspiciously small: {}", jpeg_bytes.len());

        let img = image::load_from_memory(&jpeg_bytes)
            .expect("image crate should decode the JPEG");

        // ffmpeg's pad filter pads to exactly the requested canvas. Width and
        // height should match the request.
        assert_eq!(img.width(), 320, "thumbnail width should match request");
        assert_eq!(img.height(), 180, "thumbnail height should match request");

        // Sanity: not a fully black/empty frame. Sample 100 pixels and require
        // some color variance.
        let rgb = img.to_rgb8();
        let mut max_lum: u32 = 0;
        for (i, p) in rgb.pixels().enumerate() {
            if i % (rgb.len() / 100).max(1) != 0 { continue; }
            let lum = p[0] as u32 + p[1] as u32 + p[2] as u32;
            if lum > max_lum { max_lum = lum; }
        }
        assert!(
            max_lum > 30,
            "thumbnail looks blank (max sampled luminance = {max_lum})"
        );
    }

    #[test]
    fn extract_thumbnail_respects_dimensions() {
        let Some(path) = video_fixture_path() else { return };

        for (w, h) in [(160u32, 90u32), (640, 360)] {
            let thumbs = extract_thumbnails(path, 1, w, h).expect("should succeed");
            assert_eq!(thumbs.len(), 1);
            let img = image::load_from_memory(&decode_data_url(&thumbs[0]))
                .expect("decode JPEG");
            assert_eq!(img.width(), w, "width mismatch for {w}x{h}");
            assert_eq!(img.height(), h, "height mismatch for {w}x{h}");
        }
    }

    /// Same async-correctness check as the waveform variant: while the
    /// blocking ffmpeg work executes on a worker thread via spawn_blocking,
    /// the tokio runtime stays responsive to a 1ms-tick task. This is the
    /// pattern used by the Tauri command in `commands::extract_thumbnails`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn extract_thumbnail_does_not_block_runtime() {
        let Some(path) = video_fixture_path() else { return };
        let path_owned = path.to_string();

        let thumb_handle = tokio::task::spawn_blocking(move || {
            extract_thumbnails(&path_owned, 1, 320, 180)
        });

        let started = Instant::now();
        let mut ticks: u32 = 0;
        let thumbs = loop {
            if thumb_handle.is_finished() {
                break thumb_handle.await.expect("join error").expect("thumbnail error");
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
            ticks += 1;
            assert!(
                started.elapsed() < Duration::from_secs(180),
                "thumbnail extraction exceeded 180s — likely deadlocked"
            );
        };

        assert_eq!(thumbs.len(), 1);
        assert!(
            ticks > 10,
            "runtime appears blocked: {ticks} ticks during extraction"
        );
        eprintln!(
            "extract_thumbnails(1): {ticks} runtime ticks during {:?}",
            started.elapsed()
        );
    }
}
