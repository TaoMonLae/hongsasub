use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use uuid::Uuid;

#[derive(Clone)]
pub struct MediaServer {
    port: u16,
    files: Arc<Mutex<HashMap<String, PathBuf>>>,
}

impl MediaServer {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let files: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::default();
        let shared = files.clone();
        std::thread::Builder::new().name("media-server".into()).spawn(move || {
            for stream in listener.incoming().flatten() {
                let files = shared.clone();
                let _ = std::thread::Builder::new().name("media-conn".into()).spawn(move || serve(stream, &files));
            }
        })?;
        Ok(Self { port, files })
    }

    pub fn url_for(&self, path: &Path) -> String {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let existing = files.iter().find(|(_, p)| p.as_path() == path).map(|(t, _)| t.clone());
        let token = existing.unwrap_or_else(|| {
            let token = Uuid::new_v4().simple().to_string();
            files.insert(token.clone(), path.to_path_buf());
            token
        });
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        format!("http://127.0.0.1:{}/media/{token}/{}", self.port, encode(&name))
    }

}

fn encode(name: &str) -> String {
    name.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "video/mp4",
    }
}

struct Request {
    method: String,
    target: String,
    range: Option<String>,
    keep_alive: bool,
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Request> {
    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();
    let mut range = None;
    let mut keep_alive = version != "HTTP/1.0";
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            return None;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((k, v)) = header.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            let v = v.trim();
            if k == "range" {
                range = Some(v.to_string());
            } else if k == "connection" {
                keep_alive = !v.eq_ignore_ascii_case("close");
            }
        }
    }
    Some(Request { method, target, range, keep_alive })
}

fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if size == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (size.saturating_sub(n), size - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { size - 1 } else { b.parse::<u64>().ok()?.min(size - 1) };
        (start, end)
    };
    (start <= end && start < size).then_some((start, end))
}

fn respond_status(stream: &mut TcpStream, status: &str, extra: &str) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\n{extra}\r\n")
}

fn serve(stream: TcpStream, files: &Mutex<HashMap<String, PathBuf>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);
    while let Some(req) = read_request(&mut reader) {
        if handle(&mut writer, &req, files).is_err() || !req.keep_alive {
            break;
        }
    }
}

fn handle(out: &mut TcpStream, req: &Request, files: &Mutex<HashMap<String, PathBuf>>) -> std::io::Result<()> {
    if req.method == "OPTIONS" {
        return respond_status(out, "204 No Content", "Access-Control-Allow-Headers: Range\r\n");
    }
    if req.method != "GET" && req.method != "HEAD" {
        return respond_status(out, "405 Method Not Allowed", "");
    }
    let token = req.target.strip_prefix("/media/").and_then(|rest| rest.split('/').next()).unwrap_or("");
    let path = files.lock().unwrap_or_else(|e| e.into_inner()).get(token).cloned();
    let Some(path) = path else { return respond_status(out, "404 Not Found", "") };
    let Ok(mut file) = File::open(&path) else { return respond_status(out, "404 Not Found", "") };
    let size = file.metadata()?.len();
    let kind = content_type(&path);
    let (status, start, end) = match req.range.as_deref() {
        Some(r) => match parse_range(r, size) {
            Some((s, e)) => ("206 Partial Content", s, e),
            None => return respond_status(out, "416 Range Not Satisfiable", &format!("Content-Range: bytes */{size}\r\n")),
        },
        None => ("200 OK", 0, size.saturating_sub(1)),
    };
    let len = if size == 0 { 0 } else { end - start + 1 };
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n"
    );
    if status.starts_with("206") {
        head.push_str(&format!("Content-Range: bytes {start}-{end}/{size}\r\n"));
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())?;
    if req.method == "HEAD" || len == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start))?;
    let mut remaining = len;
    let mut buf = vec![0u8; 256 * 1024];
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        let n = file.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n])?;
        remaining -= n as u64;
    }
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(url: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_at(rest.find('/').unwrap());
        let mut s = TcpStream::connect(host).unwrap();
        let extra = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        write!(s, "GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n").unwrap();
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).unwrap();
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (String::from_utf8_lossy(&raw[..split]).to_string(), raw[split + 4..].to_vec())
    }

    #[test]
    fn serves_ranges_of_registered_files_only() {
        let dir = std::env::temp_dir().join(format!("hongsa-srv-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("film clip.mp4");
        std::fs::write(&file, (0..=255u8).collect::<Vec<_>>()).unwrap();
        let server = MediaServer::start().unwrap();
        let url = server.url_for(&file);
        assert!(url.ends_with("/film%20clip.mp4"));
        assert_eq!(server.url_for(&file), url);
        let (head, body) = get(&url, None);
        assert!(head.starts_with("HTTP/1.1 200"));
        assert_eq!(body.len(), 256);
        let (head, body) = get(&url, Some("bytes=10-19"));
        assert!(head.starts_with("HTTP/1.1 206"));
        assert!(head.contains("Content-Range: bytes 10-19/256"));
        assert_eq!(body, (10..20u8).collect::<Vec<_>>());
        let (head, body) = get(&url, Some("bytes=-6"));
        assert!(head.contains("Content-Range: bytes 250-255/256"));
        assert_eq!(body.len(), 6);
        let (head, _) = get(&url, Some("bytes=999-"));
        assert!(head.starts_with("HTTP/1.1 416"));
        let bogus = url.replace(&url.split('/').nth(4).unwrap().to_string(), "nope");
        assert!(get(&bogus, None).0.starts_with("HTTP/1.1 404"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
