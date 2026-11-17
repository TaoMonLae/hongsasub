use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::normalize::{clean_target, normalize_source, normalize_target, tokens};

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_norm TEXT NOT NULL,
    target TEXT NOT NULL,
    target_norm TEXT NOT NULL,
    prev_norm TEXT NOT NULL DEFAULT '',
    next_norm TEXT NOT NULL DEFAULT '',
    work TEXT NOT NULL DEFAULT '',
    use_count INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source_norm, target_norm)
);
CREATE INDEX IF NOT EXISTS idx_segments_source ON segments (source_norm);
CREATE INDEX IF NOT EXISTS idx_segments_updated ON segments (updated_at);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5 (
    source_norm, content = 'segments', content_rowid = 'rowid', tokenize = 'unicode61'
);
CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
    INSERT INTO segments_fts (rowid, source_norm) VALUES (new.rowid, new.source_norm);
END;
CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
    INSERT INTO segments_fts (segments_fts, rowid, source_norm) VALUES ('delete', old.rowid, old.source_norm);
END;
CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE OF source_norm ON segments BEGIN
    INSERT INTO segments_fts (segments_fts, rowid, source_norm) VALUES ('delete', old.rowid, old.source_norm);
    INSERT INTO segments_fts (rowid, source_norm) VALUES (new.rowid, new.source_norm);
END;
CREATE TABLE IF NOT EXISTS terms (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_norm TEXT NOT NULL,
    target TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source_norm, target)
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');
";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitRequest {
    pub source: String,
    pub target: String,
    pub prev: String,
    pub next: String,
    pub work: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuggestRequest {
    pub source: String,
    pub prev: String,
    pub next: String,
    pub work: String,
    pub limit: Option<usize>,
    pub min_score: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pretranslation {
    pub target: String,
    pub score: u8,
    pub context_match: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffOp {
    Equal,
    Insert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPart {
    pub op: DiffOp,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    pub source: String,
    pub target: String,
    pub score: u8,
    pub context_match: bool,
    pub same_work: bool,
    pub work: String,
    pub use_count: i64,
    pub updated_at: i64,
    pub diff: Vec<DiffPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryTerm {
    pub id: String,
    pub source: String,
    pub target: String,
    pub note: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestResponse {
    pub matches: Vec<Suggestion>,
    pub terms: Vec<GlossaryTerm>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Concordance {
    pub id: String,
    pub source: String,
    pub target: String,
    pub work: String,
    pub use_count: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmStats {
    pub segments: i64,
    pub terms: i64,
    pub works: i64,
}

struct Candidate {
    id: String,
    source: String,
    source_norm: String,
    target: String,
    prev_norm: String,
    next_norm: String,
    work: String,
    use_count: i64,
    updated_at: i64,
}

impl Candidate {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            source: row.get(1)?,
            source_norm: row.get(2)?,
            target: row.get(3)?,
            prev_norm: row.get(4)?,
            next_norm: row.get(5)?,
            work: row.get(6)?,
            use_count: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
}

const CANDIDATE_COLUMNS: &str =
    "s.id, s.source, s.source_norm, s.target, s.prev_norm, s.next_norm, s.work, s.use_count, s.updated_at";

pub struct TranslationMemory {
    conn: Connection,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl TranslationMemory {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn commit(&self, req: &CommitRequest) -> Result<Option<String>> {
        let source_norm = normalize_source(&req.source);
        let target = clean_target(&req.target);
        let target_norm = normalize_target(&target);
        if source_norm.is_empty() || target_norm.is_empty() {
            return Ok(None);
        }
        let now = now_ms();
        let id: String = self.conn.query_row(
            "INSERT INTO segments (id, source, source_norm, target, target_norm, prev_norm, next_norm, work, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT (source_norm, target_norm) DO UPDATE SET
                 use_count = CASE WHEN segments.deleted = 1 THEN 1 ELSE segments.use_count + 1 END,
                 target = excluded.target,
                 source = excluded.source,
                 prev_norm = excluded.prev_norm,
                 next_norm = excluded.next_norm,
                 work = excluded.work,
                 updated_at = excluded.updated_at,
                 deleted = 0
             RETURNING id",
            params![
                Uuid::new_v4().to_string(),
                req.source.trim(),
                source_norm,
                target,
                target_norm,
                normalize_source(&req.prev),
                normalize_source(&req.next),
                req.work.trim(),
                now
            ],
            |row| row.get(0),
        )?;
        Ok(Some(id))
    }

    pub fn commit_many(&mut self, items: &[CommitRequest]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut count = 0;
        {
            let now = now_ms();
            let mut stmt = tx.prepare(
                "INSERT INTO segments (id, source, source_norm, target, target_norm, prev_norm, next_norm, work, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                 ON CONFLICT (source_norm, target_norm) DO UPDATE SET
                     use_count = CASE WHEN segments.deleted = 1 THEN 1 ELSE segments.use_count + 1 END,
                     updated_at = excluded.updated_at,
                     deleted = 0",
            )?;
            for req in items {
                let source_norm = normalize_source(&req.source);
                let target = clean_target(&req.target);
                let target_norm = normalize_target(&target);
                if source_norm.is_empty() || target_norm.is_empty() {
                    continue;
                }
                stmt.execute(params![
                    Uuid::new_v4().to_string(),
                    req.source.trim(),
                    source_norm,
                    target,
                    target_norm,
                    normalize_source(&req.prev),
                    normalize_source(&req.next),
                    req.work.trim(),
                    now
                ])?;
                count += 1;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn suggest(&self, req: &SuggestRequest) -> Result<SuggestResponse> {
        let source_norm = normalize_source(&req.source);
        let terms = self.glossary_matches(&source_norm)?;
        if source_norm.is_empty() {
            return Ok(SuggestResponse { matches: Vec::new(), terms });
        }
        let limit = req.limit.unwrap_or(8);
        let min_score = req.min_score.unwrap_or(55);
        let prev_norm = normalize_source(&req.prev);
        let next_norm = normalize_source(&req.next);
        let work = req.work.trim();

        let mut candidates: Vec<Candidate> = Vec::new();
        {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {CANDIDATE_COLUMNS} FROM segments s WHERE s.source_norm = ?1 AND s.deleted = 0"
            ))?;
            let rows = stmt.query_map([&source_norm], Candidate::from_row)?;
            for row in rows {
                candidates.push(row?);
            }
        }
        if let Some(query) = fts_query(&source_norm) {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT {CANDIDATE_COLUMNS} FROM segments_fts f JOIN segments s ON s.rowid = f.rowid
                 WHERE segments_fts MATCH ?1 AND s.deleted = 0 AND s.source_norm <> ?2
                 ORDER BY bm25(segments_fts) LIMIT 80"
            ))?;
            let rows = stmt.query_map(params![query, source_norm], Candidate::from_row)?;
            for row in rows {
                candidates.push(row?);
            }
        }

        let mut matches: Vec<Suggestion> = candidates
            .into_iter()
            .filter_map(|c| {
                let score = similarity(&source_norm, &c.source_norm);
                if score < min_score {
                    return None;
                }
                let context_match = (!prev_norm.is_empty() && prev_norm == c.prev_norm)
                    || (!next_norm.is_empty() && next_norm == c.next_norm);
                let diff = if score == 100 { Vec::new() } else { word_diff(&c.source_norm, &source_norm) };
                Some(Suggestion {
                    id: c.id,
                    source: c.source,
                    target: c.target,
                    score,
                    context_match,
                    same_work: !work.is_empty() && c.work == work,
                    work: c.work,
                    use_count: c.use_count,
                    updated_at: c.updated_at,
                    diff,
                })
            })
            .collect();

        matches.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then(b.context_match.cmp(&a.context_match))
                .then(b.same_work.cmp(&a.same_work))
                .then(b.use_count.cmp(&a.use_count))
                .then(b.updated_at.cmp(&a.updated_at))
        });
        let mut seen = std::collections::HashSet::new();
        matches.retain(|m| seen.insert(m.id.clone()));
        matches.truncate(limit);
        Ok(SuggestResponse { matches, terms })
    }

    pub fn pretranslate(&self, requests: &[SuggestRequest], min_score: u8) -> Result<Vec<Option<Pretranslation>>> {
        requests
            .iter()
            .map(|r| {
                let req = SuggestRequest { limit: Some(1), min_score: Some(min_score), ..r.clone() };
                Ok(self.suggest(&req)?.matches.into_iter().next().map(|m| Pretranslation {
                    target: m.target,
                    score: m.score,
                    context_match: m.context_match,
                }))
            })
            .collect()
    }

    pub fn all_targets(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT target FROM segments WHERE deleted = 0")?;
        let targets = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(targets)
    }

    pub fn delete_segment(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE segments SET deleted = 1, updated_at = ?2 WHERE id = ?1",
            params![id, now_ms()],
        )?;
        Ok(())
    }

    pub fn concordance(&self, query: &str, limit: usize) -> Result<Vec<Concordance>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let source_query = normalize_source(q);
        let pattern = format!("%{}%", escape_like(if source_query.is_empty() { q } else { &source_query }));
        let target_pattern = format!("%{}%", escape_like(&normalize_target(q)));
        let mut stmt = self.conn.prepare(
            "SELECT id, source, target, work, use_count, updated_at FROM segments
             WHERE deleted = 0 AND (source_norm LIKE ?1 ESCAPE '\\' OR target_norm LIKE ?2 ESCAPE '\\')
             ORDER BY use_count DESC, updated_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![pattern, target_pattern, limit as i64], |row| {
            Ok(Concordance {
                id: row.get(0)?,
                source: row.get(1)?,
                target: row.get(2)?,
                work: row.get(3)?,
                use_count: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn add_term(&self, source: &str, target: &str, note: &str) -> Result<Option<GlossaryTerm>> {
        let source_norm = normalize_source(source);
        let target = clean_target(target);
        if source_norm.is_empty() || target.is_empty() {
            return Ok(None);
        }
        let now = now_ms();
        let id: String = self.conn.query_row(
            "INSERT INTO terms (id, source, source_norm, target, note, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT (source_norm, target) DO UPDATE SET note = excluded.note, source = excluded.source,
                 updated_at = excluded.updated_at, deleted = 0
             RETURNING id",
            params![Uuid::new_v4().to_string(), source.trim(), source_norm, target, note.trim(), now],
            |row| row.get(0),
        )?;
        Ok(Some(GlossaryTerm {
            id,
            source: source.trim().to_string(),
            target,
            note: note.trim().to_string(),
            updated_at: now,
        }))
    }

    pub fn delete_term(&self, id: &str) -> Result<()> {
        self.conn.execute("UPDATE terms SET deleted = 1, updated_at = ?2 WHERE id = ?1", params![id, now_ms()])?;
        Ok(())
    }

    pub fn list_terms(&self) -> Result<Vec<GlossaryTerm>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source, target, note, updated_at FROM terms WHERE deleted = 0 ORDER BY source COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(GlossaryTerm {
                id: row.get(0)?,
                source: row.get(1)?,
                target: row.get(2)?,
                note: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    fn glossary_matches(&self, source_norm: &str) -> Result<Vec<GlossaryTerm>> {
        let line_tokens = tokens(source_norm);
        if line_tokens.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id, source, target, note, updated_at, source_norm FROM terms WHERE deleted = 0")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                GlossaryTerm {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    target: row.get(2)?,
                    note: row.get(3)?,
                    updated_at: row.get(4)?,
                },
                row.get::<_, String>(5)?,
            ))
        })?;
        let mut found: Vec<(usize, GlossaryTerm)> = Vec::new();
        for row in rows {
            let (term, norm) = row?;
            let term_tokens = tokens(&norm);
            if let Some(pos) = find_sequence(&line_tokens, &term_tokens) {
                found.push((pos, term));
            }
        }
        found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.source.cmp(&b.1.source)));
        Ok(found.into_iter().map(|(_, t)| t).collect())
    }

    pub fn stats(&self) -> Result<TmStats> {
        let segments = self.conn.query_row("SELECT COUNT(*) FROM segments WHERE deleted = 0", [], |r| r.get(0))?;
        let terms = self.conn.query_row("SELECT COUNT(*) FROM terms WHERE deleted = 0", [], |r| r.get(0))?;
        let works = self.conn.query_row(
            "SELECT COUNT(DISTINCT work) FROM segments WHERE deleted = 0 AND work <> ''",
            [],
            |r| r.get(0),
        )?;
        Ok(TmStats { segments, terms, works })
    }

    pub fn segment_target(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT target FROM segments WHERE id = ?1", [id], |r| r.get(0))
            .optional()?)
    }
}

fn fts_query(source_norm: &str) -> Option<String> {
    let parts: Vec<String> = tokens(source_norm)
        .into_iter()
        .filter(|t| t.chars().count() > 1 || !t.is_ascii())
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" OR "))
    }
}

fn escape_like(value: &str) -> String {
    value.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn find_sequence(haystack: &[String], needle: &[String]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

pub fn similarity(a: &str, b: &str) -> u8 {
    if a == b {
        return 100;
    }
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let longest = a.len().max(b.len());
    if longest == 0 {
        return 100;
    }
    let distance = levenshtein(&a, &b);
    let score = ((longest - distance) as f64 / longest as f64 * 100.0).floor() as u8;
    score.min(99)
}

fn levenshtein<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0; b.len() + 1];
    for (i, x) in a.iter().enumerate() {
        curr[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let cost = usize::from(x != y);
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

pub fn word_diff(old: &str, new: &str) -> Vec<DiffPart> {
    let a: Vec<&str> = old.split_whitespace().collect();
    let b: Vec<&str> = new.split_whitespace().collect();
    let mut lcs = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }
    let mut parts: Vec<DiffPart> = Vec::new();
    let mut push = |op: DiffOp, word: &str| match parts.last_mut() {
        Some(last) if last.op == op => {
            last.text.push(' ');
            last.text.push_str(word);
        }
        _ => parts.push(DiffPart { op, text: word.to_string() }),
    };
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            push(DiffOp::Equal, a[i]);
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            push(DiffOp::Delete, a[i]);
            i += 1;
        } else {
            push(DiffOp::Insert, b[j]);
            j += 1;
        }
    }
    while i < a.len() {
        push(DiffOp::Delete, a[i]);
        i += 1;
    }
    while j < b.len() {
        push(DiffOp::Insert, b[j]);
        j += 1;
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(tm: &TranslationMemory, source: &str, target: &str, prev: &str, work: &str) -> String {
        tm.commit(&CommitRequest {
            source: source.into(),
            target: target.into(),
            prev: prev.into(),
            next: String::new(),
            work: work.into(),
        })
        .unwrap()
        .unwrap()
    }

    fn ask(tm: &TranslationMemory, source: &str, prev: &str) -> SuggestResponse {
        tm.suggest(&SuggestRequest { source: source.into(), prev: prev.into(), ..Default::default() }).unwrap()
    }

    #[test]
    fn exact_match_ignores_tags_and_case() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        commit(&tm, "Where are you going?", "\u{1000}\u{1031}", "", "Film A");
        let res = ask(&tm, "{\\i1}WHERE are you going?", "");
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].score, 100);
        assert_eq!(res.matches[0].target, "\u{1000}\u{1031}");
    }

    #[test]
    fn pretranslate_takes_best_match_above_threshold() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        commit(&tm, "Where are you going?", "T1", "", "");
        commit(&tm, "Where are you going tonight?", "T2", "", "");
        let req = |s: &str| SuggestRequest { source: s.into(), ..Default::default() };
        let out = tm.pretranslate(&[req("where are you going?"), req("Where are you going today?"), req("Nothing like it")], 100).unwrap();
        assert_eq!(out[0].as_ref().map(|p| p.target.as_str()), Some("T1"));
        assert!(out[1].is_none());
        assert!(out[2].is_none());
        let loose = tm.pretranslate(&[req("Where are you going today?")], 70).unwrap();
        assert_eq!(loose[0].as_ref().map(|p| p.target.as_str()), Some("T2"));
    }

    #[test]
    fn fuzzy_match_with_diff() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        commit(&tm, "Where are you going tonight?", "T1", "", "");
        let res = ask(&tm, "Where are you going today?", "");
        assert_eq!(res.matches.len(), 1);
        assert!(res.matches[0].score >= 70 && res.matches[0].score < 100);
        assert!(res.matches[0].diff.iter().any(|d| d.op == DiffOp::Insert && d.text == "today?"));
        assert!(res.matches[0].diff.iter().any(|d| d.op == DiffOp::Delete && d.text == "tonight?"));
    }

    #[test]
    fn keeps_multiple_translations_and_ranks_by_context() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        commit(&tm, "Go.", "A", "Are you ready?", "");
        commit(&tm, "Go.", "B", "Get out of my house!", "");
        commit(&tm, "Go.", "B", "Get out of my house!", "");
        let res = ask(&tm, "Go.", "Are you ready?");
        assert_eq!(res.matches.len(), 2);
        assert_eq!(res.matches[0].target, "A");
        assert!(res.matches[0].context_match);
        let res = ask(&tm, "Go.", "");
        assert_eq!(res.matches[0].target, "B");
        assert_eq!(res.matches[0].use_count, 2);
    }

    #[test]
    fn glossary_matches_whole_words() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        tm.add_term("Captain Mon", "TERM1", "main character").unwrap();
        tm.add_term("cat", "TERM2", "").unwrap();
        let res = ask(&tm, "Captain Mon, the concatenation is done.", "");
        assert_eq!(res.terms.len(), 1);
        assert_eq!(res.terms[0].target, "TERM1");
    }

    #[test]
    fn concordance_and_soft_delete() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        let id = commit(&tm, "I love this village.", "V", "", "");
        commit(&tm, "The village is quiet.", "Q", "", "");
        assert_eq!(tm.concordance("village", 10).unwrap().len(), 2);
        tm.delete_segment(&id).unwrap();
        assert_eq!(tm.concordance("village", 10).unwrap().len(), 1);
        assert_eq!(tm.stats().unwrap().segments, 1);
        assert!(ask(&tm, "I love this village.", "").matches.is_empty());
    }

    #[test]
    fn empty_lines_are_not_stored() {
        let tm = TranslationMemory::open_in_memory().unwrap();
        let res = tm.commit(&CommitRequest { source: "{\\an8}".into(), target: "x".into(), ..Default::default() });
        assert!(res.unwrap().is_none());
    }

    #[test]
    fn bulk_import() {
        let mut tm = TranslationMemory::open_in_memory().unwrap();
        let items: Vec<CommitRequest> = (0..50)
            .map(|i| CommitRequest { source: format!("Line {i}"), target: format!("T{i}"), ..Default::default() })
            .collect();
        assert_eq!(tm.commit_many(&items).unwrap(), 50);
        assert_eq!(tm.stats().unwrap().segments, 50);
    }
}
