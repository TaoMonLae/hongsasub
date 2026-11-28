import argparse
import os
import re
import sqlite3

MON = "\u1000-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f"
MON_RUN = re.compile(f"[{MON}]")
MON_WORD = "\u1000-\u1049\u104c-\u109f\ua9e0-\ua9ff\uaa60-\uaa7f"
MON_WORD_RUN = re.compile(f"[{MON_WORD}]")
MON_POS = {
    "n": "n", "v": "v", "adj": "adj", "adv": "adv", "prep": "prep", "pron": "pron", "conj": "conj",
    "int": "int", "num": "num", "part": "part", "pv": "pv", "pn": "pn", "ps": "ps", "neg": "neg",
    "phr": "phr", "pers": "pers", "prov": "prov", "perp": "prep", "v.a": "v", "nn": "n", "ppm": "ppm",
    "pes": "pes", "clf": "clf", "aux": "aux", "suff": "suff", "pref": "pref", "a": "adj", "vt": "v", "vi": "v",
}
ENG_POS = {
    "n": "n", "v": "v", "vt": "v", "vi": "v", "adj": "adj", "adv": "adv", "prep": "prep", "pron": "pron",
    "conj": "conj", "int": "int", "art": "art", "prefix": "prefix", "suffix": "suffix", "pred": "adj",
    "aux": "aux", "abbr": "abbr", "num": "num", "interj": "int",
}


def is_mon(text):
    return bool(MON_RUN.search(text))


def mask_braces(text):
    out = []
    depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
        out.append("\0" if depth else ch)
        if ch == "}" and depth:
            depth -= 1
    return "".join(out)


MON_MARK = re.compile(r"\(\s*([a-z][a-z\.]{0,5}?)\.?\s*\)")
MON_TERM_CHAR = re.compile(f"[{MON_WORD}\u200b\u200c\u200d()\\-]")


def mon_term_before(text, end):
    i = end
    while i > 0 and text[i - 1] in " \t\u00a0\u104a":
        i -= 1
    stop = i
    while i > 0 and (MON_TERM_CHAR.match(text[i - 1]) or (text[i - 1] == " " and i > 1 and MON_WORD_RUN.match(text[i - 2]) and i < stop and MON_WORD_RUN.match(text[i]))):
        i -= 1
    term = text[i:stop].strip()
    while term.startswith(")") or term.startswith("-"):
        term = term[1:]
    if term.count("(") != term.count(")"):
        term = term.lstrip("(")
        if term.count("(") > term.count(")"):
            return None, end
    if not is_mon(term):
        return None, end
    return term, stop - len(text[i:stop].lstrip(")-"))


def clean_gloss(text):
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip(" ;,")


def strip_number(text):
    return re.sub(r"^\s*\d+\s*", "", text)


def parse_mon_row(headword, definition):
    head = headword.strip()
    masked = mask_braces(definition)
    marks = []
    for m in MON_MARK.finditer(masked):
        pos = m.group(1).rstrip(".")
        if pos not in MON_POS:
            continue
        term, start = mon_term_before(masked, m.start())
        marks.append((start if term else m.start(), m.end(), term, MON_POS[pos]))
    out = []
    if not marks:
        gloss = clean_gloss(strip_number(definition))
        if gloss and re.search("[A-Za-z]", gloss):
            out.append((head, "", gloss))
        return out
    for k, (start, end, term, pos) in enumerate(marks):
        stop = marks[k + 1][0] if k + 1 < len(marks) else len(definition)
        gloss = clean_gloss(definition[end:stop])
        if not gloss or not re.search("[A-Za-z]", gloss):
            continue
        out.append((term or head, pos, gloss))
    return out


ENG_HEAD_POS = re.compile(r"(?<![A-Za-z])(n|vt|vi|v|adj|adv|prep|pron|conj|int|art|prefix|suffix|pred|aux|abbr|interj)\.?(?=\s|$|[A-Za-z]+\.)")
ENG_SUB = re.compile(r"\(\s*((?:(?:n|vt|vi|v|adj|adv|prep|pron|conj|int|art|pred|aux|interj)\.?[\s,/]*)+)\)")
ENG_PHRASE_CHAR = re.compile(r"[A-Za-z0-9 '\-,\.~&/]")


def eng_pos_list(text):
    found = re.findall(r"[a-z]+", text)
    seen = []
    for p in found:
        q = ENG_POS.get(p)
        if q and q not in seen:
            seen.append(q)
    return seen


def eng_phrase_before(text, end):
    i = end
    while i > 0 and ENG_PHRASE_CHAR.match(text[i - 1]):
        i -= 1
    phrase = text[i:end].strip(" .,~")
    phrase = re.sub(r"\s+", " ", phrase)
    if not re.search("[A-Za-z]{2,}", phrase) and not re.fullmatch("[A-Za-z]", phrase):
        return None, end
    return phrase, i + (len(text[i:end]) - len(text[i:end].lstrip(" .,~")))


def mask_parens(text):
    out = []
    depth = 0
    for ch in text:
        if ch == "(":
            depth += 1
        out.append("\0" if depth else ch)
        if ch == ")" and depth:
            depth -= 1
    return "".join(out)


def clean_mon_gloss(text):
    text = re.sub(r"\s+", " ", text).strip(" .,;")
    if not is_mon(text):
        return "", ""
    notes = []
    while True:
        m = re.match(r"^\(([^()]*)\)\s*", text)
        if not m or is_mon(m.group(1)):
            break
        notes.append(m.group(1).strip())
        text = text[m.end():]
    return text.strip(" .,;"), "; ".join(n for n in notes if n)


def parse_eng_row(headword, definition):
    head = re.sub(r"\s+", " ", headword).strip()
    marks = []
    for m in ENG_SUB.finditer(definition):
        phrase, start = eng_phrase_before(definition, m.start())
        if phrase:
            marks.append((start, m.end(), phrase, "/".join(eng_pos_list(m.group(1)))))
    taken = [(s, e) for s, e, _, _ in marks]
    masked = mask_parens(definition)
    groups = []
    for m in ENG_HEAD_POS.finditer(masked):
        if any(s <= m.start() < e for s, e in taken):
            continue
        before = masked[max(0, m.start() - 1):m.start()]
        if before and not (before.isspace() or before in "\0။၊" or is_mon(before)):
            continue
        if groups and masked[groups[-1][1]:m.start()].strip(" .,\0") == "" and not any(groups[-1][1] <= s < m.start() for s, _ in taken):
            groups[-1] = (groups[-1][0], m.end(), groups[-1][2] + [m.group(1)])
        else:
            groups.append((m.start(), m.end(), [m.group(1)]))
    for s, e, names in groups:
        marks.append((s, e, head, "/".join(dict.fromkeys(ENG_POS[n] for n in names))))
    marks.sort()
    out = []
    lead_end = marks[0][0] if marks else len(definition)
    body, note = clean_mon_gloss(definition[:lead_end])
    if body:
        out.append((head, "", body, note))
    for k, (start, end, phrase, pos) in enumerate(marks):
        stop = marks[k + 1][0] if k + 1 < len(marks) else len(definition)
        body, note = clean_mon_gloss(definition[end:stop])
        if body:
            out.append((phrase, pos, body, note))
    return out


SEE = re.compile(r"^ရံၚ်\s+([A-Za-z][A-Za-z \-'\.]*?)\s*တေံညိ")
SOURCE = "mon2engdict"


def english_key(text):
    text = re.sub(r"\s+", " ", text.lower()).strip()
    return text.strip(" .,!?;:\"'\u2018\u2019\u201c\u201d")


def columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def prepare(conn):
    for table in ("word", "sense"):
        if "source" not in columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN source TEXT NOT NULL DEFAULT 'mondictdb'")
    conn.execute("DELETE FROM sense WHERE source = ?", (SOURCE,))
    conn.execute("DELETE FROM word WHERE source = ?", (SOURCE,))
    conn.executescript(
        """
        DROP TABLE IF EXISTS en_sense;
        DROP TABLE IF EXISTS en_word;
        CREATE TABLE en_word (id INTEGER PRIMARY KEY, word TEXT NOT NULL, key TEXT NOT NULL);
        CREATE TABLE en_sense (
            id INTEGER PRIMARY KEY,
            en_word_id INTEGER NOT NULL,
            pos TEXT NOT NULL,
            text TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            see TEXT NOT NULL DEFAULT ''
        );
        """
    )


def merge_mon(conn, rows):
    known = {}
    for word_id, word in conn.execute("SELECT id, word FROM word ORDER BY id"):
        known.setdefault(word.strip(), word_id)
    seen = {(w, t) for w, t in conn.execute("SELECT w.word, s.text FROM sense s JOIN word w ON w.id = s.word_id WHERE s.lang = 'eng'")}
    next_word = (conn.execute("SELECT COALESCE(MAX(id), 0) FROM word").fetchone()[0] or 0) + 1
    next_sense = (conn.execute("SELECT COALESCE(MAX(id), 0) FROM sense").fetchone()[0] or 0) + 1
    words, senses = [], []
    for _, headword, definition in rows:
        for term, pos, gloss in parse_mon_row(headword, definition):
            if (term, gloss) in seen:
                continue
            seen.add((term, gloss))
            if term not in known:
                known[term] = next_word
                words.append((next_word, term, "", SOURCE))
                next_word += 1
            senses.append((next_sense, known[term], "eng", pos, gloss, "", SOURCE))
            next_sense += 1
    conn.executemany("INSERT INTO word (id, word, ipa, source) VALUES (?, ?, ?, ?)", words)
    conn.executemany("INSERT INTO sense (id, word_id, lang, pos, text, example, source) VALUES (?, ?, ?, ?, ?, ?, ?)", senses)
    return len(words), len(senses)


def merge_english(conn, rows):
    ids = {}
    words, senses = [], []
    seen = set()
    for _, headword, definition in rows:
        for phrase, pos, body, note in parse_eng_row(headword, definition):
            key = english_key(phrase)
            if not key or (key, pos, body) in seen:
                continue
            seen.add((key, pos, body))
            if key not in ids:
                ids[key] = len(words) + 1
                words.append((ids[key], phrase, key))
            see = SEE.match(body)
            senses.append((len(senses) + 1, ids[key], pos, body, note, english_key(see.group(1)) if see else ""))
    conn.executemany("INSERT INTO en_word (id, word, key) VALUES (?, ?, ?)", words)
    conn.executemany("INSERT INTO en_sense (id, en_word_id, pos, text, note, see) VALUES (?, ?, ?, ?, ?, ?)", senses)
    return len(words), len(senses)


def merge(db_path, engmon_path):
    source = sqlite3.connect(f"file:{engmon_path}?mode=ro", uri=True)
    rows = source.execute("SELECT id, word, defination FROM monengdict ORDER BY id").fetchall()
    source.close()
    mon_rows = [r for r in rows if is_mon(r[1])]
    english_rows = [r for r in rows if not is_mon(r[1])]
    conn = sqlite3.connect(db_path)
    prepare(conn)
    mon_words, mon_senses = merge_mon(conn, mon_rows)
    english_words, english_senses = merge_english(conn, english_rows)
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_word_word ON word (word);
        CREATE INDEX IF NOT EXISTS idx_sense_word ON sense (word_id, lang);
        CREATE INDEX idx_en_word_key ON en_word (key);
        CREATE INDEX idx_en_sense_word ON en_sense (en_word_id);
        INSERT INTO sense_fts (sense_fts) VALUES ('delete-all');
        INSERT INTO sense_fts (rowid, text) SELECT id, text FROM sense WHERE lang = 'eng';
        INSERT INTO sense_fts (sense_fts) VALUES ('optimize');
        """
    )
    meta = [
        ("engmon_source", "Mon–English / English–Mon Dictionary (mon2engdict), Nai Saik Chan; data by Nai Aung Nyan Lynn, Nai Tun Wai and others"),
        ("engmon_license", "Used with permission"),
        ("engmon_rows", str(len(rows))),
        ("engmon_mon_words", str(mon_words)),
        ("engmon_mon_senses", str(mon_senses)),
        ("english_words", str(english_words)),
        ("english_senses", str(english_senses)),
        ("words", str(conn.execute("SELECT COUNT(*) FROM word").fetchone()[0])),
        ("senses", str(conn.execute("SELECT COUNT(*) FROM sense").fetchone()[0])),
    ]
    conn.executemany("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", meta)
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(f"{len(rows)} rows: {mon_words} new Mon words, {mon_senses} Mon senses, {english_words} English headwords, {english_senses} English senses -> {db_path}")


def main():
    parser = argparse.ArgumentParser(description="Merge the mon2engdict engmondict.db into the HongsaSub dictionary.")
    parser.add_argument("engmon", help="path to engmondict.db")
    parser.add_argument("db", nargs="?", default=os.path.join(os.path.dirname(__file__), "..", "src-tauri", "resources", "mondict.sqlite"))
    args = parser.parse_args()
    merge(os.path.abspath(args.db), os.path.abspath(args.engmon))


if __name__ == "__main__":
    main()
