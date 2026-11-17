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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DictEntry {
    pub id: i64,
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
}

pub struct Dictionary {
    conn: Connection,
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
        Ok(Self { conn })
    }

    pub fn from_connection(conn: Connection) -> Self {
        Self { conn }
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
        Ok(DictInfo { words, source: meta("source"), revision: meta("revision"), license: meta("license") })
    }

    pub fn lookup(&self, query: &str, limit: usize) -> Result<Vec<DictEntry>> {
        let q = query.trim();
        if q.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        if q.chars().any(is_burmese_script) {
            return self.mon_ids(q, limit)?.into_iter().map(|id| self.entry(id)).collect();
        }
        let wanted = tokens(&q.to_lowercase());
        self.english_ids(q, limit)?
            .into_iter()
            .map(|id| {
                let mut entry = self.entry(id)?;
                entry.senses.sort_by_key(|s| (lang_rank(&s.lang), s.lang != "eng" || !contains_words(&s.text, &wanted)));
                Ok(entry)
            })
            .collect()
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
        Ok(DictEntry { id, word, ipa, senses })
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
}
