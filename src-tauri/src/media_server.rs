//! Tiny HTTP/1.1 server bound to 127.0.0.1 with byte-range support.
//!
//! Why this exists: WKWebView's `<video>` element on macOS does not handle
//! the `asset://` custom protocol reliably for media (no range requests, or
//! load failures with `MEDIA_ERR_SRC_NOT_SUPPORTED`). Serving the same files
//! over `http://127.0.0.1:<port>/...` works because the browser uses its
//! standard HTTP media stack — proper range requests, MIME sniffing, etc.
//!
//! The server only binds to loopback and is keyed by the absolute file path
//! in the URL. No directory listing, no upload, no search.

use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Bind to 127.0.0.1 on a random port, spawn the accept loop, and return
/// the chosen port. The accept loop runs as a tokio task for the lifetime
/// of the runtime.
pub async fn start() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer)) => {
                    tokio::spawn(async move {
                        if let Err(e) = handle(stream).await {
                            // BrokenPipe / ConnectionReset are normal when the
                            // browser aborts a media stream early (it has
                            // buffered enough, or is seeking). Don't spam.
                            match e.kind() {
                                std::io::ErrorKind::BrokenPipe
                                | std::io::ErrorKind::ConnectionReset
                                | std::io::ErrorKind::ConnectionAborted
                                | std::io::ErrorKind::UnexpectedEof => {}
                                _ => eprintln!("[media_server] request error: {e}"),
                            }
                        }
                    });
                }
                Err(e) => {
                    eprintln!("[media_server] accept error: {e}");
                }
            }
        }
    });

    Ok(port)
}

async fn handle(mut stream: TcpStream) -> std::io::Result<()> {
    // Read until end of headers (CRLFCRLF).
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if has_header_terminator(&buf) {
            break;
        }
        if buf.len() > 16 * 1024 {
            return write_status(&mut stream, 431, "Request Header Too Large").await;
        }
    }

    let req = String::from_utf8_lossy(&buf);
    let mut lines = req.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let parts: Vec<&str> = request_line.splitn(3, ' ').collect();
    if parts.len() < 3 {
        return write_status(&mut stream, 400, "Bad Request").await;
    }
    let method = parts[0];
    let raw_path = parts[1];

    if method != "GET" && method != "HEAD" {
        return write_status(&mut stream, 405, "Method Not Allowed").await;
    }

    // /Users/foo/file.mp4 — strip leading slash, drop query string, decode.
    // On Windows the decoded path is already absolute (e.g. `C:\Users\...`)
    // because `get_media_url` percent-encodes the whole path; re-prepending
    // `/` there would yield `/C:\Users\...` which never opens. POSIX paths
    // arrive without their leading `/` (we stripped it above), so we restore
    // it for that case only.
    let no_query = raw_path.split('?').next().unwrap_or("");
    let path_no_slash = no_query.trim_start_matches('/');
    let decoded = match percent_decode(path_no_slash) {
        Some(s) => s,
        None => return write_status(&mut stream, 400, "Bad Request").await,
    };
    let abs_path = if is_windows_absolute(&decoded) {
        PathBuf::from(decoded)
    } else {
        PathBuf::from(format!("/{decoded}"))
    };

    // Range parsing: only the simple `bytes=START-` and `bytes=START-END` forms.
    let mut range_header: Option<&str> = None;
    for line in lines {
        if let Some(rest) = strip_prefix_ci(line, "range:") {
            range_header = Some(rest.trim());
        }
    }
    let parsed_range = range_header
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(parse_range);

    // Open file.
    let mut file = match tokio::fs::File::open(&abs_path).await {
        Ok(f) => f,
        Err(_) => return write_status(&mut stream, 404, "Not Found").await,
    };
    let total = match file.metadata().await {
        Ok(m) => m.len(),
        Err(_) => return write_status(&mut stream, 500, "Internal Server Error").await,
    };
    if total == 0 {
        return write_status(&mut stream, 404, "Empty File").await;
    }

    let max = total - 1;
    let (start, end, partial) = match parsed_range {
        Some((s, Some(e))) => (s.min(max), e.min(max), true),
        Some((s, None)) => (s.min(max), max, true),
        None => (0u64, max, false),
    };
    if start > end {
        let resp = format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\n\
             Content-Range: bytes */{total}\r\n\
             Content-Length: 0\r\n\r\n"
        );
        return stream.write_all(resp.as_bytes()).await;
    }
    let length = end - start + 1;

    let content_type = guess_mime(&abs_path);
    let status = if partial { "206 Partial Content" } else { "200 OK" };
    let mut headers = format!(
        "HTTP/1.1 {status}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {length}\r\n\
         Accept-Ranges: bytes\r\n\
         Cache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\n"
    );
    if partial {
        headers.push_str(&format!("Content-Range: bytes {start}-{end}/{total}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await?;

    if method == "HEAD" {
        return Ok(());
    }

    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut remaining = length;
    let mut chunk = vec![0u8; 64 * 1024];
    while remaining > 0 {
        let to_read = chunk.len().min(remaining as usize);
        let n = file.read(&mut chunk[..to_read]).await?;
        if n == 0 {
            break;
        }
        stream.write_all(&chunk[..n]).await?;
        remaining -= n as u64;
    }
    Ok(())
}

fn has_header_terminator(buf: &[u8]) -> bool {
    buf.windows(4).any(|w| w == b"\r\n\r\n")
}

async fn write_status(stream: &mut TcpStream, code: u16, reason: &str) -> std::io::Result<()> {
    let body = reason.to_string();
    let resp = format!(
        "HTTP/1.1 {code} {reason}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Cache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(resp.as_bytes()).await
}

fn parse_range(value: &str) -> Option<(u64, Option<u64>)> {
    let (start, end) = value.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end = end.trim();
    let end = if end.is_empty() { None } else { Some(end.parse().ok()?) };
    Some((start, end))
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() < prefix.len() {
        return None;
    }
    let head = &s[..prefix.len()];
    if head.eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = hex_nibble(bytes[i + 1])?;
            let l = hex_nibble(bytes[i + 2])?;
            out.push((h << 4) | l);
            i += 3;
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `C:\...` / `C:/...` (drive-letter absolute) or `\\server\share` (UNC).
fn is_windows_absolute(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    s.starts_with("\\\\")
}

fn hex_nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn guess_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        Some("opus") => "audio/opus",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    // ── Unit tests for helpers ───────────────────────────────────────────

    #[test]
    fn windows_absolute_detection() {
        assert!(is_windows_absolute(r"C:\Users\foo"));
        assert!(is_windows_absolute("c:/Users/foo"));
        assert!(is_windows_absolute(r"\\server\share\file"));
        assert!(!is_windows_absolute("Users/foo/bar.mp4"));
        assert!(!is_windows_absolute("C:foo")); // drive-relative, not absolute
        assert!(!is_windows_absolute(""));
    }

    #[test]
    fn parse_range_full() {
        assert_eq!(parse_range("0-1023"), Some((0, Some(1023))));
        assert_eq!(parse_range("100-"), Some((100, None)));
        assert_eq!(parse_range("not-a-range"), None);
    }

    #[test]
    fn percent_decode_basic() {
        assert_eq!(
            percent_decode("Users%2Fyihuazhuo%2FDownloads%2Ftest.mp4").as_deref(),
            Some("Users/yihuazhuo/Downloads/test.mp4")
        );
        assert_eq!(percent_decode("hello%20world").as_deref(), Some("hello world"));
    }

    #[test]
    fn guess_mime_extensions() {
        assert_eq!(guess_mime(Path::new("/foo/bar.mp4")), "video/mp4");
        assert_eq!(guess_mime(Path::new("/foo/bar.MOV")), "video/quicktime");
        assert_eq!(guess_mime(Path::new("/foo/bar.mp3")), "audio/mpeg");
        assert_eq!(guess_mime(Path::new("/foo/bar.unknown")), "application/octet-stream");
    }

    // ── Integration tests ────────────────────────────────────────────────
    //
    // These actually start the server, then drive it via a real TCP HTTP
    // client. Each test gets its own server (random port), so they're
    // independent and parallel-safe.

    struct HttpResponse {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl HttpResponse {
        fn header(&self, key: &str) -> Option<&str> {
            let key = key.to_ascii_lowercase();
            self.headers
                .iter()
                .find(|(k, _)| k == &key)
                .map(|(_, v)| v.as_str())
        }
    }

    /// Send a single HTTP/1.1 request over a fresh TCP connection and read
    /// the full response (until the server closes the connection).
    async fn http_request(
        port: u16,
        method: &str,
        path: &str,
        range: Option<&str>,
    ) -> std::io::Result<HttpResponse> {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
        let mut req = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n"
        );
        if let Some(r) = range {
            req.push_str(&format!("Range: {r}\r\n"));
        }
        req.push_str("\r\n");
        stream.write_all(req.as_bytes()).await?;
        stream.flush().await?;

        let mut buf = Vec::new();
        let mut tmp = [0u8; 8192];
        loop {
            let n = stream.read(&mut tmp).await?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        parse_response(&buf)
    }

    fn parse_response(buf: &[u8]) -> std::io::Result<HttpResponse> {
        let pos = buf
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "no CRLFCRLF in response")
            })?;
        let header_str = std::str::from_utf8(&buf[..pos])
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "bad header utf8"))?;
        let body = buf[pos + 4..].to_vec();

        let mut lines = header_str.split("\r\n");
        let status_line = lines.next().unwrap_or("");
        let parts: Vec<&str> = status_line.splitn(3, ' ').collect();
        let status: u16 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

        let mut headers = Vec::new();
        for line in lines {
            if let Some((k, v)) = line.split_once(':') {
                headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
            }
        }
        Ok(HttpResponse { status, headers, body })
    }

    fn write_temp_with_extension(content: &[u8], ext: &str) -> NamedTempFile {
        let tmp = tempfile::Builder::new()
            .suffix(&format!(".{ext}"))
            .tempfile()
            .expect("tempfile");
        let mut f = tmp.reopen().expect("reopen");
        f.write_all(content).expect("write");
        f.flush().expect("flush");
        tmp
    }

    #[tokio::test]
    async fn server_get_full_file_returns_200() {
        let content = b"hello world this is a media server integration test";
        let tmp = write_temp_with_extension(content, "mp3");
        let port = start().await.expect("server start");

        let path = tmp.path().to_str().unwrap();
        let resp = http_request(port, "GET", path, None).await.expect("request");

        assert_eq!(resp.status, 200, "expected 200 OK");
        assert_eq!(resp.body, content, "body should match file");
        assert_eq!(resp.header("content-length"), Some(content.len().to_string().as_str()));
        assert_eq!(resp.header("content-type"), Some("audio/mpeg"));
        assert_eq!(resp.header("accept-ranges"), Some("bytes"));
        assert!(resp.header("content-range").is_none(), "200 should have no content-range");
    }

    #[tokio::test]
    async fn server_head_returns_headers_no_body() {
        let content = b"head request body should not be returned";
        let tmp = write_temp_with_extension(content, "mp4");
        let port = start().await.expect("server start");

        let path = tmp.path().to_str().unwrap();
        let resp = http_request(port, "HEAD", path, None).await.expect("request");

        assert_eq!(resp.status, 200);
        assert_eq!(resp.body.len(), 0, "HEAD response must have empty body");
        assert_eq!(resp.header("content-length"), Some(content.len().to_string().as_str()));
        assert_eq!(resp.header("content-type"), Some("video/mp4"));
    }

    #[tokio::test]
    async fn server_byte_range_returns_206_partial() {
        // Generate 1000 bytes with deterministic content so we can verify exact slicing.
        let content: Vec<u8> = (0..1000u32).map(|i| (i & 0xff) as u8).collect();
        let tmp = write_temp_with_extension(&content, "mp4");
        let port = start().await.expect("server start");

        let path = tmp.path().to_str().unwrap();
        let resp = http_request(port, "GET", path, Some("bytes=100-199"))
            .await
            .expect("request");

        assert_eq!(resp.status, 206, "expected 206 Partial Content");
        assert_eq!(resp.body, content[100..=199], "body should be exactly bytes 100..=199");
        assert_eq!(resp.body.len(), 100);
        assert_eq!(resp.header("content-length"), Some("100"));
        assert_eq!(
            resp.header("content-range"),
            Some(format!("bytes 100-199/{}", content.len()).as_str())
        );
    }

    #[tokio::test]
    async fn server_open_ended_range_returns_to_eof() {
        let content: Vec<u8> = (0..500u32).map(|i| (i & 0xff) as u8).collect();
        let tmp = write_temp_with_extension(&content, "mp4");
        let port = start().await.expect("server start");

        let path = tmp.path().to_str().unwrap();
        let resp = http_request(port, "GET", path, Some("bytes=400-"))
            .await
            .expect("request");

        assert_eq!(resp.status, 206);
        assert_eq!(resp.body, content[400..]);
        assert_eq!(resp.header("content-length"), Some("100"));
        assert_eq!(
            resp.header("content-range"),
            Some(format!("bytes 400-499/{}", content.len()).as_str())
        );
    }

    #[tokio::test]
    async fn server_sequential_ranges_simulate_video_seek() {
        // Browsers issue many small range requests as the user seeks. Run a
        // sequence and confirm each one returns the correct slice — proves
        // the server can handle concurrent / repeated requests cleanly.
        let content: Vec<u8> = (0..10_000u32).map(|i| (i & 0xff) as u8).collect();
        let tmp = write_temp_with_extension(&content, "mp4");
        let port = start().await.expect("server start");
        let path = tmp.path().to_str().unwrap();

        let ranges = [(0, 99), (5000, 5999), (9000, 9999), (100, 100)];
        for (start, end) in ranges {
            let header = format!("bytes={start}-{end}");
            let resp = http_request(port, "GET", path, Some(&header))
                .await
                .expect("request");
            assert_eq!(resp.status, 206, "range {start}-{end}");
            assert_eq!(resp.body, content[start..=end], "range {start}-{end} body");
        }
    }

    #[tokio::test]
    async fn server_returns_404_for_missing_file() {
        let port = start().await.expect("server start");
        let resp = http_request(port, "GET", "/nope/this-does-not-exist-12345.mp4", None)
            .await
            .expect("request");
        assert_eq!(resp.status, 404);
    }

    #[tokio::test]
    async fn server_returns_405_for_post() {
        let tmp = write_temp_with_extension(b"x", "mp4");
        let port = start().await.expect("server start");
        let path = tmp.path().to_str().unwrap();
        let resp = http_request(port, "POST", path, None).await.expect("request");
        assert_eq!(resp.status, 405);
    }

    #[tokio::test]
    async fn server_handles_percent_encoded_path() {
        // Tauri encodes the URL — the server must percent-decode it back to a
        // real path. Pick a path with a space so encoding actually matters.
        let content = b"encoded path test";
        let tmp = tempfile::Builder::new()
            .suffix("-with space.mp4")
            .tempfile()
            .expect("tempfile");
        let mut f = tmp.reopen().expect("reopen");
        f.write_all(content).expect("write");
        f.flush().expect("flush");

        let port = start().await.expect("server start");
        let raw = tmp.path().to_str().unwrap();
        let encoded: String = raw
            .chars()
            .map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' => c.to_string(),
                _ => format!("%{:02X}", c as u8),
            })
            .collect();

        let resp = http_request(port, "GET", &encoded, None)
            .await
            .expect("request");
        assert_eq!(resp.status, 200);
        assert_eq!(resp.body, content);
    }

    /// End-to-end test against the real fixture used elsewhere. Requests the
    /// first 1 MiB and checks for the mp4 ftyp atom in the first chunk —
    /// proving the server actually streams real mp4 bytes that `<video>`
    /// would parse on the frontend.
    #[tokio::test]
    async fn server_streams_real_mp4_first_megabyte() {
        let path = "/Users/yihuazhuo/Downloads/test.mp4";
        if !Path::new(path).exists() {
            eprintln!("skipping: fixture {path} not present");
            return;
        }
        let port = start().await.expect("server start");
        let resp = http_request(port, "GET", path, Some("bytes=0-1048575"))
            .await
            .expect("request");

        assert_eq!(resp.status, 206);
        assert_eq!(resp.body.len(), 1024 * 1024);
        assert_eq!(resp.header("content-type"), Some("video/mp4"));

        // mp4 files have a "ftyp" box near the start (bytes 4..8 typically).
        // Find it within the first KiB to confirm we're getting real mp4 data.
        let head = &resp.body[..1024];
        let has_ftyp = head.windows(4).any(|w| w == b"ftyp");
        assert!(has_ftyp, "expected 'ftyp' box marker in first KiB of mp4");
    }
}
