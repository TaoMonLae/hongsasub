use std::collections::BTreeSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

fn read_at(file: &mut File, offset: u64, len: usize) -> Option<Vec<u8>> {
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*b.get(at)?, *b.get(at + 1)?, *b.get(at + 2)?, *b.get(at + 3)?]))
}

fn decode_name(platform: u16, raw: &[u8]) -> Option<String> {
    let text = if platform == 0 || platform == 3 {
        let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16(&units).ok()?
    } else if platform == 1 {
        raw.iter().map(|&b| b as char).collect()
    } else {
        return None;
    };
    let text = text.trim().to_string();
    (!text.is_empty() && !text.starts_with('.')).then_some(text)
}

fn family_at(file: &mut File, offset: u64) -> Option<String> {
    let head = read_at(file, offset, 12)?;
    let tables = u16_at(&head, 4)? as usize;
    let dir = read_at(file, offset + 12, tables * 16)?;
    let (name_offset, name_len) = (0..tables).find_map(|i| {
        let rec = &dir[i * 16..i * 16 + 16];
        (&rec[0..4] == b"name").then(|| (u32_at(rec, 8).unwrap_or(0) as u64, u32_at(rec, 12).unwrap_or(0) as usize))
    })?;
    let table = read_at(file, name_offset, name_len.min(1 << 20))?;
    let count = u16_at(&table, 2)? as usize;
    let strings = u16_at(&table, 4)? as usize;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let at = 6 + i * 12;
        let platform = u16_at(&table, at)?;
        let language = u16_at(&table, at + 4)?;
        let name_id = u16_at(&table, at + 6)?;
        let len = u16_at(&table, at + 8)? as usize;
        let off = u16_at(&table, at + 10)? as usize;
        if name_id != 1 && name_id != 16 {
            continue;
        }
        let english = (platform == 3 && language == 0x0409) || (platform == 1 && language == 0) || platform == 0;
        let rank = match (name_id, english) {
            (1, true) => 0,
            (16, true) => 1,
            (1, false) => 2,
            _ => 3,
        };
        if best.as_ref().is_some_and(|(r, _)| *r <= rank) {
            continue;
        }
        let Some(raw) = table.get(strings + off..strings + off + len) else { continue };
        if let Some(name) = decode_name(platform, raw) {
            best = Some((rank, name));
        }
    }
    best.map(|(_, name)| name)
}

fn families(path: &Path) -> Vec<String> {
    let Ok(mut file) = File::open(path) else { return Vec::new() };
    let Some(head) = read_at(&mut file, 0, 12) else { return Vec::new() };
    if &head[0..4] == b"ttcf" {
        let count = u32_at(&head, 8).unwrap_or(0).min(64) as usize;
        let Some(offsets) = read_at(&mut file, 12, count * 4) else { return Vec::new() };
        return (0..count).filter_map(|i| u32_at(&offsets, i * 4)).filter_map(|o| family_at(&mut file, o as u64)).collect();
    }
    family_at(&mut file, 0).into_iter().collect()
}

fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts", "/System/Library/AssetsV2"].map(PathBuf::from));
        if let Some(h) = &home {
            dirs.push(h.join("Library/Fonts"));
        }
    } else if cfg!(target_os = "windows") {
        if let Some(w) = std::env::var_os("WINDIR") {
            dirs.push(PathBuf::from(w).join("Fonts"));
        }
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(l).join("Microsoft/Windows/Fonts"));
        }
    } else {
        dirs.extend(["/usr/share/fonts", "/usr/local/share/fonts"].map(PathBuf::from));
        if let Some(h) = &home {
            dirs.push(h.join(".local/share/fonts"));
            dirs.push(h.join(".fonts"));
        }
    }
    dirs
}

fn walk(dir: &Path, depth: usize, out: &mut BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if depth < 6 {
                walk(&path, depth + 1, out);
            }
            continue;
        }
        let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") {
            out.extend(families(&path));
        }
    }
}

pub fn system_families() -> Vec<String> {
    let mut found = BTreeSet::new();
    for dir in font_dirs() {
        walk(&dir, 0, &mut found);
    }
    let mut list: Vec<String> = found.into_iter().collect();
    list.sort_by_key(|n| n.to_lowercase());
    list
}

#[tauri::command]
pub async fn list_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_families).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_installed_families() {
        let list = system_families();
        if cfg!(target_os = "macos") {
            assert!(list.iter().any(|n| n == "Helvetica" || n == "Helvetica Neue"), "{list:?}");
        }
    }
}
