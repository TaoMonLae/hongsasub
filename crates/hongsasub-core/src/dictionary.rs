use std::path::Path;

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::normalize::tokens;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictSense {
    pub lang: String,
    pub pos: String,
    pub text: String,
    pub example: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DictKind {
    #[default]
    Mon,
    English,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictEntry {
    pub id: i64,
    #[serde(default)]
    pub kind: DictKind,
    pub word: String,
    pub ipa: String,
    pub senses: Vec<DictSense>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictInfo {
    pub words: i64,
    pub source: String,
    pub revision: String,
    pub license: String,
    pub english_words: i64,
    pub extra_source: String,
    pub extra_license: String,
}

pub struct Dictionary {
    conn: Connection,
    english: bool,
}

const ENGLISH_TRIM: &[char] = &[' ', '.', ',', '!', '?', ';', ':', '"', '\'', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}'];
const PHRASES_SHOWN: i64 = 8;
const MON_BEFORE_PHRASES: usize = 6;
const REVERSE_SHOWN: usize = 10;

pub fn english_key(text: &str) -> String {
    text.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ").trim_matches(ENGLISH_TRIM).to_string()
}

fn ends_double(stem: &str) -> bool {
    let b = stem.as_bytes();
    b.len() >= 3 && b[b.len() - 1] == b[b.len() - 2] && !b"aeiouls".contains(&b[b.len() - 1])
}

pub fn english_forms(key: &str) -> Vec<String> {
    let mut forms = vec![key.to_string()];
    if key.contains(' ') || !key.is_ascii() || key.len() < 4 {
        return forms;
    }
    let mut candidates: Vec<String> = Vec::new();
    if let Some(stem) = key.strip_suffix("'s") {
        candidates.push(stem.to_string());
    }
    if let Some(stem) = key.strip_suffix("ies") {
        candidates.push(format!("{stem}y"));
    }
    if let Some(stem) = key.strip_suffix("es") {
        candidates.push(stem.to_string());
    }
    if key.ends_with('s') && !key.ends_with("ss") {
        candidates.push(key[..key.len() - 1].to_string());
    }
    if let Some(stem) = key.strip_suffix("ied") {
        candidates.push(format!("{stem}y"));
    }
    if let Some(stem) = key.strip_suffix("ed") {
        candidates.push(format!("{stem}e"));
        candidates.push(stem.to_string());
        if ends_double(stem) {
            candidates.push(stem[..stem.len() - 1].to_string());
        }
    }
    if let Some(stem) = key.strip_suffix("ing") {
        candidates.push(stem.to_string());
        candidates.push(format!("{stem}e"));
        if ends_double(stem) {
            candidates.push(stem[..stem.len() - 1].to_string());
        }
    }
    if let Some(stem) = key.strip_suffix("ily") {
        candidates.push(format!("{stem}y"));
    }
    if let Some(stem) = key.strip_suffix("ly") {
        candidates.push(stem.to_string());
    }
    for c in candidates {
        if c.len() >= 2 && !forms.contains(&c) {
            forms.push(c);
        }
    }
    forms
}

pub fn gloss_items(text: &str) -> Vec<&str> {
    text.split(['\u{104A}', '\u{104B}'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.chars().all(|c| ('\u{1040}'..='\u{1049}').contains(&c) || c.is_ascii_digit()))
        .collect()
}

fn is_burmese_script(c: char) -> bool {
    matches!(c, '\u{1000}'..='\u{109F}' | '\u{A9E0}'..='\u{A9FF}' | '\u{AA60}'..='\u{AA7F}')
}

fn lang_rank(lang: &str) -> u8 {
    match lang {
        "eng" => 0,
        "mya" => 1,
        "tha" => 2,
        _ => 3,
    }
}

fn contains_words(text: &str, wanted: &[String]) -> bool {
    let have = tokens(&text.to_lowercase());
    !wanted.is_empty() && have.windows(wanted.len()).any(|w| w == wanted)
}

fn simplify(text: &str) -> String {
    text.trim()
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c.is_whitespace())
        .trim_end_matches(|c: char| c == '.' || c == '!' || c == '?' || c.is_whitespace())
        .to_lowercase()
}

impl Dictionary {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
        Ok(Self::from_connection(conn))
    }

    pub fn from_connection(conn: Connection) -> Self {
        let english = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('en_word', 'en_sense')", [], |r| r.get::<_, i64>(0))
            .map(|n| n == 2)
            .unwrap_or(false);
        Self { conn, english }
    }

    pub fn has_english(&self) -> bool {
        self.english
    }

    pub fn all_words(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT word FROM word")?;
        let words = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(words)
    }

    pub fn info(&self) -> Result<DictInfo> {
        let meta = |key: &str| -> String {
            self.conn
                .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .unwrap_or_default()
        };
        let words = self.conn.query_row("SELECT COUNT(*) FROM word", [], |r| r.get(0))?;
        let english_words = if self.english { self.conn.query_row("SELECT COUNT(*) FROM en_word", [], |r| r.get(0))? } else { 0 };
        Ok(DictInfo {
            words,
            source: meta("source"),
            revision: meta("revision"),
            license: meta("license"),
            english_words,
            extra_source: meta("engmon_source"),
            extra_license: meta("engmon_license"),
        })
    }

    pub fn lookup(&self, query: &str, limit: usize) -> Result<Vec<DictEntry>> {
        let q = query.trim();
        if q.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        if q.chars().any(is_burmese_script) {
            let mut out = self.mon_ids(q, limit)?.into_iter().map(|id| self.entry(id)).collect::<Result<Vec<_>>>()?;
            if self.english && out.len() < limit {
                for id in self.reverse_ids(q, REVERSE_SHOWN.min(limit - out.len()))? {
                    out.push(self.english_entry(id)?);
                }
            }
            return Ok(out);
        }
        let wanted = tokens(&q.to_lowercase());
        let mon = self
            .english_ids(q, limit)?
            .into_iter()
            .map(|id| {
                let mut entry = self.entry(id)?;
                entry.senses.sort_by_key(|s| (lang_rank(&s.lang), s.lang != "eng" || !contains_words(&s.text, &wanted)));
                Ok(entry)
            })
            .collect::<Result<Vec<_>>>()?;
        if !self.english {
            return Ok(mon);
        }
        let (exact, base) = self.english_exact(q)?;
        let phrases = self.phrase_ids(&base, &exact)?;
        let split = mon.len().min(MON_BEFORE_PHRASES);
        let mut out = Vec::with_capacity(limit);
        for id in exact {
            out.push(self.english_entry(id)?);
        }
        let mut mon = mon.into_iter();
        out.extend(mon.by_ref().take(split));
        for id in phrases {
            out.push(self.english_entry(id)?);
        }
        out.extend(mon);
        out.truncate(limit);
        Ok(out)
    }

    fn english_exact(&self, query: &str) -> Result<(Vec<i64>, String)> {
        let key = english_key(query);
        let mut ids: Vec<i64> = Vec::new();
        let mut base = key.clone();
        let mut stmt = self.conn.prepare_cached("SELECT id FROM en_word WHERE key = ?1 ORDER BY id")?;
        for form in english_forms(&key) {
            let found = stmt.query_map([&form], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
            if !found.is_empty() {
                ids.extend(found);
                base = form;
                break;
            }
        }
        let mut see = self.conn.prepare_cached(
            "SELECT DISTINCT w.id FROM en_sense s JOIN en_word w ON w.key = s.see
             WHERE s.en_word_id = ?1 AND s.see <> '' ORDER BY w.id",
        )?;
        let mut k = 0;
        while k < ids.len() && ids.len() < 6 {
            for id in see.query_map([ids[k]], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<i64>>>()? {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            k += 1;
        }
        Ok((ids, base))
    }

    fn phrase_ids(&self, base: &str, skip: &[i64]) -> Result<Vec<i64>> {
        if base.is_empty() {
            return Ok(Vec::new());
        }
        let lead = format!("{base} ");
        let to_lead = format!("to {base} ");
        let mut stmt = self.conn.prepare_cached(
            "SELECT id FROM en_word
             WHERE substr(key, 1, length(?1)) = ?1 OR substr(key, 1, length(?2)) = ?2
             ORDER BY length(key), key LIMIT ?3",
        )?;
        let ids = stmt
            .query_map(params![lead, to_lead, PHRASES_SHOWN + skip.len() as i64], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<i64>>>()?;
        Ok(ids.into_iter().filter(|id| !skip.contains(id)).take(PHRASES_SHOWN as usize).collect())
    }

    fn reverse_ids(&self, q: &str, limit: usize) -> Result<Vec<i64>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut stmt = self.conn.prepare_cached("SELECT en_word_id, text FROM en_sense WHERE instr(text, ?1) > 0 ORDER BY en_word_id")?;
        let rows = stmt
            .query_map([q], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ids: Vec<i64> = Vec::new();
        for (id, text) in rows {
            if !ids.contains(&id) && gloss_items(&text).iter().any(|item| *item == q) {
                ids.push(id);
                if ids.len() == limit {
                    break;
                }
            }
        }
        Ok(ids)
    }

    fn english_entry(&self, id: i64) -> Result<DictEntry> {
        let word: String = self.conn.query_row("SELECT word FROM en_word WHERE id = ?1", [id], |r| r.get(0))?;
        let mut stmt = self.conn.prepare_cached("SELECT pos, text, note FROM en_sense WHERE en_word_id = ?1 ORDER BY id")?;
        let senses = stmt
            .query_map([id], |r| Ok(DictSense { lang: "mnw".into(), pos: r.get(0)?, text: r.get(1)?, example: r.get(2)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(DictEntry { id, kind: DictKind::English, word, ipa: String::new(), senses })
    }

    fn mon_ids(&self, q: &str, limit: usize) -> Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM word WHERE word = ?1 OR substr(word, 1, length(?1)) = ?1
             ORDER BY word <> ?1, length(word), word, id LIMIT ?2",
        )?;
        let ids = stmt.query_map(params![q, limit as i64], |r| r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
        Ok(ids)
    }

    fn english_ids(&self, q: &str, limit: usize) -> Result<Vec<i64>> {
        let words = tokens(&q.to_lowercase());
        if words.is_empty() {
            return Ok(Vec::new());
        }
        let phrase = format!("\"{}\"", words.join(" ").replace('"', "\"\""));
        let wanted = simplify(&words.join(" "));
        let mut stmt = self.conn.prepare(
            "SELECT s.word_id, s.text,
                    (SELECT COUNT(*) FROM sense o WHERE o.word_id = s.word_id AND o.lang = 'eng')
             FROM sense_fts f JOIN sense s ON s.id = f.rowid
             WHERE sense_fts MATCH ?1 ORDER BY bm25(sense_fts) LIMIT 400",
        )?;
        let rows = stmt
            .query_map([&phrase], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ranked: Vec<(u8, i64, usize, i64)> = Vec::new();
        for (order, (word_id, text, sense_count)) in rows.into_iter().enumerate() {
            let plain = simplify(&text);
            let tier = if plain == wanted {
                0
            } else if plain.split([',', ';', '/']).any(|part| simplify(part) == wanted) {
                1
            } else {
                2
            };
            match ranked.iter_mut().find(|r| r.3 == word_id) {
                Some(existing) => existing.0 = existing.0.min(tier),
                None => ranked.push((tier, sense_count, order, word_id)),
            }
        }
        ranked.sort_by_key(|&(tier, count, order, _)| (tier, if tier == 2 { 0 } else { count }, order));
        Ok(ranked.into_iter().take(limit).map(|(_, _, _, id)| id).collect())
    }

    fn entry(&self, id: i64) -> Result<DictEntry> {
        let (word, ipa): (String, String) =
            self.conn.query_row("SELECT word, ipa FROM word WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut stmt = self.conn.prepare(
            "SELECT lang, pos, text, example FROM sense WHERE word_id = ?1
             ORDER BY CASE lang WHEN 'eng' THEN 0 WHEN 'mya' THEN 1 WHEN 'tha' THEN 2 ELSE 3 END, id",
        )?;
        let senses = stmt
            .query_map([id], |r| Ok(DictSense { lang: r.get(0)?, pos: r.get(1)?, text: r.get(2)?, example: r.get(3)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(DictEntry { id, kind: DictKind::Mon, word, ipa, senses })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Dictionary {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE word (id INTEGER PRIMARY KEY, word TEXT NOT NULL, ipa TEXT NOT NULL DEFAULT '');
             CREATE TABLE sense (id INTEGER PRIMARY KEY, word_id INTEGER NOT NULL, lang TEXT NOT NULL, pos TEXT NOT NULL, text TEXT NOT NULL, example TEXT NOT NULL DEFAULT '');
             CREATE VIRTUAL TABLE sense_fts USING fts5 (text, content = 'sense', content_rowid = 'id', tokenize = 'unicode61');
             INSERT INTO meta VALUES ('source', 'https://github.com/Barnista/MonDictDB'), ('revision', 'abc'), ('license', 'MIT');
             INSERT INTO word VALUES (1, 'ဗဝ်မှောဝ်', 'pɔ̀ː-hmoː'), (2, 'စိၚ်', 'cəɲ'), (3, 'စိၚ်ဗြဴ', ''), (4, 'ကြုက်', '');
             INSERT INTO sense VALUES
               (1, 1, 'eng', 'n', '1. Elephant keeper. Elephant teacher.', ''),
               (2, 2, 'mya', 'n', 'ဆင်', ''),
               (3, 2, 'eng', 'n', 'Elephant', ''),
               (4, 3, 'eng', 'n', 'Female elephant', ''),
               (5, 4, 'eng', 'v', 'to love, like', 'ex');
             INSERT INTO sense_fts (rowid, text) SELECT id, text FROM sense WHERE lang = 'eng';",
        )
        .unwrap();
        Dictionary::from_connection(conn)
    }

    #[test]
    fn english_lookup_prefers_exact_meaning() {
        let dict = fixture();
        let found = dict.lookup("Elephant!", 10).unwrap();
        assert_eq!(found[0].word, "စိၚ်");
        assert_eq!(found[0].ipa, "cəɲ");
        assert_eq!(found[0].senses[0].lang, "eng");
        assert_eq!(found[0].senses[1].lang, "mya");
        assert_eq!(found.len(), 3);
        assert_eq!(dict.lookup("like", 10).unwrap()[0].word, "ကြုက်");
        assert!(dict.lookup("giraffe", 10).unwrap().is_empty());
        assert!(dict.lookup("  ", 10).unwrap().is_empty());
        assert!(dict.lookup("\"", 10).unwrap().is_empty());
    }

    #[test]
    fn matching_meaning_is_listed_first_and_specific_words_win() {
        let dict = fixture();
        dict.conn
            .execute_batch(
                "INSERT INTO word VALUES (5, 'သွ', ''), (6, 'ဗှ်ဂုန်', '');
                 INSERT INTO sense VALUES (6, 5, 'eng', 'n', 'almost', ''), (7, 5, 'eng', 'n', 'curry', ''), (8, 5, 'eng', 'n', 'Thank you.', ''), (9, 6, 'eng', 'n', 'Thank you.', '');
                 INSERT INTO sense_fts (rowid, text) SELECT id, text FROM sense WHERE id >= 6;",
            )
            .unwrap();
        let found = dict.lookup("thank you", 10).unwrap();
        assert_eq!(found[0].word, "ဗှ်ဂုန်");
        assert_eq!(found[1].word, "သွ");
        assert_eq!(found[1].senses[0].text, "Thank you.");
    }

    #[test]
    fn mon_lookup_matches_headword_then_prefix() {
        let dict = fixture();
        let found = dict.lookup("စိၚ်", 10).unwrap();
        assert_eq!(found.iter().map(|e| e.word.as_str()).collect::<Vec<_>>(), vec!["စိၚ်", "စိၚ်ဗြဴ"]);
        assert_eq!(dict.info().unwrap().license, "MIT");
    }

    fn with_english() -> Dictionary {
        let dict = fixture();
        assert!(!dict.has_english());
        dict.conn
            .execute_batch(
                "CREATE TABLE en_word (id INTEGER PRIMARY KEY, word TEXT NOT NULL, key TEXT NOT NULL);
                 CREATE TABLE en_sense (id INTEGER PRIMARY KEY, en_word_id INTEGER NOT NULL, pos TEXT NOT NULL, text TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', see TEXT NOT NULL DEFAULT '');
                 INSERT INTO en_word VALUES (1, 'elephant', 'elephant'), (2, 'elephant keeper', 'elephant keeper'), (3, 'love', 'love'), (4, 'loved', 'loved'), (5, 'to love dearly', 'to love dearly'), (6, 'Elephants', 'elephants');
                 INSERT INTO en_sense VALUES
                   (1, 1, 'n', 'စိၚ်၊ ကုဉ္ဇရ။', '', ''),
                   (2, 2, 'n', 'ဗဝ်မှောဝ်။', '', ''),
                   (3, 3, 'v', 'ကြုက်။ ၂။ ညာတ်။', 'pt.loved', ''),
                   (4, 4, '', 'ရံၚ် love တေံညိ။', '', 'love'),
                   (5, 5, 'v', 'ကြုက်ဗွဲလပ္ဍဲ။', '', '');",
            )
            .unwrap();
        Dictionary::from_connection(dict.conn)
    }

    #[test]
    fn english_headwords_come_first_with_phrases_after_mon_words() {
        let dict = with_english();
        assert!(dict.has_english());
        let found = dict.lookup("Elephant", 20).unwrap();
        assert_eq!(found[0].kind, DictKind::English);
        assert_eq!(found[0].word, "elephant");
        assert_eq!(found[0].senses[0].lang, "mnw");
        let mon_at = found.iter().position(|e| e.kind == DictKind::Mon).unwrap();
        let phrase_at = found.iter().position(|e| e.word == "elephant keeper").unwrap();
        assert!(mon_at < phrase_at);
        assert_eq!(found.iter().filter(|e| e.word == "Elephants").count(), 0);
    }

    #[test]
    fn english_word_forms_and_cross_references() {
        let dict = with_english();
        let loving = dict.lookup("loving", 10).unwrap();
        assert_eq!(loving[0].word, "love");
        assert_eq!(loving[0].senses[0].example, "pt.loved");
        assert!(loving.iter().any(|e| e.word == "to love dearly"));
        let loved = dict.lookup("loved", 10).unwrap();
        assert_eq!(loved.iter().take(2).map(|e| e.word.as_str()).collect::<Vec<_>>(), vec!["loved", "love"]);
        let plural = dict.lookup("elephants", 10).unwrap();
        assert_eq!(plural[0].word, "Elephants");
        assert_eq!(english_forms("stopped"), vec!["stopped", "stoppe", "stopp", "stop"]);
        assert_eq!(english_forms("thank you"), vec!["thank you"]);
        assert_eq!(english_key("  Thank   You! "), "thank you");
    }

    #[test]
    fn mon_lookup_also_lists_english_words_with_that_gloss() {
        let dict = with_english();
        let found = dict.lookup("ကြုက်", 10).unwrap();
        assert_eq!(found[0].kind, DictKind::Mon);
        assert_eq!(found[0].word, "ကြုက်");
        let english: Vec<&str> = found.iter().filter(|e| e.kind == DictKind::English).map(|e| e.word.as_str()).collect();
        assert_eq!(english, vec!["love"]);
        assert_eq!(gloss_items("ကြုက်။ ၂။ ညာတ်။"), vec!["ကြုက်", "ညာတ်"]);
    }
}
