use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

const MAX_WORD_SYLLABLES: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Misspelling {
    pub start: usize,
    pub len: usize,
    pub word: String,
}

#[derive(Debug, Default, Clone)]
pub struct SpellChecker {
    words: HashSet<String>,
}

fn is_letter(c: char) -> bool {
    matches!(c, '\u{1000}'..='\u{103F}' | '\u{104C}'..='\u{109F}' | '\u{A9E0}'..='\u{A9FF}' | '\u{AA60}'..='\u{AA7F}') && !is_digit(c)
}

fn is_digit(c: char) -> bool {
    matches!(c, '\u{1040}'..='\u{1049}' | '\u{1090}'..='\u{1099}')
}

fn starts_syllable(c: char) -> bool {
    let o = c as u32;
    (0x1000..=0x102A).contains(&o)
        || o == 0x103F
        || (0x104C..=0x104F).contains(&o)
        || (0x1050..=0x1055).contains(&o)
        || (0x105A..=0x105D).contains(&o)
        || matches!(o, 0x1061 | 0x1065 | 0x1066 | 0x108E)
        || (0x106E..=0x1070).contains(&o)
        || (0x1075..=0x1081).contains(&o)
        || (0xA9E0..=0xA9E4).contains(&o)
        || (0xA9E7..=0xA9EF).contains(&o)
        || (0xA9FA..=0xA9FE).contains(&o)
        || (0xAA60..=0xAA6F).contains(&o)
        || (0xAA71..=0xAA76).contains(&o)
        || (0xAA7A..=0xAA7A).contains(&o)
        || (0xAA7E..=0xAA7F).contains(&o)
}

pub fn syllables(run: &str) -> Vec<&str> {
    let chars: Vec<(usize, char)> = run.char_indices().collect();
    let mut cuts = vec![0usize];
    for (k, &(i, c)) in chars.iter().enumerate() {
        if k == 0 || !starts_syllable(c) {
            continue;
        }
        let prev = chars[k - 1].1;
        let next = chars.get(k + 1).map(|x| x.1);
        if prev == '\u{1039}' || next == Some('\u{103A}') {
            continue;
        }
        cuts.push(i);
    }
    cuts.push(run.len());
    cuts.windows(2).map(|w| &run[w[0]..w[1]]).filter(|s| !s.is_empty()).collect()
}

pub fn clean_entry(word: &str) -> Vec<String> {
    let trimmed = word
        .trim()
        .trim_end_matches(|c: char| c.is_ascii_digit() || is_digit(c) || c.is_whitespace())
        .trim_end_matches(['—', '–', '-'])
        .trim();
    trimmed
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '/' | '(' | ')' | '၊' | '။'))
        .map(str::trim)
        .filter(|p| !p.is_empty() && p.chars().all(is_letter))
        .map(str::to_string)
        .collect()
}

impl SpellChecker {
    pub fn new<I: IntoIterator<Item = String>>(entries: I) -> Self {
        let mut checker = Self::default();
        for e in entries {
            checker.add(&e);
        }
        checker
    }

    pub fn add(&mut self, word: &str) {
        for w in clean_entry(word) {
            self.words.insert(w);
        }
    }

    pub fn knows(&self, word: &str) -> bool {
        self.words.contains(word)
    }

    pub fn len(&self) -> usize {
        self.words.len()
    }

    pub fn is_empty(&self) -> bool {
        self.words.is_empty()
    }

    fn unknown_in_run(&self, run: &str) -> Vec<(usize, usize)> {
        let syl = syllables(run);
        let n = syl.len();
        let offsets: Vec<usize> = syl
            .iter()
            .scan(0usize, |at, s| {
                let start = *at;
                *at += s.len();
                Some(start)
            })
            .collect();
        const INF: usize = usize::MAX / 2;
        let mut best = vec![(INF, INF); n + 1];
        let mut back: Vec<Option<(usize, bool)>> = vec![None; n + 1];
        best[0] = (0, 0);
        for i in 0..n {
            if best[i].0 == INF {
                continue;
            }
            let (bad, pieces) = best[i];
            let skip = (bad + 1, pieces + 1);
            if skip < best[i + 1] {
                best[i + 1] = skip;
                back[i + 1] = Some((i, false));
            }
            let start = offsets[i];
            for j in i..n.min(i + MAX_WORD_SYLLABLES) {
                let end = offsets[j] + syl[j].len();
                if self.words.contains(&run[start..end]) {
                    let cand = (bad, pieces + 1);
                    if cand < best[j + 1] {
                        best[j + 1] = cand;
                        back[j + 1] = Some((i, true));
                    }
                }
            }
        }
        let mut spans = Vec::new();
        let mut k = n;
        let mut open: Option<usize> = None;
        while k > 0 {
            let Some((i, known)) = back[k] else { break };
            if known {
                if let Some(end) = open.take() {
                    spans.push((offsets[k], end));
                }
            } else if open.is_none() {
                open = Some(offsets[k - 1] + syl[k - 1].len());
            }
            k = i;
        }
        if let Some(end) = open {
            spans.push((0, end));
        }
        spans.reverse();
        spans
    }

    pub fn check(&self, text: &str) -> Vec<Misspelling> {
        let mut out = Vec::new();
        let mut depth_brace = 0usize;
        let mut depth_angle = 0usize;
        let mut run_start: Option<usize> = None;
        let flush = |from: Option<usize>, to: usize, out: &mut Vec<Misspelling>| {
            if let Some(s) = from {
                let run = &text[s..to];
                for (a, b) in self.unknown_in_run(run) {
                    let word = &run[a..b];
                    let start = text[..s + a].encode_utf16().count();
                    out.push(Misspelling { start, len: word.encode_utf16().count(), word: word.to_string() });
                }
            }
        };
        for (i, c) in text.char_indices() {
            match c {
                '{' => depth_brace += 1,
                '}' => depth_brace = depth_brace.saturating_sub(1),
                '<' => depth_angle += 1,
                '>' => depth_angle = depth_angle.saturating_sub(1),
                _ => {}
            }
            let letter = depth_brace == 0 && depth_angle == 0 && is_letter(c);
            if letter {
                if run_start.is_none() {
                    run_start = Some(i);
                }
            } else if run_start.is_some() {
                flush(run_start.take(), i, &mut out);
            }
        }
        flush(run_start.take(), text.len(), &mut out);
        out
    }

    pub fn learn_frequent<'a, I: IntoIterator<Item = &'a str>>(&mut self, texts: I, min_count: usize) -> usize {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for t in texts {
            let mut seen = HashSet::new();
            for m in self.check(t) {
                if seen.insert(m.word.clone()) {
                    *counts.entry(m.word).or_default() += 1;
                }
            }
        }
        let mut learned = 0;
        for (w, n) in counts {
            if n >= min_count && self.words.insert(w) {
                learned += 1;
            }
        }
        learned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checker() -> SpellChecker {
        SpellChecker::new(["ပ္ဍဲ", "မံၚ်", "ကေတ်", "အဲ", "ဂှ်", "သဥ္ဇာ", "ကၠေံ—၂", "ဆ္ဂး ဆ္ဂး"].map(String::from))
    }

    #[test]
    fn splits_syllables_with_stacks_and_asat() {
        assert_eq!(syllables("မံၚ်ပ္ဍဲ"), vec!["မံၚ်", "ပ္ဍဲ"]);
        assert_eq!(syllables("ကေတ်"), vec!["ကေတ်"]);
    }

    #[test]
    fn known_words_pass_and_typos_are_flagged() {
        let c = checker();
        assert!(c.check("မံၚ်ပ္ဍဲ အဲ").is_empty());
        assert!(c.check("သဥ္ဇာ ကၠေံ ဆ္ဂး").is_empty());
        let bad = c.check("ကေတ်တ် ဂှ်");
        assert_eq!(bad.len(), 1);
        assert_eq!(bad[0].word, "ကေတ်တ်");
    }

    #[test]
    fn skips_tags_latin_digits_and_reports_utf16_offsets() {
        let c = checker();
        let bad = c.check("{\\i1}Hi ၁၂ <b>ဖဖ</b> အဲ");
        assert_eq!(bad.len(), 1);
        assert_eq!(bad[0].word, "ဖဖ");
        assert_eq!(bad[0].start, "{\\i1}Hi ၁၂ <b>".encode_utf16().count());
        assert_eq!(bad[0].len, 2);
    }

    #[test]
    fn learns_words_used_often() {
        let mut c = checker();
        let texts = ["ယျ အဲ", "ယျ", "ဂှ် ယျ", "ဖဖ"];
        assert_eq!(c.learn_frequent(texts, 3), 1);
        assert!(c.knows("ယျ"));
        assert!(!c.knows("ဖဖ"));
    }
}
