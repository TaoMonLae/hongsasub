use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::server::MediaServer;

const NATIVE_CONTAINERS: [&str; 4] = ["mp4", "m4v", "mov", "webm"];
const COPY_VIDEO: [&str; 2] = ["h264", "hevc"];
const COPY_AUDIO: [&str; 4] = ["aac", "mp3", "alac", "opus"];
const PEAK_RATE: u32 = 100;
const SAMPLE_RATE: u32 = 8000;
const CACHE_VERSION: u8 = 2;
const CACHE_LIMIT_BYTES: u64 = 30 * 1024 * 1024 * 1024;
const CACHE_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(30 * 86_400);

static JOB: AtomicU64 = AtomicU64::new(0);
static RUNNING: Mutex<Vec<u32>> = Mutex::new(Vec::new());

struct Tracked(u32);

impl Tracked {
    fn new(pid: u32) -> Self {
        if let Ok(mut list) = RUNNING.lock() {
            list.push(pid);
        }
        Self(pid)
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        if let Ok(mut list) = RUNNING.lock() {
            list.retain(|p| *p != self.0);
        }
    }
}

pub fn stop_all() {
    let pids: Vec<u32> = RUNNING.lock().map(|l| l.clone()).unwrap_or_default();
    for pid in pids {
        let _ = if cfg!(windows) {
            quiet_command("taskkill").args(["/PID", &pid.to_string(), "/F"]).status()
        } else {
            Command::new("kill").arg(pid.to_string()).status()
        };
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSource {
    pub path: String,
    pub url: String,
    pub proxied: bool,
    pub mode: PrepareMode,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PrepareMode {
    Direct,
    Remux,
    Transcode,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    source: String,
    mode: PrepareMode,
    ratio: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peaks {
    pub rate: u32,
    pub peaks: Vec<u8>,
}

#[derive(Default, Debug)]
struct Probe {
    duration: f64,
    video_codec: String,
    video_tag: String,
    pix_fmt: String,
    audio_codec: Option<String>,
}

fn find_tool(name: &str) -> Option<PathBuf> {
    static FOUND: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());
    let cached = FOUND.lock().ok().and_then(|list| list.iter().find(|(n, _)| n == name).map(|(_, p)| p.clone()));
    if cached.is_some() {
        return cached;
    }
    let found = locate_tool(name)?;
    if let Ok(mut list) = FOUND.lock() {
        list.push((name.to_string(), found.clone()));
    }
    Some(found)
}

#[cfg(windows)]
pub(crate) fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(not(windows))]
pub(crate) fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    Command::new(program)
}

fn locate_tool(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(dir.join(&exe));
    }
    candidates.push(PathBuf::from(&exe));
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\ffmpeg\\bin"] {
        candidates.push(Path::new(dir).join(&exe));
    }
    candidates.into_iter().find(|p| {
        quiet_command(p).arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()
    })
}

fn ffmpeg() -> Option<PathBuf> {
    find_tool("ffmpeg")
}

fn probe(source: &Path) -> Result<Probe, String> {
    let bin = find_tool("ffprobe").ok_or("ffprobe was not found, so this video can't be opened. Reinstall HongsaSub to restore it.")?;
    let out = quiet_command(bin)
        .args(["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,codec_tag_string,pix_fmt", "-of", "compact=p=0"])
        .arg(source)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(parse_probe(&String::from_utf8_lossy(&out.stdout)))
}

fn parse_probe(text: &str) -> Probe {
    let mut probe = Probe::default();
    for line in text.lines() {
        let fields: Vec<(&str, &str)> = line.split('|').filter_map(|f| f.split_once('=')).collect();
        let get = |key: &str| fields.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string()).unwrap_or_default();
        match get("codec_type").as_str() {
            "video" if probe.video_codec.is_empty() && get("codec_name") != "mjpeg" && get("codec_name") != "png" => {
                probe.video_codec = get("codec_name");
                probe.video_tag = get("codec_tag_string");
                probe.pix_fmt = get("pix_fmt");
            }
            "audio" if probe.audio_codec.is_none() => probe.audio_codec = Some(get("codec_name")),
            _ => {
                if let Ok(d) = get("duration").parse::<f64>() {
                    probe.duration = d;
                }
            }
        }
    }
    probe
}

fn choose_mode(ext: &str, probe: &Probe, force_transcode: bool) -> PrepareMode {
    if force_transcode {
        return PrepareMode::Transcode;
    }
    let video_ok = match probe.video_codec.as_str() {
        "h264" => !probe.pix_fmt.contains("10") && !probe.pix_fmt.contains("422") && !probe.pix_fmt.contains("444"),
        "hevc" => true,
        "vp8" | "vp9" | "av1" => ext == "webm",
        _ => false,
    };
    if !video_ok {
        return PrepareMode::Transcode;
    }
    let audio_ok = probe.audio_codec.as_deref().is_none_or(|a| COPY_AUDIO.contains(&a) || (ext == "webm" && a == "vorbis"));
    let hevc_tag_ok = probe.video_codec != "hevc" || probe.video_tag == "hvc1";
    if NATIVE_CONTAINERS.contains(&ext) && audio_ok && hevc_tag_ok {
        PrepareMode::Direct
    } else if COPY_VIDEO.contains(&probe.video_codec.as_str()) {
        PrepareMode::Remux
    } else {
        PrepareMode::Transcode
    }
}

fn cache_key(path: &Path, mode: PrepareMode) -> String {
    let mut hasher = DefaultHasher::new();
    CACHE_VERSION.hash(&mut hasher);
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            modified.hash(&mut hasher);
        }
    }
    let tag = match mode {
        PrepareMode::Remux => "r",
        _ => "t",
    };
    format!("{:016x}-{tag}", hasher.finish())
}

fn touch(path: &Path) {
    if let Ok(file) = std::fs::File::options().append(true).open(path) {
        let _ = file.set_modified(std::time::SystemTime::now());
    }
}

fn prune_cache(cache_dir: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else { return };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            (meta.is_file() && name.ends_with(".mp4") && !name.contains(".part")).then(|| {
                (e.path(), meta.len(), meta.modified().unwrap_or(std::time::UNIX_EPOCH))
            })
        })
        .collect();
    files.sort_by_key(|f| f.2);
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    for (path, len, modified) in files {
        if path == keep {
            continue;
        }
        let expired = modified.elapsed().is_ok_and(|age| age > CACHE_MAX_AGE);
        if (expired || total > CACHE_LIMIT_BYTES) && std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

fn drop_other_copies(cache_dir: &Path, source: &Path, playing: &Path) {
    for mode in [PrepareMode::Remux, PrepareMode::Transcode] {
        let candidate = cache_dir.join(format!("{}.mp4", cache_key(source, mode)));
        if candidate != playing {
            let _ = std::fs::remove_file(candidate);
        }
    }
}

fn remove_stale_parts(cache_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(cache_dir) else { return };
    let day = std::time::Duration::from_secs(86_400);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.contains(".part") {
            continue;
        }
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_none_or(|age| age > day);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn audio_args(probe: &Probe, mode: PrepareMode) -> Vec<String> {
    let copy = mode == PrepareMode::Remux && probe.audio_codec.as_deref().is_some_and(|a| COPY_AUDIO.contains(&a));
    if copy {
        vec!["-c:a".into(), "copy".into()]
    } else {
        ["-c:a", "aac", "-b:a", "160k", "-ac", "2"].iter().map(|s| s.to_string()).collect()
    }
}

fn transcode_variants(probe: &Probe) -> Vec<Vec<String>> {
    let to = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<String>>();
    let mut variants = Vec::new();
    if cfg!(target_os = "macos") {
        variants.push(to(&[
            "-hwaccel", "videotoolbox", "-hwaccel_output_format", "videotoolbox_vld", "@INPUT@",
            "-vf", "scale_vt=w=-2:h=720", "-c:v", "h264_videotoolbox", "-b:v", "3M", "-allow_sw", "1",
        ]));
        variants.push(to(&[
            "-hwaccel", "videotoolbox", "@INPUT@", "-vf", "scale=-2:720,format=yuv420p", "-c:v", "h264_videotoolbox",
            "-b:v", "3M", "-allow_sw", "1",
        ]));
    }
    if cfg!(windows) {
        variants.push(to(&["@INPUT@", "-vf", "scale=-2:720,format=nv12", "-c:v", "h264_mf", "-b:v", "3M", "-hw_encoding", "1"]));
        variants.push(to(&["@INPUT@", "-vf", "scale=-2:720,format=nv12", "-c:v", "h264_mf", "-b:v", "3M"]));
    }
    variants.push(to(&[
        "@INPUT@", "-vf", "scale=-2:540,format=yuv420p", "-c:v", "libopenh264", "-b:v", "2M", "-allow_skip_frames", "0",
    ]));
    variants.push(to(&[
        "@INPUT@", "-vf", "scale=-2:540,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
        "-tune", "fastdecode",
    ]));
    if probe.video_codec.is_empty() {
        variants.clear();
    }
    variants
}

fn run_ffmpeg(
    bin: &Path,
    source: &Path,
    pre_and_video: &[String],
    audio: &[String],
    out: &Path,
    duration: f64,
    on_progress: &dyn Fn(f64),
) -> Result<(), String> {
    let mut cmd = quiet_command(bin);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1"]);
    for arg in pre_and_video {
        if arg == "@INPUT@" {
            cmd.arg("-i").arg(source).args(["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"]);
        } else {
            cmd.arg(arg);
        }
    }
    cmd.args(audio).args(["-movflags", "+faststart", "-f", "mp4"]).arg(out);
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let _tracked = Tracked::new(child.id());
    let mut stderr = child.stderr.take();
    let err_reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_string(&mut text);
        }
        text
    });
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(|l| l.ok()) {
            if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.trim().parse::<f64>().ok()) {
                if duration > 0.0 {
                    on_progress((us / 1_000_000.0 / duration).clamp(0.0, 1.0));
                }
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr_text = err_reader.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(stderr_text.trim().lines().last().unwrap_or("ffmpeg failed").to_string())
    }
}

fn prepare(source: &Path, cache_dir: &Path, force_transcode: bool, on_progress: &dyn Fn(PrepareMode, f64)) -> Result<VideoSource, String> {
    let ext = source.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let probe = match probe(source) {
        Ok(p) => p,
        Err(_) if NATIVE_CONTAINERS.contains(&ext.as_str()) && !force_transcode => {
            return Ok(VideoSource { path: source.to_string_lossy().to_string(), url: String::new(), proxied: false, mode: PrepareMode::Direct })
        }
        Err(e) => return Err(e),
    };
    let mode = choose_mode(&ext, &probe, force_transcode);
    if mode == PrepareMode::Direct {
        return Ok(VideoSource { path: source.to_string_lossy().to_string(), url: String::new(), proxied: false, mode });
    }
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    remove_stale_parts(cache_dir);
    let out = cache_dir.join(format!("{}.mp4", cache_key(source, mode)));
    if force_transcode {
        let rejected = cache_dir.join(format!("{}.mp4", cache_key(source, PrepareMode::Remux)));
        let _ = std::fs::remove_file(rejected);
    }
    if out.exists() {
        touch(&out);
        prune_cache(cache_dir, &out);
        return Ok(VideoSource { path: out.to_string_lossy().to_string(), url: String::new(), proxied: true, mode });
    }
    let bin = ffmpeg().ok_or("ffmpeg was not found, so this video can't be converted. Reinstall HongsaSub to restore it.")?;
    let tmp = out.with_extension(format!("part{}-{}.mp4", std::process::id(), JOB.fetch_add(1, Ordering::Relaxed)));
    on_progress(mode, 0.0);
    let report = |r: f64| on_progress(mode, r);
    let audio = audio_args(&probe, mode);
    let result = if mode == PrepareMode::Remux {
        let mut video: Vec<String> = vec!["@INPUT@".into(), "-c:v".into(), "copy".into()];
        if probe.video_codec == "hevc" {
            video.extend(["-tag:v".into(), "hvc1".into()]);
        }
        run_ffmpeg(&bin, source, &video, &audio, &tmp, probe.duration, &report)
    } else {
        let mut last = Err("this video has no picture stream".to_string());
        for variant in transcode_variants(&probe) {
            last = run_ffmpeg(&bin, source, &variant, &audio, &tmp, probe.duration, &report);
            if last.is_ok() {
                break;
            }
        }
        last
    };
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &out).map_err(|e| e.to_string())?;
    prune_cache(cache_dir, &out);
    on_progress(mode, 1.0);
    Ok(VideoSource { path: out.to_string_lossy().to_string(), url: String::new(), proxied: true, mode })
}

fn read_peaks(source: &Path) -> Result<Peaks, String> {
    let bin = ffmpeg().ok_or("ffmpeg was not found, so the waveform can't be shown. Reinstall HongsaSub to restore it.")?;
    let mut child = quiet_command(bin)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-vn", "-sn", "-dn", "-ac", "1", "-ar", &SAMPLE_RATE.to_string(), "-f", "s16le", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let _tracked = Tracked::new(child.id());
    let mut stdout = child.stdout.take().ok_or("no audio stream")?;
    let per_bucket = (SAMPLE_RATE / PEAK_RATE) as usize;
    let mut peaks = Vec::new();
    let mut buf = vec![0u8; per_bucket * 2 * 256];
    let mut carry: Vec<u8> = Vec::new();
    let mut current = 0i32;
    let mut count = 0usize;
    let level = |peak: i32| ((peak as f32 / 32768.0).sqrt() * 255.0).min(255.0) as u8;
    loop {
        let n = stdout.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        carry.extend_from_slice(&buf[..n]);
        let usable = carry.len() - carry.len() % 2;
        for chunk in carry[..usable].as_chunks::<2>().0 {
            let sample = i16::from_le_bytes([chunk[0], chunk[1]]) as i32;
            current = current.max(sample.abs());
            count += 1;
            if count == per_bucket {
                peaks.push(level(current));
                current = 0;
                count = 0;
            }
        }
        carry.drain(..usable);
    }
    if count > 0 {
        peaks.push(level(current));
    }
    let _ = child.wait();
    Ok(Peaks { rate: PEAK_RATE, peaks })
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join("proxies"))
}

#[tauri::command]
pub async fn video_played(app: AppHandle, source: String, playing: String) -> Result<(), String> {
    let cache = cache_dir(&app)?;
    if Path::new(&playing).starts_with(&cache) || Path::new(&playing) == Path::new(&source) {
        drop_other_copies(&cache, Path::new(&source), Path::new(&playing));
    }
    Ok(())
}

#[tauri::command]
pub async fn video_prepare(
    app: AppHandle,
    server: State<'_, MediaServer>,
    path: String,
    force: Option<bool>,
) -> Result<VideoSource, String> {
    let cache = cache_dir(&app)?;
    let server = server.inner().clone();
    let mut prepared = tauri::async_runtime::spawn_blocking(move || {
        let sent = std::cell::Cell::new(-1.0f64);
        let emit = |mode: PrepareMode, ratio: f64| {
            if ratio - sent.get() >= 0.005 || ratio >= 1.0 || ratio == 0.0 {
                sent.set(ratio);
                let _ = app.emit("video-progress", Progress { source: path.clone(), mode, ratio });
            }
        };
        prepare(Path::new(&path), &cache, force.unwrap_or(false), &emit)
    })
    .await
    .map_err(|e| e.to_string())??;
    prepared.url = server.url_for(Path::new(&prepared.path));
    Ok(prepared)
}

#[tauri::command]
pub async fn audio_peaks(path: String) -> Result<Peaks, String> {
    tauri::async_runtime::spawn_blocking(move || read_peaks(Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe_of(video: &str, tag: &str, pix: &str, audio: Option<&str>) -> Probe {
        Probe {
            duration: 10.0,
            video_codec: video.into(),
            video_tag: tag.into(),
            pix_fmt: pix.into(),
            audio_codec: audio.map(Into::into),
        }
    }

    #[test]
    fn parses_ffprobe_compact_output() {
        let p = parse_probe(
            "codec_name=hevc|codec_tag_string=[0][0][0][0]|codec_type=video|pix_fmt=yuv420p10le\ncodec_name=aac|codec_tag_string=[0][0][0][0]|codec_type=audio|pix_fmt=\ncodec_name=hdmv_pgs_subtitle|codec_type=subtitle\nduration=5540.494000\n",
        );
        assert_eq!(p.video_codec, "hevc");
        assert_eq!(p.pix_fmt, "yuv420p10le");
        assert_eq!(p.audio_codec.as_deref(), Some("aac"));
        assert!((p.duration - 5540.494).abs() < 0.001);
    }

    #[test]
    fn picks_fastest_mode() {
        assert_eq!(choose_mode("mkv", &probe_of("hevc", "", "yuv420p10le", Some("aac")), false), PrepareMode::Remux);
        assert_eq!(choose_mode("mkv", &probe_of("h264", "", "yuv420p", Some("ac3")), false), PrepareMode::Remux);
        assert_eq!(choose_mode("mp4", &probe_of("h264", "avc1", "yuv420p", Some("aac")), false), PrepareMode::Direct);
        assert_eq!(choose_mode("mp4", &probe_of("hevc", "hev1", "yuv420p", Some("aac")), false), PrepareMode::Remux);
        assert_eq!(choose_mode("mp4", &probe_of("hevc", "hvc1", "yuv420p", Some("aac")), false), PrepareMode::Direct);
        assert_eq!(choose_mode("avi", &probe_of("mpeg4", "XVID", "yuv420p", Some("mp3")), false), PrepareMode::Transcode);
        assert_eq!(choose_mode("mkv", &probe_of("h264", "", "yuv420p10le", Some("aac")), false), PrepareMode::Transcode);
        assert_eq!(choose_mode("mp4", &probe_of("h264", "avc1", "yuv420p", Some("aac")), true), PrepareMode::Transcode);
    }

    #[test]
    fn cache_prunes_expired_and_keeps_current() {
        let dir = std::env::temp_dir().join(format!("hongsa-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old-r.mp4");
        let fresh = dir.join("fresh-t.mp4");
        let keep = dir.join("keep-r.mp4");
        for f in [&old, &fresh, &keep] {
            std::fs::write(f, b"x").unwrap();
        }
        let long_ago = std::time::SystemTime::now() - CACHE_MAX_AGE - std::time::Duration::from_secs(60);
        for f in [&old, &keep] {
            std::fs::File::options().append(true).open(f).unwrap().set_modified(long_ago).unwrap();
        }
        prune_cache(&dir, &keep);
        assert!(!old.exists());
        assert!(fresh.exists());
        assert!(keep.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prepares_real_video() {
        let Ok(video) = std::env::var("HONGSA_TEST_VIDEO") else { return };
        let cache = std::env::temp_dir().join("hongsa-proxy-test");
        let _ = std::fs::remove_dir_all(&cache);
        let started = std::time::Instant::now();
        let seen = std::cell::Cell::new(0usize);
        let prepared = prepare(Path::new(&video), &cache, false, &|_, _| seen.set(seen.get() + 1)).unwrap();
        eprintln!("{:?} in {:?}, {} progress events", prepared.mode, started.elapsed(), seen.get());
        assert!(Path::new(&prepared.path).exists());
        let again = prepare(Path::new(&video), &cache, false, &|_, _| {}).unwrap();
        assert_eq!(again.path, prepared.path);
        if prepared.mode == PrepareMode::Remux {
            let forced = prepare(Path::new(&video), &cache, true, &|_, _| {}).unwrap();
            assert_eq!(forced.mode, PrepareMode::Transcode);
            assert!(!Path::new(&prepared.path).exists());
        }
        let peaks = read_peaks(Path::new(&video)).unwrap();
        assert!(!peaks.peaks.is_empty());
    }
}
