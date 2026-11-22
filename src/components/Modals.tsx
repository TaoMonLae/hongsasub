import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type CommitRequest, type OpenMode, type PairFlag, type PairingPreview } from "../lib/api";
import { fileName, plainText } from "../lib/text";
import { formatTime } from "../lib/time";

export function Shell({ title, children, onClose, wide, cardClass }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; cardClass?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={wide ? undefined : onClose}>
      <div className={`modal__card${wide ? " modal__card--review" : ""}${cardClass ? ` ${cardClass}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function OpenModeModal({ path, onPick, onClose }: { path: string; onPick: (mode: OpenMode) => void; onClose: () => void }) {
  return (
    <Shell title="How should this file open?" onClose={onClose}>
      <p className="modal__file">{fileName(path)}</p>
      <div className="choice">
        <button className="choice__item" autoFocus onClick={() => onPick("translate")}>
          <b>Translate into Mon</b>
          <span>The file's text becomes the English source. You type Mon beside it, and every confirmed line is remembered.</span>
        </button>
        <button className="choice__item" onClick={() => onPick("edit")}>
          <b>Edit as it is</b>
          <span>For a Mon subtitle you already made. Fix timing and wording without an English source.</span>
        </button>
      </div>
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

export function ExportModal({
  translating,
  onExport,
  onClose,
}: {
  translating: boolean;
  onExport: (format: "ass" | "srt", fallback: boolean) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<"ass" | "srt">("ass");
  const [fallback, setFallback] = useState(false);
  return (
    <Shell title="Export subtitles" onClose={onClose}>
      <div className="segmented segmented--wide" role="radiogroup" aria-label="Format">
        <button role="radio" aria-checked={format === "ass"} className={format === "ass" ? "is-on" : ""} onClick={() => setFormat("ass")}>
          ASS <em>styles, positions</em>
        </button>
        <button role="radio" aria-checked={format === "srt"} className={format === "srt" ? "is-on" : ""} onClick={() => setFormat("srt")}>
          SRT <em>plain, plays anywhere</em>
        </button>
      </div>
      {translating && (
        <label className="check">
          <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />
          <span>Fill lines I haven't translated with the English text</span>
        </label>
      )}
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={() => onExport(format, fallback)}>
          Choose location…
        </button>
      </div>
    </Shell>
  );
}

const SUBTITLE_FILTER = [{ name: "Subtitles", extensions: ["ass", "ssa", "srt"] }];

const FLAG_TEXT: Record<PairFlag, string> = {
  merged: "Joins 2+ English lines",
  split: "English line used twice",
  lowOverlap: "Timing only partly overlaps",
  numbers: "Numbers differ",
  untranslated: "Same as English",
  long: "Longer than 7s",
};

const DOUBTFUL: PairFlag[] = ["merged", "split", "lowOverlap", "numbers", "untranslated"];

function doubtful(flags: PairFlag[]) {
  return flags.some((f) => DOUBTFUL.includes(f));
}

function ReviewPairs({
  preview,
  work,
  onBack,
  onCommit,
  onClose,
}: {
  preview: PairingPreview;
  work: string;
  onBack: () => void;
  onCommit: (pairs: CommitRequest[]) => Promise<void>;
  onClose: () => void;
}) {
  const flaggedCount = useMemo(() => preview.pairs.filter((p) => doubtful(p.flags)).length, [preview]);
  const [keep, setKeep] = useState<boolean[]>(() => preview.pairs.map((p) => !doubtful(p.flags)));
  const [filter, setFilter] = useState<"flagged" | "all">(flaggedCount > 0 ? "flagged" : "all");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const shown = useMemo(
    () => preview.pairs.map((p, i) => ({ p, i })).filter(({ p }) => filter === "all" || doubtful(p.flags)),
    [preview, filter],
  );
  const kept = keep.filter(Boolean).length;
  const setAll = (on: boolean) => setKeep((k) => k.map((v, i) => (doubtful(preview.pairs[i].flags) ? on : v)));
  const toggle = (i: number) => setKeep((k) => k.map((v, j) => (j === i ? !v : v)));

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const boxes = Array.from(listRef.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? []);
    const at = boxes.indexOf(document.activeElement as HTMLInputElement);
    const next = boxes[Math.max(0, Math.min(boxes.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.closest("li")?.scrollIntoView({ block: "nearest" });
  };

  const commit = async () => {
    setBusy(true);
    const pairs = preview.pairs
      .filter((_, i) => keep[i])
      .map((p) => ({ source: p.source, target: p.target, prev: p.prev, next: p.next, work }));
    await onCommit(pairs);
    setBusy(false);
  };

  return (
    <Shell title={`Check pairs${work ? ` from ${work}` : ""}`} onClose={onClose} wide>
      <p className="modal__lead">
        Lines were paired by timing. Pairs that look off start unticked, so they stay out of memory unless you tick them.
        {preview.unmatchedTargets > 0 && ` ${preview.unmatchedTargets.toLocaleString()} Mon lines had no English line at the same time and were left out.`}
      </p>
      <div className="review__bar">
        <div className="segmented segmented--small" role="radiogroup" aria-label="Show">
          <button role="radio" aria-checked={filter === "flagged"} className={filter === "flagged" ? "is-on" : ""} onClick={() => setFilter("flagged")}>
            Needs a look <em>{flaggedCount.toLocaleString()}</em>
          </button>
          <button role="radio" aria-checked={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
            All <em>{preview.pairs.length.toLocaleString()}</em>
          </button>
        </div>
        {flaggedCount > 0 && (
          <div className="review__bulk">
            <button className="btn btn--plain btn--small" onClick={() => setAll(true)}>
              Keep all flagged
            </button>
            <button className="btn btn--plain btn--small" onClick={() => setAll(false)}>
              Skip all flagged
            </button>
          </div>
        )}
        <span className="review__hint">↑↓ move · Space keeps or skips</span>
      </div>
      {shown.length === 0 ? (
        <p className="empty review__empty">Nothing needs a look. Every pair lined up cleanly.</p>
      ) : (
        <ul className="review__list" ref={listRef} onKeyDown={onKeyDown} aria-label="Paired lines">
          {shown.map(({ p, i }) => (
            <li key={i} className={`review__row${keep[i] ? "" : " is-skipped"}`}>
              <label>
                <input type="checkbox" checked={keep[i]} onChange={() => toggle(i)} aria-label={`Keep pair at ${formatTime(p.start)}`} />
                <span className="num review__time">{formatTime(p.start)}</span>
                <span className="review__en">{plainText(p.source)}</span>
                <span className="review__mon mon">{plainText(p.target)}</span>
                <span className="review__flags">
                  {p.flags.map((f) => (
                    <span key={f} className={`review__flag${DOUBTFUL.includes(f) ? " is-doubt" : ""}`}>
                      {FLAG_TEXT[f]}
                    </span>
                  ))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="modal__actions review__actions">
        <span className="review__count">
          <span className="num">{kept.toLocaleString()}</span> to add · <span className="num">{(preview.pairs.length - kept).toLocaleString()}</span> skipped
        </span>
        <button className="btn" onClick={onBack}>
          Back
        </button>
        <button className="btn btn--primary" disabled={kept === 0 || busy} onClick={commit}>
          {busy ? "Adding…" : `Add ${kept.toLocaleString()} to memory`}
        </button>
      </div>
    </Shell>
  );
}

export function ImportModal({
  onCommit,
  onClose,
}: {
  onCommit: (pairs: CommitRequest[]) => Promise<void>;
  onClose: () => void;
}) {
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [work, setWork] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PairingPreview | null>(null);

  const pick = async (set: (p: string) => void, guessWork: boolean) => {
    const p = await open({ filters: SUBTITLE_FILTER });
    if (typeof p !== "string") return;
    set(p);
    setError(null);
    if (guessWork && !work) setWork(fileName(p).replace(/\.[^.]+$/, "").replace(/[._-]+/g, " "));
  };

  const check = async () => {
    if (!sourcePath || !targetPath) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.previewPair(sourcePath, targetPath);
      if (result.pairs.length === 0) setError("No lines matched by timing. Check that both files are timed to the same video.");
      else setPreview(result);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  if (preview) return <ReviewPairs preview={preview} work={work.trim()} onBack={() => setPreview(null)} onCommit={onCommit} onClose={onClose} />;

  return (
    <Shell title="Teach memory from finished work" onClose={onClose}>
      <p className="modal__lead">
        Pick the original English subtitle and your finished Mon subtitle for the same film. Lines are paired by their timing, so both
        files must be timed to the same video. You'll check the pairs before anything is saved.
      </p>
      <div className="pick">
        <button className="pick__item" onClick={() => pick(setSourcePath, true)}>
          <span className="pick__label">English subtitle</span>
          <b>{sourcePath ? fileName(sourcePath) : "Choose file…"}</b>
        </button>
        <button className="pick__item" onClick={() => pick(setTargetPath, false)}>
          <span className="pick__label">Mon subtitle</span>
          <b>{targetPath ? fileName(targetPath) : "Choose file…"}</b>
        </button>
      </div>
      <label className="labelled">
        <span>Film or episode title</span>
        <input className="field" value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Spirited Away" />
      </label>
      {error && <p className="review__error" role="alert">{error}</p>}
      <div className="modal__actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--primary" disabled={!sourcePath || !targetPath || busy} onClick={check}>
          {busy ? "Pairing…" : "Check pairs"}
        </button>
      </div>
    </Shell>
  );
}
