//! AI integrations — caption generation via an OpenAI-compatible chat
//! endpoint, and TTS via MiniMax `t2a_v2`. Keys/URLs are passed in from the
//! frontend (read from the user's Settings panel) so this module stays
//! stateless.

use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

/// Structured error for TTS calls so the frontend can render a debug
/// panel containing the exact request/response that failed. Used only
/// by `generate_speech` for now — other AI calls still return plain
/// `String` errors.
#[derive(Debug, Serialize, Clone)]
pub struct SpeechError {
    /// Human-readable summary (Chinese — surfaces as the toast/pill text).
    pub message: String,
    /// Endpoint that was hit (URL with query, no key).
    pub endpoint: String,
    /// Pretty-printed JSON request body, with `Authorization` redacted.
    pub request_body: String,
    /// HTTP status when we got that far; None for transport errors.
    pub status: Option<u16>,
    /// Raw response body (the API often puts the human error here).
    pub response_body: Option<String>,
}

impl SpeechError {
    fn pre_request(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            endpoint: String::new(),
            request_body: String::new(),
            status: None,
            response_body: None,
        }
    }
}

/// Default prompt template — used when the topic doesn't have a custom one.
/// Placeholders: `{topic}`, `{count}`.
const DEFAULT_PROMPT_TEMPLATE: &str = "请为一个「{topic}」主题短视频生成 {count} 句富有哲理的人生感悟。\n\
     要求：每句 8-15 个字，意境深远，发人深省，风格多样（励志/感悟/豁达/淡然/坚韧交替）。\n\
     示例风格：「山高路远，看世界也找自己」「人生如水，静而深流」";

/// Always appended to the prompt so the response is parseable JSON.
const JSON_OUTPUT_INSTRUCTION: &str =
    "只输出 JSON 数组，格式：[\"句子1\", \"句子2\", ...]，不要其他内容。";

/// Generate `count` short captions for the given topic. Mirrors the Python
/// `video_maker.ai_generate_titles` function: asks for a JSON array of
/// strings, falls back to defaults when the response is unusable.
///
/// `base_url` should be the OpenAI-compat root (e.g. `http://localhost:4001`).
/// The `/anthropic` suffix some proxies append is stripped automatically.
///
/// `prompt_template` is the user's custom template. `{topic}` and `{count}`
/// are substituted; the JSON-output instruction is always appended to the
/// final prompt to keep responses parseable.
pub fn generate_captions(
    topic: &str,
    count: usize,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
    prompt_template: Option<&str>,
) -> Result<Vec<String>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }

    let mut base = base_url.trim_end_matches('/').to_string();
    if base.ends_with("/anthropic") {
        base.truncate(base.len() - "/anthropic".len());
    }
    let url = format!("{base}/v1/chat/completions");

    let template = prompt_template
        .filter(|t| !t.trim().is_empty())
        .unwrap_or(DEFAULT_PROMPT_TEMPLATE);
    let body_text = template
        .replace("{topic}", topic)
        .replace("{count}", &count.to_string());
    let prompt = format!("{body_text}\n\n{JSON_OUTPUT_INSTRUCTION}");

    let body = json!({
        "model": model.unwrap_or("MiniMax-M2.7"),
        "max_tokens": 4096,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let mut req = ureq::post(&url).set("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {api_key}"));
    }

    let resp = req
        .send_json(body)
        .map_err(|e| format!("HTTP error contacting {url}: {e}"))?;

    let json_resp: Value = resp
        .into_json()
        .map_err(|e| format!("invalid JSON response: {e}"))?;

    let msg = json_resp
        .pointer("/choices/0/message")
        .ok_or_else(|| "response missing choices[0].message".to_string())?;

    // Some thinking-mode models return the answer in `reasoning_content`
    // rather than `content`. Try both.
    let raw = msg
        .get("content")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| msg.get("reasoning_content").and_then(|v| v.as_str()))
        .unwrap_or("")
        .trim()
        .to_string();

    parse_captions(&raw, count)
}

const MUSIC_MODEL: &str = "music-2.6";
const SPEECH_MODEL: &str = "speech-2.8-hd";

/// Generate TTS audio for a single line of text using MiniMax `t2a_v2`.
/// Returns the saved mp3 file path. The response body contains audio as
/// either a hex string or base64; we accept both (mirrors music_generate).
///
/// `dest_dir` is where the resulting mp3 lives. Callers should pass a
/// **persistent** directory (e.g. the app-local-data dir) — earlier
/// versions used `std::env::temp_dir()` and macOS reaped the files at
/// reboot, so the speech cache surfaced "已生成" on stages whose audio
/// no longer existed and 试听 silently failed.
///
/// The frontend caches results by (text, voice_id) and only calls this
/// when a cache miss happens — so the slow path runs once per unique
/// pair, not on every preview.
pub fn generate_speech(
    text: &str,
    voice_id: &str,
    api_key: &str,
    base_url: &str,
    dest_dir: &std::path::Path,
) -> Result<String, SpeechError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(SpeechError::pre_request("文字为空"));
    }
    let voice_id = voice_id.trim();
    if voice_id.is_empty() {
        return Err(SpeechError::pre_request("voice_id 为空"));
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(SpeechError::pre_request("MiniMax API 密钥未设置（请在设置中填写）"));
    }
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(SpeechError::pre_request("MiniMax 服务地址为空（请在设置中填写）"));
    }
    let endpoint = format!("{base}/v1/t2a_v2");
    let fingerprint = key_fingerprint(api_key);
    eprintln!(
        "[ai::generate_speech] POST {endpoint}  key_fp={fingerprint}  voice={voice_id}  chars={}",
        text.chars().count()
    );

    let body = json!({
        "model": SPEECH_MODEL,
        "text": text,
        "stream": false,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
        // The reference curl includes `language_boost: "Chinese"` to nudge
        // pronunciation for the curated Chinese voice IDs we ship. Keep it
        // even for English text — the parameter is a hint, not a filter.
        "language_boost": "Chinese",
        // Force hex output so we always hit the hex decode path; without
        // this MiniMax may return base64 (still handled by decode_audio_payload,
        // but explicit beats implicit).
        "output_format": "hex",
    });
    let request_body_pretty = serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string());

    let mk_err = |message: String, status: Option<u16>, response_body: Option<String>| SpeechError {
        message,
        endpoint: endpoint.clone(),
        request_body: request_body_pretty.clone(),
        status,
        response_body,
    };

    let send_result = ureq::post(&endpoint)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_secs(120))
        .send_json(body);

    let resp = match send_result {
        Ok(r) => r,
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_else(|e| format!("(read body err: {e})"));
            return Err(mk_err(
                format!("配音生成请求失败 (HTTP {code})"),
                Some(code),
                Some(body),
            ));
        }
        Err(other) => {
            return Err(mk_err(format!("配音生成请求失败: {other}"), None, None));
        }
    };

    let status_code = resp.status();
    let raw_body = resp
        .into_string()
        .unwrap_or_else(|e| format!("(read body err: {e})"));

    let json: Value = match serde_json::from_str(&raw_body) {
        Ok(v) => v,
        Err(e) => {
            return Err(mk_err(
                format!("响应不是 JSON: {e}"),
                Some(status_code),
                Some(raw_body),
            ));
        }
    };

    let mm_status = json
        .pointer("/base_resp/status_code")
        .and_then(|v| v.as_i64())
        .unwrap_or(-1);
    if mm_status != 0 {
        let msg = json
            .pointer("/base_resp/status_msg")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(mk_err(
            format!("配音生成失败: {msg}"),
            Some(status_code),
            Some(raw_body),
        ));
    }

    // Per MiniMax docs the audio bytes live at `data.audio`. Some proxies
    // surface it at the top level — try both.
    let audio_str = match json
        .pointer("/data/audio")
        .and_then(|v| v.as_str())
        .or_else(|| json.pointer("/audio").and_then(|v| v.as_str()))
    {
        Some(s) => s,
        None => {
            return Err(mk_err(
                "响应缺少 data.audio 字段".to_string(),
                Some(status_code),
                Some(raw_body),
            ));
        }
    };

    let bytes = match decode_audio_payload(audio_str) {
        Some(b) => b,
        None => {
            return Err(mk_err(
                "音频数据无法解码（hex 与 base64 均失败）".to_string(),
                Some(status_code),
                Some(raw_body),
            ));
        }
    };
    if bytes.is_empty() {
        return Err(mk_err(
            "解码到的音频为空".to_string(),
            Some(status_code),
            Some(raw_body),
        ));
    }

    std::fs::create_dir_all(dest_dir)
        .map_err(|e| mk_err(format!("创建配音目录失败: {e}"), Some(status_code), None))?;
    let safe_voice: String = voice_id
        .chars()
        .take(24)
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("speech_{safe_voice}_{stamp}.mp3");
    let path: PathBuf = dest_dir.join(filename);
    std::fs::write(&path, bytes)
        .map_err(|e| mk_err(format!("写入文件失败: {e}"), Some(status_code), None))?;
    Ok(path.to_string_lossy().to_string())
}

/// Generate instrumental background music from a free-form mood prompt.
/// Mirrors the `music_generation` provider in the user's reference Python
/// client: `output_format: "url"`, downloads the resulting mp3, returns
/// the saved file's local path.
///
/// `base_url` should be the MiniMax host root, no trailing slash, e.g.
/// `https://api.minimax.io` for international or `https://api.minimaxi.com`
/// for the China region. Keys are not interchangeable between regions.
pub fn music_generate(
    prompt: &str,
    duration_seconds: Option<f32>,
    api_key: &str,
    base_url: &str,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("音乐描述为空".to_string());
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("MiniMax API 密钥未设置（请在设置中填写）".to_string());
    }
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("MiniMax 服务地址为空（请在设置中填写）".to_string());
    }
    let endpoint = format!("{base}/v1/music_generation");
    let fingerprint = key_fingerprint(api_key);
    eprintln!(
        "[ai::music_generate] POST {endpoint}  key_len={}  key_fp={fingerprint}  prompt_chars={}",
        api_key.len(),
        prompt.len()
    );

    // Append a duration hint to the prompt — the API doesn't take a
    // duration field directly; the model honours natural-language hints.
    let prompt_with_dur = match duration_seconds {
        Some(d) if d > 0.0 => {
            format!("{}\n\nTarget duration: about {} seconds.", prompt.trim(), d.round() as u32)
        }
        _ => prompt.trim().to_string(),
    };

    let body = json!({
        "model": MUSIC_MODEL,
        "prompt": prompt_with_dur,
        "output_format": "url",
        "audio_setting": {
            "sample_rate": 44100,
            "bitrate": 256000,
            "format": "mp3",
        },
        "is_instrumental": true,
        "lyrics": "",
    });

    let resp = ureq::post(&endpoint)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_secs(300))
        .send_json(body)
        .map_err(|e| {
            // Surface the response body on HTTP errors — that's where MiniMax
            // puts the human-readable message (login fail / quota / etc.).
            match e {
                ureq::Error::Status(code, resp) => {
                    let body = resp.into_string().unwrap_or_default();
                    format!("音乐生成请求失败 (HTTP {code}): {body}")
                }
                other => format!("音乐生成请求失败: {other}"),
            }
        })?;

    let json: Value = resp.into_json().map_err(|e| format!("响应不是 JSON: {e}"))?;

    let status_code = json
        .pointer("/base_resp/status_code")
        .and_then(|v| v.as_i64())
        .unwrap_or(-1);
    if status_code != 0 {
        let msg = json
            .pointer("/base_resp/status_msg")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("音乐生成失败: {msg}"));
    }

    // Look for audio_url first (the documented happy path); fall back to
    // an inline `audio` field if the proxy returns one.
    let audio_url = json
        .pointer("/audio_url")
        .and_then(|v| v.as_str())
        .or_else(|| json.pointer("/data/audio_url").and_then(|v| v.as_str()))
        .or_else(|| {
            // Some responses put the URL inside the "audio" field directly.
            let candidate = json
                .pointer("/audio")
                .and_then(|v| v.as_str())
                .or_else(|| json.pointer("/data/audio").and_then(|v| v.as_str()))?;
            if candidate.starts_with("http://") || candidate.starts_with("https://") {
                Some(candidate)
            } else {
                None
            }
        });

    let audio_bytes = if let Some(url) = audio_url {
        let resp = ureq::get(url)
            .timeout(std::time::Duration::from_secs(180))
            .call()
            .map_err(|e| format!("下载音乐失败: {e}"))?;
        let mut buf: Vec<u8> = Vec::with_capacity(2 * 1024 * 1024);
        std::io::copy(&mut resp.into_reader(), &mut buf)
            .map_err(|e| format!("读取音乐字节失败: {e}"))?;
        if buf.is_empty() {
            return Err("下载到的音频为空".to_string());
        }
        buf
    } else {
        // Inline encoded fallback (rare for music_generation).
        let inline = json
            .pointer("/audio")
            .and_then(|v| v.as_str())
            .or_else(|| json.pointer("/data/audio").and_then(|v| v.as_str()))
            .ok_or_else(|| "响应缺少 audio_url / audio 字段".to_string())?;
        decode_audio_payload(inline)
            .ok_or_else(|| "音频数据无法解码（hex 与 base64 均失败）".to_string())?
    };

    let tmp_dir = std::env::temp_dir().join("video-editor-media");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {e}"))?;

    let safe_prompt: String = prompt
        .chars()
        .take(24)
        .map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' })
        .collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("music_{safe_prompt}_{stamp}.mp3");
    let path: PathBuf = tmp_dir.join(filename);

    std::fs::write(&path, audio_bytes).map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// MiniMax returns audio either as a hex string or as base64. Try both.
fn decode_audio_payload(s: &str) -> Option<Vec<u8>> {
    if let Some(bytes) = decode_hex(s) {
        return Some(bytes);
    }
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let hi = nibble(s.as_bytes()[i])?;
        let lo = nibble(s.as_bytes()[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Diagnostic ping — sends a minimal POST to /v1/music_generation with
/// `output_format: "url"` and a tiny prompt, returns the HTTP status +
/// raw body so the user can see exactly what MiniMax replies. Does NOT
/// download any audio. Useful when debugging auth/region issues.
pub fn diagnose_minimax(api_key: &str, base_url: &str) -> Result<String, String> {
    let api_key = api_key.trim();
    let base = base_url.trim().trim_end_matches('/');
    if api_key.is_empty() || base.is_empty() {
        return Err("API key 或 base url 为空".to_string());
    }
    let endpoint = format!("{base}/v1/music_generation");

    let body = json!({
        "model": MUSIC_MODEL,
        "prompt": "ping",
        "output_format": "url",
        "audio_setting": { "sample_rate": 44100, "bitrate": 256000, "format": "mp3" },
        "is_instrumental": true,
        "lyrics": "",
    });

    let result = ureq::post(&endpoint)
        .set("Content-Type", "application/json")
        .set("Authorization", &format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_secs(20))
        .send_json(body);

    let (status, body_text) = match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.into_string().unwrap_or_else(|e| format!("(read body err: {e})"));
            (status, body)
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_else(|e| format!("(read body err: {e})"));
            (code, body)
        }
        Err(other) => return Err(format!("transport error: {other}")),
    };

    let fp = key_fingerprint(api_key);
    Ok(format!(
        "endpoint: {endpoint}\nkey: {fp} ({} chars)\nHTTP {status}\nresponse:\n{body_text}",
        api_key.len()
    ))
}

/// Show enough of the key to verify the right value is being sent without
/// leaking the secret. e.g. "eyJhbGc...XYZ" for a JWT.
fn key_fingerprint(key: &str) -> String {
    if key.len() <= 14 {
        // Short / suspect key — show length only.
        return format!("(too short: {} chars)", key.len());
    }
    let head: String = key.chars().take(8).collect();
    let tail: String = key.chars().rev().take(4).collect::<String>().chars().rev().collect();
    format!("{head}...{tail}")
}

fn parse_captions(raw: &str, count: usize) -> Result<Vec<String>, String> {
    // Try to find a JSON array embedded anywhere in the text.
    if let (Some(start), Some(end)) = (raw.find('['), raw.rfind(']')) {
        if end > start {
            let slice = &raw[start..=end];
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(slice) {
                if arr.len() >= count {
                    return Ok(arr.into_iter().take(count).collect());
                }
                if !arr.is_empty() {
                    // Pad short responses with the last entry repeated.
                    let last = arr.last().cloned().unwrap_or_default();
                    let mut out = arr;
                    while out.len() < count {
                        out.push(last.clone());
                    }
                    return Ok(out);
                }
            }
        }
    }
    // Strip code fences and try again.
    let cleaned = raw.trim_matches('`').trim().trim_start_matches("json").trim();
    if let Ok(arr) = serde_json::from_str::<Vec<String>>(cleaned) {
        if !arr.is_empty() {
            let mut out: Vec<String> = arr.into_iter().take(count).collect();
            let last = out.last().cloned().unwrap_or_default();
            while out.len() < count {
                out.push(last.clone());
            }
            return Ok(out);
        }
    }
    Err(format!("could not parse captions from response: {}", raw.chars().take(200).collect::<String>()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_json_array() {
        let raw = r#"["第一句", "第二句", "第三句"]"#;
        let out = parse_captions(raw, 3).unwrap();
        assert_eq!(out, vec!["第一句", "第二句", "第三句"]);
    }

    #[test]
    fn parses_array_embedded_in_prose() {
        let raw = "Sure, here are the captions:\n\n[\"a\", \"b\", \"c\"]\n\nHope that helps!";
        let out = parse_captions(raw, 3).unwrap();
        assert_eq!(out, vec!["a", "b", "c"]);
    }

    #[test]
    fn parses_array_with_code_fence() {
        let raw = "```json\n[\"x\", \"y\"]\n```";
        let out = parse_captions(raw, 2).unwrap();
        assert_eq!(out, vec!["x", "y"]);
    }

    #[test]
    fn truncates_overlong_response_to_count() {
        let raw = r#"["a","b","c","d","e"]"#;
        let out = parse_captions(raw, 3).unwrap();
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn pads_short_response_by_repeating_last() {
        let raw = r#"["solo"]"#;
        let out = parse_captions(raw, 4).unwrap();
        assert_eq!(out.len(), 4);
        assert_eq!(out[0], "solo");
        assert_eq!(out[3], "solo");
    }

    #[test]
    fn errors_on_unparseable_response() {
        let raw = "I cannot help with that request.";
        assert!(parse_captions(raw, 3).is_err());
    }

    #[test]
    fn decode_hex_round_trips() {
        let hex = "48656c6c6f";
        assert_eq!(decode_hex(hex).unwrap(), b"Hello");
    }

    #[test]
    fn decode_hex_rejects_odd_length() {
        assert!(decode_hex("abc").is_none());
    }

    #[test]
    fn decode_hex_rejects_non_hex() {
        assert!(decode_hex("zzzz").is_none());
    }

    #[test]
    fn decode_audio_falls_back_to_base64() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"music!");
        assert_eq!(decode_audio_payload(&b64).unwrap(), b"music!");
    }
}
