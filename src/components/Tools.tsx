import { useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleEvent } from "../lib/api";
import { countInText, findPattern, parseOffset, replaceInText } from "../lib/edits";
import { plainText } from "../lib/text";
import { formatTime } from "../lib/time";
import { Shell } from "./Modals";

const SCORES = [
  { value: 100, label: "100%", note: "exact" },
  { value: 95, label: "95%+", note: "punctuation or case differs" },
  { value: 85, label: "85%+", note: "a word or two differs" },
];

export function FillModal({ open, onFill, onClose }: { open: number; onFill: (minScore: number) => Promise<void>; onClose: () => void }) {
  const [score, setScore] = useState(100);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    await onFill(score);
    setBusy(false);
  };
  return (
    <Shell title="Fill from memory" onClose={onClose}>
      <p className="modal__lead">
        Every untranslated line whose English is already in memory gets that translation as a draft. Drafts stay unconfirmed until you check them,
        and one undo removes them all.
      </p>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Lowest match">
        {SCORES.map((s) => (
          <button key={s.value} role="radio" aria-checked={score === s.value} className={score === s.value ? "is-on" : ""} onClick={() => setScore(s.value)}>
            {s.label} <em>{s.note}</em>
          </button>
        ))}
      </div>
      <p className="tools__note">
        <span className="num">{open.toLocaleString()}</span> {open === 1 ? "line has" : "lines have"} no Mon text yet.
      </p>
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={busy || open === 0} onClick={run}>
          {busy ? "Searching memory…" : "Fill drafts"}
        </button>
      </div>
    </Shell>
  );
}

const PREVIEW = 60;

export function ReplaceModal({
  events,
  onReplace,
  onSelect,
  onClose,
}: {
  events: SubtitleEvent[];
  onReplace: (patches: Map<string, Partial<SubtitleEvent>>) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const pattern = useMemo(() => findPattern(find, { matchCase, wholeWord }), [find, matchCase, wholeWord]);
  const hits = useMemo(() => {
    if (!pattern) return [];
    const out: { ev: SubtitleEvent; index: number; count: number; after: string }[] = [];
    events.forEach((ev, index) => {
      if (ev.kind !== "dialogue") return;
      const count = countInText(ev.text, pattern);
      if (count) out.push({ ev, index, count, after: replaceInText(ev.text, pattern, replace).text });
    });
    return out;
  }, [events, pattern, replace]);
  const total = hits.reduce((n, h) => n + h.count, 0);
  const changes = hits.some((h) => h.after !== h.ev.text);

  const run = () => {
    const patches = new Map<string, Partial<SubtitleEvent>>();
    for (const h of hits) if (h.after !== h.ev.text) patches.set(h.ev.id, { text: h.after });
    onReplace(patches);
  };

  return (
    <Shell title="Find and replace" onClose={onClose} wide>
      <div className="tools__find">
        <label className="labelled">
          <span>Find</span>
          <input className="field mon" value={find} onChange={(e) => setFind(e.target.value)} autoFocus spellCheck={false} />
        </label>
        <label className="labelled">
          <span>Replace with</span>
          <input className="field mon" value={replace} onChange={(e) => setReplace(e.target.value)} spellCheck={false} />
        </label>
      </div>
      <div className="tools__options">
        <label className="check">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          <span>Match case</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          <span>Whole words only</span>
        </label>
        <span className="tools__count">
          {find ? (
            <>
              <span className="num">{total.toLocaleString()}</span> {total === 1 ? "match" : "matches"} in <span className="num">{hits.length.toLocaleString()}</span>{" "}
              {hits.length === 1 ? "line" : "lines"}
            </>
          ) : (
            "Searches the subtitle text. Tags and line breaks are left alone."
          )}
        </span>
      </div>
      {hits.length > 0 && (
        <ul className="tools__hits" aria-label="Lines that will change">
          {hits.slice(0, PREVIEW).map((h) => (
            <li key={h.ev.id}>
              <button className="tools__hit" onClick={() => onSelect(h.ev.id)}>
                <span className="num tools__where">
                  {h.index + 1} · {formatTime(h.ev.start)}
                </span>
                <span className="tools__before mon">{plainText(h.ev.text)}</span>
                <span className="tools__after mon">{plainText(h.after) || "(empty)"}</span>
              </button>
            </li>
          ))}
          {hits.length > PREVIEW && <li className="tools__more">and {(hits.length - PREVIEW).toLocaleString()} more lines</li>}
        </ul>
      )}
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        <button className="btn btn--primary" disabled={!changes} onClick={run}>
          Replace all
        </button>
      </div>
    </Shell>
  );
}

export function ShiftModal({
  selectedIndex,
  total,
  onShift,
  onClose,
}: {
  selectedIndex: number;
  total: number;
  onShift: (delta: number, fromIndex: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [from, setFrom] = useState<"all" | "here">("all");
  const delta = parseOffset(text);
  const valid = delta !== null && delta !== 0;
  const fromIndex = from === "all" ? 0 : Math.max(0, selectedIndex);
  const count = total - fromIndex;
  return (
    <Shell title="Shift timings" onClose={onClose}>
      <p className="modal__lead">Move lines earlier or later, for subtitles timed to a different release of the film.</p>
      <label className="labelled">
        <span>Move by (seconds, minus for earlier)</span>
        <input
          className="field num"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 1.5 or -0:02.250"
          autoFocus
          spellCheck={false}
          aria-invalid={text !== "" && delta === null}
          onKeyDown={(e) => e.key === "Enter" && valid && onShift(delta, fromIndex)}
        />
      </label>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Lines to move">
        <button role="radio" aria-checked={from === "all"} className={from === "all" ? "is-on" : ""} onClick={() => setFrom("all")}>
          Every line
        </button>
        <button
          role="radio"
          aria-checked={from === "here"}
          className={from === "here" ? "is-on" : ""}
          onClick={() => setFrom("here")}
          disabled={selectedIndex < 0}
        >
          From line {selectedIndex + 1} on
        </button>
      </div>
      <p className="tools__note">
        {valid ? (
          <>
            <span className="num">{count.toLocaleString()}</span> {count === 1 ? "line moves" : "lines move"} {delta > 0 ? "later" : "earlier"} by{" "}
            <span className="num">{(Math.abs(delta) / 1000).toFixed(3).replace(/\.?0+$/, "")}s</span>.
          </>
        ) : text && delta === null ? (
          "Type seconds like 1.5, -2 or 0:01.250."
        ) : (
          " "
        )}
      </p>
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={!valid} onClick={() => valid && onShift(delta, fromIndex)}>
          Shift
        </button>
      </div>
    </Shell>
  );
}

export interface ToolItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

export function ToolsMenu({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="toolsmenu" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Tools
      </button>
      {open && (
        <div className="toolsmenu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
