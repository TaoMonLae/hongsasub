use std::collections::BTreeMap;

use uuid::Uuid;

use crate::document::{
    Event, EventKind, LineStatus, RawSection, Section, Style, SubtitleDocument, SubtitleFormat, ASS_EVENT_FORMAT,
};
use crate::error::{CoreError, Result};
use crate::time;

pub fn decode(bytes: &[u8]) -> (String, bool) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return (String::from_utf8_lossy(rest).into_owned(), true);
    }
    if let Some((enc, _)) = encoding_rs::Encoding::for_bom(bytes) {
        let (text, _, _) = enc.decode(bytes);
        return (text.trim_start_matches('\u{FEFF}').to_string(), true);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), false),
        Err(_) => {
            let (text, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
            (text.into_owned(), false)
        }
    }
}

enum Current {
    None,
    ScriptInfo,
    Styles,
    Events,
    Raw(usize),
}

pub fn parse(input: &str) -> Result<SubtitleDocument> {
    let mut doc = SubtitleDocument {
        format: SubtitleFormat::Ass,
        bom: false,
        script_info: Vec::new(),
        styles_header: "[V4+ Styles]".into(),
        style_format: Vec::new(),
        styles: Vec::new(),
        event_format: Vec::new(),
        events: Vec::new(),
        raw_sections: Vec::new(),
        order: Vec::new(),
    };
    let mut current = Current::None;
    let mut saw_header = false;

    for (index, raw_line) in input.trim_start_matches('\u{FEFF}').lines().enumerate() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            saw_header = true;
            let lower = trimmed.to_lowercase();
            current = match lower.as_str() {
                "[script info]" => {
                    doc.order.push(Section::ScriptInfo);
                    Current::ScriptInfo
                }
                "[v4+ styles]" | "[v4 styles]" | "[v4 styles+]" => {
                    doc.styles_header = trimmed.to_string();
                    if lower == "[v4 styles]" {
                        doc.format = SubtitleFormat::Ssa;
                    }
                    doc.order.push(Section::Styles);
                    Current::Styles
                }
                "[events]" => {
                    doc.order.push(Section::Events);
                    Current::Events
                }
                _ => {
                    doc.raw_sections.push(RawSection { header: trimmed.to_string(), lines: Vec::new() });
                    let idx = doc.raw_sections.len() - 1;
                    doc.order.push(Section::Raw(idx));
                    Current::Raw(idx)
                }
            };
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        match current {
            Current::None => {}
            Current::ScriptInfo => doc.script_info.push(line.to_string()),
            Current::Styles => {
                if let Some(rest) = strip_key(line, "Format") {
                    doc.style_format = split_format(rest);
                } else if let Some(rest) = strip_key(line, "Style") {
                    let n = doc.style_format.len().max(1);
                    let values: Vec<String> = rest.splitn(n, ',').map(|v| v.trim().to_string()).collect();
                    let name = values.first().cloned().unwrap_or_default();
                    doc.styles.push(Style { name, values });
                }
            }
            Current::Events => {
                if let Some(rest) = strip_key(line, "Format") {
                    doc.event_format = split_format(rest);
                } else if let Some(rest) = strip_key(line, "Dialogue") {
                    doc.events.push(parse_event(&mut doc.event_format, rest, EventKind::Dialogue, index + 1)?);
                } else if let Some(rest) = strip_key(line, "Comment") {
                    doc.events.push(parse_event(&mut doc.event_format, rest, EventKind::Comment, index + 1)?);
                }
            }
            Current::Raw(idx) => doc.raw_sections[idx].lines.push(line.to_string()),
        }
    }

    if !saw_header {
        return Err(CoreError::Unsupported("no ASS sections found".into()));
    }
    if doc
        .script_info
        .iter()
        .any(|l| l.to_lowercase().replace(' ', "").starts_with("scripttype:v4.00") && !l.contains('+'))
    {
        doc.format = SubtitleFormat::Ssa;
    }
    Ok(doc)
}

fn strip_key<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (k, rest) = line.split_once(':')?;
    if k.trim().eq_ignore_ascii_case(key) {
        Some(rest.strip_prefix(' ').unwrap_or(rest))
    } else {
        None
    }
}

fn split_format(rest: &str) -> Vec<String> {
    rest.split(',').map(|s| s.trim().to_string()).collect()
}

fn parse_event(format: &mut Vec<String>, rest: &str, kind: EventKind, line: usize) -> Result<Event> {
    if format.is_empty() {
        *format = ASS_EVENT_FORMAT.iter().map(|s| s.to_string()).collect();
    }
    let values: Vec<&str> = rest.splitn(format.len(), ',').collect();
    if values.len() < format.len() {
        return Err(CoreError::Parse { line, message: "event has fewer fields than its Format".into() });
    }
    let mut event = Event::new(0, 0, "");
    event.kind = kind;
    event.id = Uuid::new_v4().to_string();
    event.extra = BTreeMap::new();
    for (column, value) in format.iter().zip(values) {
        let key = column.to_lowercase();
        let v = if key == "text" { value.to_string() } else { value.trim().to_string() };
        match key.as_str() {
            "layer" => event.layer = v.parse().unwrap_or(0),
            "start" => event.start = time::parse_ass(&v).map_err(|_| bad_time(line, &v))?,
            "end" => event.end = time::parse_ass(&v).map_err(|_| bad_time(line, &v))?,
            "style" => event.style = v,
            "name" | "actor" => event.actor = v,
            "marginl" => event.margin_l = v,
            "marginr" => event.margin_r = v,
            "marginv" => event.margin_v = v,
            "effect" => event.effect = v,
            "text" => event.text = v,
            _ => {
                event.extra.insert(column.clone(), v);
            }
        }
    }
    event.status = LineStatus::Untranslated;
    Ok(event)
}

fn bad_time(line: usize, value: &str) -> CoreError {
    CoreError::Parse { line, message: format!("invalid time `{value}`") }
}

pub fn write(doc: &SubtitleDocument) -> String {
    let mut out = String::new();
    if doc.bom {
        out.push('\u{FEFF}');
    }
    let mut first = true;
    for section in &doc.order {
        if !first {
            out.push('\n');
        }
        first = false;
        match section {
            Section::ScriptInfo => {
                out.push_str("[Script Info]\n");
                for line in &doc.script_info {
                    out.push_str(line);
                    out.push('\n');
                }
            }
            Section::Styles => {
                out.push_str(&doc.styles_header);
                out.push('\n');
                out.push_str("Format: ");
                out.push_str(&doc.style_format.join(", "));
                out.push('\n');
                for style in &doc.styles {
                    out.push_str("Style: ");
                    out.push_str(&style.values.join(","));
                    out.push('\n');
                }
            }
            Section::Events => {
                out.push_str("[Events]\n");
                out.push_str("Format: ");
                out.push_str(&doc.event_format.join(", "));
                out.push('\n');
                for event in &doc.events {
                    out.push_str(match event.kind {
                        EventKind::Dialogue => "Dialogue: ",
                        EventKind::Comment => "Comment: ",
                    });
                    let cells: Vec<String> = doc.event_format.iter().map(|c| event_cell(event, c)).collect();
                    out.push_str(&cells.join(","));
                    out.push('\n');
                }
            }
            Section::Raw(idx) => {
                if let Some(raw) = doc.raw_sections.get(*idx) {
                    out.push_str(&raw.header);
                    out.push('\n');
                    for line in &raw.lines {
                        out.push_str(line);
                        out.push('\n');
                    }
                }
            }
        }
    }
    out
}

fn event_cell(event: &Event, column: &str) -> String {
    match column.to_lowercase().as_str() {
        "layer" => event.layer.to_string(),
        "start" => time::format_ass(event.start),
        "end" => time::format_ass(event.end),
        "style" => event.style.clone(),
        "name" | "actor" => event.actor.clone(),
        "marginl" => event.margin_l.clone(),
        "marginr" => event.margin_r.clone(),
        "marginv" => event.margin_v.clone(),
        "effect" => event.effect.clone(),
        "text" => event.text.replace("\r\n", "\\N").replace('\n', "\\N"),
        _ => event.extra.get(column).cloned().unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "[Script Info]\n; Script generated by Aegisub\nTitle: Test\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[Aegisub Project Garbage]\nVideo File: movie.mkv\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,Ana,0,0,0,,{\\i1}Hello,{\\i0} world\\Nsecond line\nComment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,note to self\n";

    #[test]
    fn round_trip_is_lossless() {
        let doc = parse(SAMPLE).unwrap();
        assert_eq!(doc.events.len(), 2);
        assert_eq!(doc.events[0].text, "{\\i1}Hello,{\\i0} world\\Nsecond line");
        assert_eq!(doc.events[0].actor, "Ana");
        assert_eq!(doc.events[1].kind, EventKind::Comment);
        assert_eq!(doc.raw_sections[0].lines, vec!["Video File: movie.mkv"]);
        assert_eq!(write(&doc), SAMPLE);
    }

    #[test]
    fn keeps_unknown_columns() {
        let input = "[Script Info]\nScriptType: v4.00\n\n[V4 Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0000,0000,0000,,Hi\n";
        let doc = parse(input).unwrap();
        assert_eq!(doc.format, SubtitleFormat::Ssa);
        assert_eq!(doc.events[0].extra.get("Marked").map(String::as_str), Some("Marked=0"));
        assert_eq!(write(&doc), input);
    }

    #[test]
    fn decodes_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("[Events]".as_bytes());
        let (text, bom) = decode(&bytes);
        assert!(bom);
        assert_eq!(text, "[Events]");
    }
}
