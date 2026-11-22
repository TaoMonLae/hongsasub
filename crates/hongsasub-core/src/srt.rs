use crate::document::{Event, EventKind, SubtitleDocument, SubtitleFormat};
use crate::error::{CoreError, Result};
use crate::time;

pub fn parse(input: &str) -> Result<SubtitleDocument> {
    let mut doc = SubtitleDocument::empty_ass();
    doc.format = SubtitleFormat::Srt;
    doc.bom = false;

    let text = input.trim_start_matches('\u{FEFF}').replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    let mut stray = false;
    while i < lines.len() {
        if lines[i].trim().is_empty() {
            i += 1;
            continue;
        }
        let found = [i, i + 1].into_iter().find_map(|at| lines.get(at)?.split_once("-->").map(|(a, b)| (at, a, b)));
        let Some((timing_line, a, b)) = found else {
            stray = true;
            i += 1;
            continue;
        };
        let start = time::parse_srt(a).map_err(|_| CoreError::Parse {
            line: timing_line + 1,
            message: format!("invalid time `{}`", a.trim()),
        })?;
        let end_token = b.split_whitespace().next().unwrap_or("");
        let end = time::parse_srt(end_token).map_err(|_| CoreError::Parse {
            line: timing_line + 1,
            message: format!("invalid time `{end_token}`"),
        })?;
        let mut body = Vec::new();
        let mut j = timing_line + 1;
        while j < lines.len() && !lines[j].trim().is_empty() {
            body.push(lines[j].trim_end());
            j += 1;
        }
        let mut event = Event::new(start, end, body.join("\\N"));
        event.kind = EventKind::Dialogue;
        doc.events.push(event);
        i = j;
    }
    if doc.events.is_empty() && stray {
        return Err(CoreError::Unsupported("no SRT cues found".into()));
    }
    Ok(doc)
}

pub fn write(doc: &SubtitleDocument) -> String {
    let mut out = String::new();
    let mut n = 0;
    for event in doc.events.iter().filter(|e| e.kind == EventKind::Dialogue) {
        let mut body = srt_text(&event.text);
        if body.trim().is_empty() {
            continue;
        }
        if let Some(an) = crate::tags::alignment(&event.text).filter(|&a| a != 2) {
            body = format!("{{\\an{an}}}{body}");
        }
        n += 1;
        out.push_str(&n.to_string());
        out.push('\n');
        out.push_str(&time::format_srt(event.start));
        out.push_str(" --> ");
        out.push_str(&time::format_srt(event.end));
        out.push('\n');
        out.push_str(&body);
        out.push_str("\n\n");
    }
    out
}

fn srt_text(text: &str) -> String {
    crate::tags::ass_to_html(text).replace("\\N", "\n").replace("\\n", "\n").replace("\\h", "\u{00A0}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "1\n00:00:01,000 --> 00:00:03,500\nHello there.\nSecond line\n\n2\n00:00:04,000 --> 00:00:05,250\n<i>Run!</i>\n\n";

    #[test]
    fn round_trip() {
        let doc = parse(SAMPLE).unwrap();
        assert_eq!(doc.events.len(), 2);
        assert_eq!(doc.events[0].text, "Hello there.\\NSecond line");
        assert_eq!(doc.events[1].start, 4000);
        assert_eq!(write(&doc), SAMPLE);
    }

    #[test]
    fn tolerates_missing_index_and_crlf() {
        let doc = parse("00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\n").unwrap();
        assert_eq!(doc.events.len(), 1);
        assert_eq!(doc.events[0].text, "Hi");
    }

    #[test]
    fn strips_ass_tags_on_export() {
        let mut doc = parse(SAMPLE).unwrap();
        doc.events[0].text = "{\\an8\\fscx120}Top\\Nline".into();
        assert!(write(&doc).contains("\n{\\an8}Top\nline\n"));
        doc.events[0].text = "{\\an2}Bottom".into();
        assert!(write(&doc).contains("\nBottom\n"));
    }

    #[test]
    fn skips_stray_lines_and_rejects_files_without_cues() {
        let doc = parse("1\n00:00:01,000 --> 00:00:02,000\nHi\n\nDownloaded from\nexample.com\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n").unwrap();
        assert_eq!(doc.events.len(), 2);
        assert_eq!(doc.events[1].text, "Bye");
        assert!(parse("just some\nnotes\n").is_err());
        assert!(parse("").unwrap().events.is_empty());
    }

    #[test]
    fn keeps_text_after_an_unclosed_brace() {
        let mut doc = parse(SAMPLE).unwrap();
        doc.events[0].text = "Hello {world".into();
        assert!(write(&doc).contains("\nHello {world\n"));
    }

    #[test]
    fn skips_empty_cues_and_renumbers() {
        let mut doc = parse(SAMPLE).unwrap();
        doc.events[0].text = "{\\an8}".into();
        let out = write(&doc);
        assert!(out.starts_with("1\n00:00:04,000"));
        assert!(!out.contains("\n2\n"));
    }
}
