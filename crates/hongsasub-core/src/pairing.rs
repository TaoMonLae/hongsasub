use serde::{Deserialize, Serialize};

use crate::document::{EventKind, SubtitleDocument};
use crate::normalize::strip_tags;
use crate::tm::CommitRequest;

const LOW_OVERLAP: f64 = 0.8;
const LONG_MS: i64 = 7000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PairFlag {
    Merged,
    Split,
    LowOverlap,
    Numbers,
    Untranslated,
    Long,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairPreview {
    pub start: i64,
    pub end: i64,
    pub source: String,
    pub target: String,
    pub prev: String,
    pub next: String,
    pub overlap: f64,
    pub flags: Vec<PairFlag>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingPreview {
    pub pairs: Vec<PairPreview>,
    pub unmatched_sources: usize,
    pub unmatched_targets: usize,
}

struct Line {
    start: i64,
    end: i64,
    text: String,
}

fn dialogue(doc: &SubtitleDocument) -> Vec<Line> {
    let mut lines: Vec<Line> = doc
        .events
        .iter()
        .filter(|e| e.kind == EventKind::Dialogue && !strip_tags(&e.text).trim().is_empty())
        .map(|e| Line { start: e.start, end: e.end, text: e.text.clone() })
        .collect();
    lines.sort_by_key(|l| (l.start, l.end));
    lines
}

fn overlap_ratio(a: &Line, b: &Line) -> f64 {
    let overlap = (a.end.min(b.end) - a.start.max(b.start)).max(0) as f64;
    let shortest = (a.end - a.start).min(b.end - b.start).max(1) as f64;
    overlap / shortest
}

fn numbers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut run = String::new();
    for ch in text.chars() {
        let digit = match ch {
            '0'..='9' => Some(ch),
            '\u{1040}'..='\u{1049}' => char::from_digit(ch as u32 - 0x1040, 10),
            _ => None,
        };
        match digit {
            Some(d) => run.push(d),
            None if (ch == ',' || ch == '.') && !run.is_empty() => {}
            None => {
                if !run.is_empty() {
                    out.push(std::mem::take(&mut run));
                }
            }
        }
    }
    if !run.is_empty() {
        out.push(run);
    }
    out.sort();
    out
}

fn same_text(a: &str, b: &str) -> bool {
    let a: String = strip_tags(a).split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let b: String = strip_tags(b).split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    !a.is_empty() && a == b
}

pub fn preview_documents(source: &SubtitleDocument, target: &SubtitleDocument) -> PairingPreview {
    let sources = dialogue(source);
    let targets = dialogue(target);
    let mut matched: Vec<(usize, usize, f64, Vec<usize>)> = Vec::new();
    let mut unmatched_targets = 0usize;
    let mut cursor = 0usize;
    for (ti, t) in targets.iter().enumerate() {
        while cursor < sources.len() && sources[cursor].end <= t.start {
            cursor += 1;
        }
        let mut best: Option<(usize, f64)> = None;
        let mut covered: Vec<usize> = Vec::new();
        let mut i = cursor;
        while i < sources.len() && sources[i].start < t.end {
            let ratio = overlap_ratio(&sources[i], t);
            if ratio >= 0.5 {
                covered.push(i);
                if best.map_or(true, |(_, r)| ratio > r) {
                    best = Some((i, ratio));
                }
            }
            i += 1;
        }
        match best {
            Some((si, ratio)) => matched.push((ti, si, ratio, covered)),
            None => unmatched_targets += 1,
        }
    }
    let mut uses = vec![0usize; sources.len()];
    for (_, _, _, covered) in &matched {
        for &si in covered {
            uses[si] += 1;
        }
    }
    let unmatched_sources = uses.iter().filter(|&&n| n == 0).count();
    let pairs = matched
        .into_iter()
        .map(|(ti, si, ratio, covered)| {
            let t = &targets[ti];
            let first = covered.first().copied().unwrap_or(si);
            let last = covered.last().copied().unwrap_or(si);
            let source = covered.iter().map(|&i| sources[i].text.trim()).collect::<Vec<_>>().join(" ");
            let mut flags = Vec::new();
            if covered.len() > 1 {
                flags.push(PairFlag::Merged);
            }
            if covered.iter().any(|&i| uses[i] > 1) {
                flags.push(PairFlag::Split);
            }
            if ratio < LOW_OVERLAP {
                flags.push(PairFlag::LowOverlap);
            }
            if numbers(&strip_tags(&source)) != numbers(&strip_tags(&t.text)) {
                flags.push(PairFlag::Numbers);
            }
            if same_text(&source, &t.text) {
                flags.push(PairFlag::Untranslated);
            }
            if t.end - t.start > LONG_MS {
                flags.push(PairFlag::Long);
            }
            PairPreview {
                start: t.start,
                end: t.end,
                source,
                target: t.text.clone(),
                prev: if first > 0 { sources[first - 1].text.clone() } else { String::new() },
                next: sources.get(last + 1).map(|l| l.text.clone()).unwrap_or_default(),
                overlap: ratio,
                flags,
            }
        })
        .collect();
    PairingPreview { pairs, unmatched_sources, unmatched_targets }
}

pub fn pair_documents(source: &SubtitleDocument, target: &SubtitleDocument, work: &str) -> Vec<CommitRequest> {
    preview_documents(source, target)
        .pairs
        .into_iter()
        .map(|p| CommitRequest { source: p.source, target: p.target, prev: p.prev, next: p.next, work: work.to_string() })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::srt;

    #[test]
    fn pairs_by_time_overlap() {
        let en = srt::parse("1\n00:00:01,000 --> 00:00:03,000\nHello.\n\n2\n00:00:04,000 --> 00:00:06,000\nGoodbye.\n\n3\n00:00:10,000 --> 00:00:11,000\nUnmatched.\n\n").unwrap();
        let mon = srt::parse("1\n00:00:01,100 --> 00:00:02,900\nM1\n\n2\n00:00:04,200 --> 00:00:06,300\nM2\n\n3\n00:00:20,000 --> 00:00:21,000\nM3\n\n").unwrap();
        let pairs = pair_documents(&en, &mon, "Film");
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].source, "Hello.");
        assert_eq!(pairs[0].target, "M1");
        assert_eq!(pairs[1].prev, "Hello.");
        assert_eq!(pairs[1].next, "Unmatched.");
    }

    #[test]
    fn flags_merged_split_numbers_and_untranslated() {
        let en = srt::parse("1\n00:00:01,000 --> 00:00:02,000\nWait.\n\n2\n00:00:02,100 --> 00:00:03,000\nFor me.\n\n3\n00:00:05,000 --> 00:00:06,000\nIt costs 4264 yen.\n\n4\n00:00:08,000 --> 00:00:09,000\nMitsuha!\n\n").unwrap();
        let mon = srt::parse("1\n00:00:01,000 --> 00:00:03,000\nM1\n\n2\n00:00:05,000 --> 00:00:06,000\nM \u{1041}\u{1042}\n\n3\n00:00:08,000 --> 00:00:09,000\nMitsuha!\n\n").unwrap();
        let preview = preview_documents(&en, &mon);
        assert_eq!(preview.pairs.len(), 3);
        assert!(preview.pairs[0].flags.contains(&PairFlag::Merged));
        assert_eq!(preview.pairs[0].source, "Wait. For me.");
        assert_eq!(preview.pairs[1].prev, "For me.");
        assert!(preview.pairs[1].flags.contains(&PairFlag::Numbers));
        assert!(preview.pairs[2].flags.contains(&PairFlag::Untranslated));
        assert_eq!(preview.unmatched_sources, 0);
    }

    #[test]
    fn myanmar_digits_match_ascii() {
        assert_eq!(numbers("\u{1042}\u{1040}"), numbers("20"));
    }
}
