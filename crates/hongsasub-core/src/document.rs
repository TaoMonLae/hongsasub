use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleFormat {
    Ass,
    Ssa,
    Srt,
}

impl SubtitleFormat {
    pub fn from_path(path: &str) -> Option<Self> {
        let lower = path.to_lowercase();
        if lower.ends_with(".ass") {
            Some(Self::Ass)
        } else if lower.ends_with(".ssa") {
            Some(Self::Ssa)
        } else if lower.ends_with(".srt") {
            Some(Self::Srt)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Dialogue,
    Comment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LineStatus {
    #[default]
    Untranslated,
    Draft,
    Confirmed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub name: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub kind: EventKind,
    pub layer: i32,
    pub start: i64,
    pub end: i64,
    pub style: String,
    pub actor: String,
    pub margin_l: String,
    pub margin_r: String,
    pub margin_v: String,
    pub effect: String,
    pub text: String,
    #[serde(default)]
    pub extra: BTreeMap<String, String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub status: LineStatus,
}

impl Event {
    pub fn new(start: i64, end: i64, text: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            kind: EventKind::Dialogue,
            layer: 0,
            start,
            end,
            style: "Default".into(),
            actor: String::new(),
            margin_l: "0".into(),
            margin_r: "0".into(),
            margin_v: "0".into(),
            effect: String::new(),
            text: text.into(),
            extra: BTreeMap::new(),
            source: String::new(),
            status: LineStatus::Untranslated,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "index")]
pub enum Section {
    ScriptInfo,
    Styles,
    Events,
    Raw(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSection {
    pub header: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleDocument {
    pub format: SubtitleFormat,
    pub bom: bool,
    pub script_info: Vec<String>,
    pub styles_header: String,
    pub style_format: Vec<String>,
    pub styles: Vec<Style>,
    pub event_format: Vec<String>,
    pub events: Vec<Event>,
    pub raw_sections: Vec<RawSection>,
    pub order: Vec<Section>,
}

pub const ASS_STYLE_FORMAT: [&str; 23] = [
    "Name", "Fontname", "Fontsize", "PrimaryColour", "SecondaryColour", "OutlineColour", "BackColour", "Bold",
    "Italic", "Underline", "StrikeOut", "ScaleX", "ScaleY", "Spacing", "Angle", "BorderStyle", "Outline",
    "Shadow", "Alignment", "MarginL", "MarginR", "MarginV", "Encoding",
];

pub const ASS_EVENT_FORMAT: [&str; 10] = [
    "Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text",
];

impl SubtitleDocument {
    pub fn empty_ass() -> Self {
        Self {
            format: SubtitleFormat::Ass,
            bom: true,
            script_info: vec![
                "ScriptType: v4.00+".into(),
                "WrapStyle: 0".into(),
                "ScaledBorderAndShadow: yes".into(),
                "PlayResX: 1920".into(),
                "PlayResY: 1080".into(),
            ],
            styles_header: "[V4+ Styles]".into(),
            style_format: ASS_STYLE_FORMAT.iter().map(|s| s.to_string()).collect(),
            styles: vec![default_style()],
            event_format: ASS_EVENT_FORMAT.iter().map(|s| s.to_string()).collect(),
            events: Vec::new(),
            raw_sections: Vec::new(),
            order: vec![Section::ScriptInfo, Section::Styles, Section::Events],
        }
    }

    pub fn ensure_ass_structure(&mut self) {
        if self.style_format.is_empty() {
            self.style_format = ASS_STYLE_FORMAT.iter().map(|s| s.to_string()).collect();
            self.styles_header = "[V4+ Styles]".into();
        }
        if self.styles.is_empty() {
            self.styles.push(default_style());
        }
        if self.event_format.is_empty() {
            self.event_format = ASS_EVENT_FORMAT.iter().map(|s| s.to_string()).collect();
        }
        if self.script_info.is_empty() {
            self.script_info = Self::empty_ass().script_info;
        }
        for section in [Section::ScriptInfo, Section::Styles, Section::Events] {
            if !self.order.contains(&section) {
                self.order.push(section);
            }
        }
    }

    pub fn sort_by_time(&mut self) {
        self.events.sort_by_key(|e| (e.start, e.end));
    }
}

pub fn default_style() -> Style {
    let values = [
        "Default", "Noto Sans Myanmar", "64", "&H00FFFFFF", "&H000000FF", "&H00000000", "&H80000000", "0", "0", "0",
        "0", "100", "100", "0", "0", "1", "3", "1", "2", "60", "60", "48", "1",
    ];
    Style {
        name: "Default".into(),
        values: values.iter().map(|s| s.to_string()).collect(),
    }
}
