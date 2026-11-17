use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ass;
use crate::document::{EventKind, LineStatus, SubtitleDocument, SubtitleFormat};
use crate::error::{CoreError, Result};
use crate::normalize::{leading_tags, strip_tags};
use crate::srt;
use crate::tags::html_to_ass;
use crate::tm::now_ms;

pub const PROJECT_EXTENSION: &str = "hongsa";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenMode {
    Translate,
    Edit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub work: String,
    pub source_path: Option<String>,
    pub video_path: Option<String>,
    pub document: SubtitleDocument,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn read_subtitle(path: impl AsRef<Path>) -> Result<SubtitleDocument> {
    let path = path.as_ref();
    let bytes = std::fs::read(path)?;
    let (text, bom) = ass::decode(&bytes);
    let name = path.to_string_lossy().to_string();
    let format = SubtitleFormat::from_path(&name).or_else(|| sniff(&text));
    let mut doc = match format {
        Some(SubtitleFormat::Srt) => srt::parse(&text)?,
        Some(SubtitleFormat::Ass) | Some(SubtitleFormat::Ssa) => ass::parse(&text)?,
        None => return Err(CoreError::Unsupported(name)),
    };
    doc.bom = bom || doc.format != SubtitleFormat::Srt;
    Ok(doc)
}

fn sniff(text: &str) -> Option<SubtitleFormat> {
    let head = text.trim_start_matches('\u{FEFF}').trim_start();
    if head.starts_with('[') {
        Some(SubtitleFormat::Ass)
    } else if text.contains("-->") {
        Some(SubtitleFormat::Srt)
    } else {
        None
    }
}

fn file_stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Untitled".into())
}

impl Project {
    pub fn from_document(mut document: SubtitleDocument, source_path: Option<&Path>, mode: OpenMode) -> Self {
        for event in &mut document.events {
            match mode {
                OpenMode::Translate => {
                    event.source = std::mem::take(&mut event.text);
                    event.status = LineStatus::Untranslated;
                    if event.kind == EventKind::Comment {
                        event.text = event.source.clone();
                    }
                }
                OpenMode::Edit => {
                    event.status = if strip_tags(&event.text).trim().is_empty() {
                        LineStatus::Untranslated
                    } else {
                        LineStatus::Draft
                    };
                }
            }
        }
        let title = source_path.map(file_stem).unwrap_or_else(|| "Untitled".into());
        let now = now_ms();
        Self {
            version: 1,
            id: Uuid::new_v4().to_string(),
            work: title.clone(),
            title,
            source_path: source_path.map(|p| p.to_string_lossy().to_string()),
            video_path: None,
            document,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn open_subtitle(path: impl AsRef<Path>, mode: OpenMode) -> Result<Self> {
        let path = path.as_ref();
        let doc = read_subtitle(path)?;
        Ok(Self::from_document(doc, Some(path), mode))
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let bytes = std::fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn save(&mut self, path: impl AsRef<Path>) -> Result<()> {
        self.updated_at = now_ms();
        let path = path.as_ref();
        let tmp = path.with_extension(format!("{PROJECT_EXTENSION}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn export(&self, format: SubtitleFormat, fallback_to_source: bool) -> String {
        let mut doc = self.document.clone();
        for event in &mut doc.events {
            if event.kind == EventKind::Comment {
                continue;
            }
            let has_text = !strip_tags(&event.text).trim().is_empty();
            if !has_text {
                if fallback_to_source && !event.source.is_empty() {
                    event.text = event.source.clone();
                }
                continue;
            }
            let tags = leading_tags(&event.source);
            if tags.is_empty() {
                continue;
            }
            if !event.text.starts_with('{') {
                event.text = format!("{tags}{}", event.text);
            } else if crate::tags::alignment(&event.text).is_none() && !event.text.contains("\\pos(") {
                if let Some(an) = crate::tags::alignment(&tags) {
                    event.text = format!("{{\\an{an}}}{}", event.text);
                }
            }
        }
        match format {
            SubtitleFormat::Srt => srt::write(&doc),
            SubtitleFormat::Ass | SubtitleFormat::Ssa => {
                doc.ensure_ass_structure();
                if doc.format == SubtitleFormat::Srt {
                    doc.format = SubtitleFormat::Ass;
                }
                doc.bom = true;
                for event in &mut doc.events {
                    event.text = html_to_ass(&event.text);
                }
                ass::write(&doc)
            }
        }
    }

    pub fn export_to(&self, path: impl AsRef<Path>, fallback_to_source: bool) -> Result<()> {
        let path = path.as_ref();
        let name = path.to_string_lossy().to_string();
        let format = SubtitleFormat::from_path(&name).ok_or_else(|| CoreError::Unsupported(name.clone()))?;
        let tmp = path.with_file_name(format!(".{}.tmp", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
        std::fs::write(&tmp, self.export(format, fallback_to_source))?;
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(())
    }

    pub fn progress(&self) -> (usize, usize) {
        let dialogue: Vec<_> = self.document.events.iter().filter(|e| e.kind == EventKind::Dialogue).collect();
        let done = dialogue.iter().filter(|e| e.status == LineStatus::Confirmed).count();
        (done, dialogue.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_mode_moves_text_to_source_and_exports_with_tags() {
        let doc = ass::parse("[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}Hello\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Untouched\n").unwrap();
        let mut project = Project::from_document(doc, None, OpenMode::Translate);
        assert_eq!(project.document.events[0].source, "{\\an8}Hello");
        assert!(project.document.events[0].text.is_empty());
        project.document.events[0].text = "MON".into();
        let out = project.export(SubtitleFormat::Ass, true);
        assert!(out.contains(",{\\an8}MON\n"));
        project.document.events[0].text = "{\\i1}MON{\\i0} rest".into();
        let out = project.export(SubtitleFormat::Ass, true);
        assert!(out.contains(",{\\an8}{\\i1}MON{\\i0} rest\n"));
        project.document.events[0].text = "{\\an2}MON".into();
        let out = project.export(SubtitleFormat::Ass, true);
        assert!(out.contains(",{\\an2}MON\n"));
        assert!(out.contains(",Untouched\n"));
        assert!(out.contains("[V4+ Styles]"));
        let srt_out = project.export(SubtitleFormat::Srt, false);
        assert!(srt_out.contains("MON"));
        assert!(!srt_out.contains("Untouched"));
    }

    #[test]
    fn saves_edits_back_to_srt_and_ass_with_formatting() {
        let dir = std::env::temp_dir().join(format!("hongsa-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let srt_path = dir.join("film.srt");
        std::fs::write(&srt_path, "1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i>\n\n2\n00:00:03,000 --> 00:00:04,000\nThere\n\n").unwrap();
        let mut project = Project::open_subtitle(&srt_path, OpenMode::Edit).unwrap();
        project.document.events[1].text = "{\\b1}Bold{\\b0} {\\c&H0000FF&}red{\\c}".into();
        project.export_to(&srt_path, false).unwrap();
        let srt = std::fs::read_to_string(&srt_path).unwrap();
        assert!(srt.contains("<i>Hi</i>"));
        assert!(srt.contains("<b>Bold</b> <font color=\"#FF0000\">red</font>"));
        let ass_path = dir.join("film.ass");
        project.export_to(&ass_path, false).unwrap();
        let reopened = Project::open_subtitle(&ass_path, OpenMode::Edit).unwrap();
        assert_eq!(reopened.document.events[0].text, "{\\i1}Hi{\\i0}");
        assert_eq!(reopened.document.events[1].text, "{\\b1}Bold{\\b0} {\\c&H0000FF&}red{\\c}");
        assert_eq!(reopened.document.styles.len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_and_load() {
        let dir = std::env::temp_dir().join(format!("hongsa-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("film.hongsa");
        let mut project = Project::from_document(SubtitleDocument::empty_ass(), None, OpenMode::Edit);
        project.save(&path).unwrap();
        let loaded = Project::load(&path).unwrap();
        assert_eq!(loaded.id, project.id);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
