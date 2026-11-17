import { useEffect, useMemo, useState } from "react";
import type { GlossaryTerm, Misspelling, SubtitleEvent } from "../lib/api";
import { cps, fromEditable, plainText, stripTags, toEditable } from "../lib/text";
import { formatDuration, formatTime, parseTime } from "../lib/time";
import { ALT, ENTER, MOD } from "../lib/keys";
import { CheckIcon, CopyIcon, LoopLineIcon, WarningIcon } from "./Icons";
import { FormatBar } from "./FormatBar";
import { applyMark, type Edit, type Syntax } from "../lib/format";
import type { StyleFields } from "../lib/styles";
import type { Issue } from "../lib/checks";

interface Props {
  event: SubtitleEvent;
  index: number;
  total: number;
  terms: GlossaryTerm[];
  translating: boolean;
  styles: string[];
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (patch: Partial<SubtitleEvent>, group?: string | null) => void;
  onConfirm: () => void;
  onPlayLine: () => void;
  onInsertTerm: (target: string) => void;
  onLookUp: (text: string) => void;
  syntax: Syntax;
  fields: StyleFields;
  onStyles: () => void;
  issues: Issue[];
  onFix: (issues: Issue[]) => void;
  cpsLimit: number;
  onSplit: (caret: number | null) => void;
  onMerge: () => void;
  canMerge: boolean;
  misspellings: Misspelling[] | null;
  onAddWord: (word: string) => void;
}

function SpellMarks({ value, marks, scrollTop }: { value: string; marks: Misspelling[]; scrollTop: number }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  marks.forEach((m, i) => {
    if (m.start < at || m.start + m.len > value.length) return;
    parts.push(value.slice(at, m.start));
    parts.push(<mark key={i}>{value.slice(m.start, m.start + m.len)}</mark>);
    at = m.start + m.len;
  });
  parts.push(value.slice(at));
  return (
    <div className="editor__marks mon" aria-hidden style={{ transform: `translateY(${-scrollTop}px)` }}>
      {parts}
      {"\u200b"}
    </div>
  );
}

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (ms: number) => void }) {
  const [draft, setDraft] = useState(formatTime(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setDraft(formatTime(value));
    setBad(false);
  }, [value]);
  const commit = () => {
    if (draft === formatTime(value)) {
      setBad(false);
      return;
    }
    const ms = parseTime(draft);
    if (ms === null) {
      setBad(true);
      return;
    }
    setBad(false);
    if (ms !== value) onCommit(ms);
  };
  return (
    <label className={`timefield${bad ? " is-bad" : ""}`}>
      <span>{label}</span>
      <input
        className="num"
        aria-invalid={bad}
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setDraft(formatTime(value));
        }}
      />
    </label>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTerms(text: string, terms: GlossaryTerm[], onPick: (t: GlossaryTerm) => void) {
  if (terms.length === 0) return text;
  const sorted = [...terms].sort((a, b) => b.source.length - a.source.length);
  const pattern = new RegExp(`\\b(${sorted.map((t) => escapeRegExp(t.source)).join("|")})\\b`, "gi");
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const term = sorted.find((t) => t.source.toLowerCase() === m[0].toLowerCase());
    parts.push(
      <button key={at} className="term-mark" onClick={() => term && onPick(term)} title={term ? `Insert ${term.target}` : ""}>
        {m[0]}
      </button>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function LineEditor(props: Props) {
  const { event, index, total, terms, translating, styles, editorRef, onChange, onConfirm, onPlayLine, onInsertTerm, onLookUp, syntax, fields, onStyles, issues, onFix, cpsLimit, onSplit, onMerge, canMerge, misspellings, onAddWord } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const editable = toEditable(event.text);
  const marks = misspellings ?? [];
  const unknownWords = [...new Set(marks.map((m) => m.word))];

  const applyFormat = (fn: (value: string, start: number, end: number) => Edit) => {
    const area = editorRef.current;
    const value = toEditable(event.text);
    const start = area ? area.selectionStart : value.length;
    const end = area ? area.selectionEnd : value.length;
    const next = fn(value, start, end);
    if (next.value === value) return;
    const text = fromEditable(next.value);
    onChange({ text, status: plainText(text) ? "draft" : "untranslated" });
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(next.start, next.end);
    });
  };
  const rate = cps(event.text, event.start, event.end);
  const target = plainText(event.text);
  const fast = Boolean(target) && rate > cpsLimit;
  const source = useMemo(() => stripTags(toEditable(event.source)), [event.source]);
  const statusLabel = event.status === "confirmed" ? "Confirmed" : event.status === "draft" ? "Draft" : "Untranslated";

  return (
    <section className="editor" aria-label="Line editor">
      <header className="editor__head">
        <h2 className="editor__title">
          Line <span className="num">{index + 1}</span>
          <span className="editor__of"> of {total}</span>
        </h2>
        <span className={`status status--${event.kind === "comment" ? "comment" : event.status}`}>
          {event.kind === "comment" ? "Comment" : statusLabel}
        </span>
        <div className="editor__timing">
          <TimeField label="Start" value={event.start} onCommit={(start) => onChange({ start: Math.max(0, Math.min(start, event.end - 100)) })} />
          <TimeField label="End" value={event.end} onCommit={(end) => onChange({ end: Math.max(end, event.start + 100) })} />
          <div className="stat">
            <span>Duration</span>
            <b className="num">{formatDuration(event.end - event.start)}</b>
          </div>
          <div className={`stat${fast ? " is-warn" : ""}`} title={fast ? `Faster than ${cpsLimit} characters per second` : "Characters per second"}>
            <span>CPS</span>
            <b className="num">
              {fast && <WarningIcon size={12} />}
              {target ? rate.toFixed(1) : "–"}
            </b>
          </div>
        </div>
      </header>

      {translating && (
        <div className="editor__source">
          <div className="editor__label">
            <span>English</span>
            <button className="btn btn--plain btn--small" onClick={() => onChange({ text: event.source, status: "draft" })}>
              <CopyIcon size={13} />
              Copy to Mon
            </button>
          </div>
          <p
            title="Double-click a word to look it up"
            onDoubleClick={() => {
              const word = window.getSelection()?.toString().trim();
              if (word) onLookUp(word);
            }}
          >
            {highlightTerms(source, terms, (t) => onInsertTerm(t.target))}
          </p>
        </div>
      )}

      <div className="editor__target">
        <div className="editor__label">
          <label htmlFor="mon-text">{translating ? "Mon" : "Text"}</label>
          <div className="editor__meta">
            <select className="control" value={event.style} onChange={(e) => onChange({ style: e.target.value })} aria-label="Style">
              {(styles.includes(event.style) ? styles : [event.style, ...styles]).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input
              className="control actor"
              placeholder="Speaker"
              aria-label="Speaker"
              value={event.actor}
              onChange={(e) => onChange({ actor: e.target.value }, `actor:${event.id}`)}
            />
          </div>
        </div>
        <FormatBar syntax={syntax} fields={fields} onApply={applyFormat} onStyles={onStyles} />
        <div className="editor__field">
        {marks.length > 0 && <SpellMarks value={editable} marks={marks} scrollTop={scrollTop} />}
        <textarea
          id="mon-text"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          ref={editorRef}
          className="mon"
          lang="mnw"
          dir="ltr"
          spellCheck={false}
          placeholder={translating ? "Type the Mon translation" : "Subtitle text"}
          value={toEditable(event.text)}
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
            const mark = ({ b: "b", i: "i", u: "u" } as const)[e.key.toLowerCase() as "b" | "i" | "u"];
            if (!mark) return;
            e.preventDefault();
            applyFormat((v, s, en) => applyMark(v, s, en, mark, syntax, fields));
          }}
          onChange={(e) => {
            const text = fromEditable(e.target.value);
            onChange({ text, status: plainText(text) ? "draft" : "untranslated" }, `type:${event.id}`);
          }}
        />
        </div>
        {unknownWords.length > 0 && (
          <div className="editor__spell">
            <span>Not in the dictionary:</span>
            {unknownWords.slice(0, 8).map((w) => (
              <button key={w} className="editor__word mon" onClick={() => onAddWord(w)} title={`Add “${w}” to your words so it is no longer marked`}>
                {w}
                <em>+</em>
              </button>
            ))}
          </div>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="editor__issues" aria-label="Problems in this line">
          {issues.map((issue) => (
            <li key={issue.key} className={`checks__issue checks__issue--${issue.severity}`}>
              <WarningIcon size={12} />
              <span className="checks__msg">{issue.message}</span>
              {issue.fix && (
                <button className="btn btn--plain btn--small checks__fix" onClick={() => onFix([issue])}>
                  {issue.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="editor__foot">
        <button className="btn btn--plain" onClick={onPlayLine}>
          <LoopLineIcon size={14} />
          Play line <kbd>{ALT}P</kbd>
        </button>
        <button
          className="btn btn--plain"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSplit(editorRef.current ? editorRef.current.selectionStart : null)}
          disabled={event.end - event.start < 200}
          title="Split this line in two at the cursor, or in the middle. Timing is shared by text length."
        >
          Split
        </button>
        <button className="btn btn--plain" onClick={onMerge} disabled={!canMerge} title="Join this line with the next one">
          Merge next
        </button>
        <span className="spacer" />
        <button className="btn btn--primary" onClick={onConfirm} disabled={event.kind === "comment"}>
          <CheckIcon size={14} />
          Confirm and next <kbd>{MOD}{ENTER}</kbd>
        </button>
      </footer>
    </section>
  );
}
