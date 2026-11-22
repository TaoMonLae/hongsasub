import type { SubtitleEvent } from "./api";
import { escapeRegex, fromEditable, leadingTags, plainText, toEditable, visibleLength } from "./text";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export function findPattern(find: string, opts: FindOptions): RegExp | null {
  if (!find) return null;
  const body = escapeRegex(find);
  const source = opts.wholeWord ? `(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])` : body;
  return new RegExp(source, `gu${opts.matchCase ? "" : "i"}`);
}

const MARKUP = /(\{[^}]*\}|<[^>]*>|\\[Nnh])/;

export function replaceInText(text: string, pattern: RegExp, replacement: string): { text: string; count: number } {
  let count = 0;
  const out = text
    .split(MARKUP)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(pattern, () => {
        count += 1;
        return replacement;
      });
    })
    .join("");
  return { text: out, count };
}

export function countInText(text: string, pattern: RegExp): number {
  let count = 0;
  text.split(MARKUP).forEach((part, i) => {
    if (i % 2 === 0) count += part.match(pattern)?.length ?? 0;
  });
  return count;
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cutAtRatio(text: string, ratio: number): [string, string] {
  const spots: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{" || c === "<") depth += 1;
    else if (c === "}" || c === ">") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === " " || (c === "\\" && text[i + 1] === "N"))) spots.push(i);
  }
  if (!spots.length) return [text, ""];
  const goal = text.length * ratio;
  const at = spots.reduce((best, s) => (Math.abs(s - goal) < Math.abs(best - goal) ? s : best), spots[0]);
  const skip = text[at] === "\\" ? 2 : 1;
  return [text.slice(0, at).trimEnd(), text.slice(at + skip).trimStart()];
}

function trimRows(text: string) {
  return text.replace(/^(\\N|\s)+|(\\N|\s)+$/g, "");
}

export function splitEvent(ev: SubtitleEvent, caret: number | null): [SubtitleEvent, SubtitleEvent] {
  const editable = toEditable(ev.text);
  let first: string;
  let second: string;
  if (caret !== null && caret > 0 && caret < editable.length && plainText(ev.text)) {
    first = trimRows(fromEditable(editable.slice(0, caret)));
    second = trimRows(fromEditable(editable.slice(caret)));
  } else if (plainText(ev.text)) {
    [first, second] = cutAtRatio(ev.text, 0.5);
  } else {
    first = ev.text;
    second = "";
  }
  const lead = leadingTags(ev.text);
  if (lead && second && !second.startsWith("{")) second = lead + second;
  const a = visibleLength(first);
  const b = visibleLength(second);
  const ratio = a + b > 0 && plainText(ev.text) ? a / (a + b) : 0.5;
  const mid = Math.round((ev.start + (ev.end - ev.start) * ratio) / 10) * 10;
  const [srcA, srcB] = ev.source.trim() ? cutAtRatio(ev.source, ratio) : [ev.source, ""];
  const status = (t: string) => (plainText(t) ? "draft" : "untranslated") as SubtitleEvent["status"];
  return [
    { ...ev, end: mid, text: first, source: srcA, status: status(first) },
    { ...ev, id: newId(), start: mid, text: second, source: srcB, status: status(second) },
  ];
}

export function mergeEvents(a: SubtitleEvent, b: SubtitleEvent): SubtitleEvent {
  const join = (x: string, y: string, sep: string) => (x.trim() && y.trim() ? `${x}${sep}${y}` : x.trim() ? x : y);
  const text = join(a.text, b.text, "\\N");
  return {
    ...a,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    text,
    source: join(a.source, b.source, "\\N"),
    status: plainText(text) ? "draft" : "untranslated",
  };
}

export function shiftEvents(events: SubtitleEvent[], delta: number, fromIndex: number): SubtitleEvent[] {
  return events.map((e, i) => {
    if (i < fromIndex) return e;
    const start = Math.max(0, e.start + delta);
    return { ...e, start, end: Math.max(start, e.end + delta) };
  });
}

export function parseOffset(text: string): number | null {
  const t = text.trim().replace(",", ".");
  const m = t.match(/^([+-])?\s*(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const parts = [m[2], m[3]].filter((x): x is string => x !== undefined).map(Number);
  const secs = Number(m[4]);
  const total = parts.length === 2 ? parts[0] * 3600 + parts[1] * 60 + secs : parts.length === 1 ? parts[0] * 60 + secs : secs;
  return Math.round(sign * total * 1000);
}
