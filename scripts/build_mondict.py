import argparse
import glob
import os
import re
import sqlite3
import sys

TABLES = ["table", "author", "category", "categorydetail", "word", "definition"]
ALLOWED = {
    sqlite3.SQLITE_INSERT,
    sqlite3.SQLITE_CREATE_TABLE,
    sqlite3.SQLITE_READ,
    sqlite3.SQLITE_SELECT,
    sqlite3.SQLITE_TRANSACTION,
    sqlite3.SQLITE_UPDATE,
}


def chunk_number(path):
    match = re.search(r"_(\d+)\.js$", path)
    return int(match.group(1)) if match else 0


def sql_blocks(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    for match in re.finditer(r"const\s+\w+\s*=\s*`(.*?)`;", text, re.S):
        yield match.group(1)


def only_data(action, table, column, database, trigger):
    if action in ALLOWED and database in (None, "main"):
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def load_source(database_dir):
    staging = sqlite3.connect(":memory:")
    staging.set_authorizer(only_data)
    for name in TABLES:
        files = sorted(glob.glob(os.path.join(database_dir, f"{name}_*.js")), key=chunk_number)
        if not files:
            sys.exit(f"missing {name}_*.js in {database_dir}")
        for path in files:
            for block in sql_blocks(path):
                staging.executescript(block)
    staging.set_authorizer(None)
    return staging


def build(source_dir, out_path, revision):
    database_dir = os.path.join(source_dir, "docs", "assets", "database")
    staging = load_source(database_dir)
    if os.path.exists(out_path):
        os.remove(out_path)
    out = sqlite3.connect(out_path)
    out.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE word (id INTEGER PRIMARY KEY, word TEXT NOT NULL, ipa TEXT NOT NULL DEFAULT '');
        CREATE TABLE sense (
            id INTEGER PRIMARY KEY,
            word_id INTEGER NOT NULL,
            lang TEXT NOT NULL,
            pos TEXT NOT NULL,
            text TEXT NOT NULL,
            example TEXT NOT NULL DEFAULT ''
        );
        """
    )
    words = staging.execute("SELECT id, word, COALESCE(ipa, '') FROM Word WHERE TRIM(word) <> ''").fetchall()
    out.executemany(
        "INSERT INTO word (id, word, ipa) VALUES (?, ?, ?)",
        [(i, w.strip(), "" if ipa.strip() in ("", "???") else ipa.strip()) for i, w, ipa in words],
    )
    senses = staging.execute(
        "SELECT id, word_id, lang_code, pos_code, definition, COALESCE(example, '') FROM Definition WHERE TRIM(definition) <> ''"
    ).fetchall()
    out.executemany(
        "INSERT INTO sense (id, word_id, lang, pos, text, example) VALUES (?, ?, ?, ?, ?, ?)",
        [(i, w, lang, pos, text.strip(), ex.strip()) for i, w, lang, pos, text, ex in senses],
    )
    out.executescript(
        """
        CREATE INDEX idx_word_word ON word (word);
        CREATE INDEX idx_sense_word ON sense (word_id, lang);
        CREATE VIRTUAL TABLE sense_fts USING fts5 (text, content = 'sense', content_rowid = 'id', tokenize = 'unicode61');
        INSERT INTO sense_fts (rowid, text) SELECT id, text FROM sense WHERE lang = 'eng';
        INSERT INTO sense_fts (sense_fts) VALUES ('optimize');
        """
    )
    out.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?)",
        [
            ("source", "https://github.com/Barnista/MonDictDB"),
            ("revision", revision),
            ("license", "MIT"),
            ("words", str(len(words))),
            ("senses", str(len(senses))),
        ],
    )
    out.commit()
    out.execute("VACUUM")
    out.close()
    print(f"{len(words)} words, {len(senses)} senses -> {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Build the HongsaSub dictionary from a MonDictDB checkout.")
    parser.add_argument("source", help="path to a MonDictDB checkout")
    parser.add_argument("out", nargs="?", default=os.path.join(os.path.dirname(__file__), "..", "src-tauri", "resources", "mondict.sqlite"))
    parser.add_argument("--revision", default="unknown")
    args = parser.parse_args()
    build(args.source, os.path.abspath(args.out), args.revision)


if __name__ == "__main__":
    main()
