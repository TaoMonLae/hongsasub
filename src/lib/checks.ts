import type { GlossaryTerm, SubtitleEvent } from "./api";
import { cps, escapeRegex, isMon, plainText, shownText, stripTags, visibleLength } from "./text";

export type Severity = "error" | "warn";

export type Rule =
  | "timing"
  | "speed"
  | "length"
  | "lines"
  | "short"
  | "long"
  | "overlap"
  | "gap"
  | "spaces"
  | "tags"
  | "empty"
  | "language"
  | "numbers"
  | "glossary"
  | "spelling";

export interface Issue {
  key: string;
  id: string;
  index: number;
  rule: Rule;
  severity: Severity;
  message: string;
  fix?: { label: string; patch: Partial<SubtitleEvent> };
}

export interface Limits {
  cps: number;
  chars: number;
  lines: number;
  minDuration: number;
  maxDuration: number;
  minGap: number;
}

export const DEFAULT_LIMITS: Limits = {
  cps: 17,
  chars: 42,
  lines: 2,
  minDuration: 833,
  maxDuration: 7000,
  minGap: 84,
};

const LIMITS_KEY = "hongsasub.checkLimits";

export function loadLimits(): Limits {
  try {
    const raw = localStorage.getItem(LIMITS_KEY);
    if (!raw) return { ...DEFAULT_LIMITS };
    const saved = JSON.parse(raw) as Partial<Limits>;
    const out = { ...DEFAULT_LIMITS };
    for (const k of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
      const v = Number(saved[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

export function storeLimits(limits: Limits) {
  try {
    localStorage.setItem(LIMITS_KEY, JSON.stringify(limits));
  } catch {
    return;
  }
}

export const RULE_LABELS: Record<Rule, string> = {
  timing: "Timing",
  speed: "Reading speed",
  length: "Line length",
  lines: "Line count",
  short: "Too short",
  long: "Too long",
  overlap: "Overlap",
  gap: "Small gap",
  spaces: "Spaces",
  tags: "Tags",
  empty: "Empty",
  language: "Language",
  numbers: "Numbers",
  glossary: "Glossary",
  spelling: "Spelling",
};

function glossaryMatcher(terms: GlossaryTerm[]) {
  const bySource = new Map<string, { source: string; targets: string[] }>();
  for (const t of terms) {
    const key = t.source.trim().toLowerCase();
    const target = plainText(t.target);
    if (!key || !target) continue;
    const entry = bySource.get(key) ?? { source: t.source.trim(), targets: [] };
    if (!entry.targets.includes(target)) entry.targets.push(target);
    bySource.set(key, entry);
  }
  if (!bySource.size) return null;
  const keys = [...bySource.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${keys.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return (source: string, target: string): string[] => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const m of plainText(source).matchAll(pattern)) {
      const key = m[1].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = bySource.get(key);
      if (entry && !entry.targets.some((t) => target.includes(t))) missing.push(`“${entry.source}” is usually ${entry.targets.map((t) => `“${t}”`).join(" or ")}`);
    }
    return missing;
  };
}

function seconds(ms: number) {
  return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")}s`;
}

const LEAD_TAGS = /^((?:\{[^}]*\})*)[ \t ]+/;
const TRAIL_TAGS = /[ \t ]+((?:\{[^}]*\})*)$/;

export function tidySpaces(text: string): string {
  const out: string[] = [];
  let carry = "";
  for (const raw of text.split("\\N")) {
    const seg = raw.replace(/(?<=\S) {2,}(?=\S)/g, " ").replace(LEAD_TAGS, "$1").replace(TRAIL_TAGS, "$1");
    if (plainText(seg)) {
      out.push(carry + seg);
      carry = "";
    } else {
      const tags = (seg.match(/\{[^}]*\}/g) ?? []).join("");
      if (out.length) out[out.length - 1] += tags;
      else carry += tags;
    }
  }
  return out.length ? out.join("\\N") : text;
}

function tagProblem(text: string): string | null {
  let depth = 0;
  for (const c of text) {
    if (c === "{") {
      if (depth > 0) return "A “{” tag block is opened twice";
      depth = 1;
    } else if (c === "}") {
      if (depth === 0) return "A “}” has no matching “{”";
      depth = 0;
    }
  }
  if (depth > 0) return "A “{” tag block is never closed";
  const open: string[] = [];
  for (const m of text.replace(/\{[^}]*\}/g, "").matchAll(/<\s*(\/?)\s*(b|i|u|s|font)\b[^>]*>/gi)) {
    const name = m[2].toLowerCase();
    if (!m[1]) open.push(name);
    else if (open[open.length - 1] === name) open.pop();
    else return `“</${name}>” closes a tag that is not open`;
  }
  if (open.length) return `“<${open[open.length - 1]}>” is never closed`;
  return null;
}

function numbers(text: string): string[] {
  const western = plainText(text).replace(/[၀-၉]/g, (d) => String(d.charCodeAt(0) - 0x1040));
  return (western.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, "")).sort();
}

function alignment(ev: SubtitleEvent, styleAlign: (style: string) => number): number {
  const text = plainText(ev.text) ? shownText(ev.text, ev.source) : ev.source;
  const tags = [...text.matchAll(/\\an([1-9])/g)];
  return tags.length ? Number(tags[tags.length - 1][1]) : styleAlign(ev.style);
}

function band(align: number) {
  return align >= 7 ? "top" : align >= 4 ? "middle" : "bottom";
}

export function runChecks(
  events: SubtitleEvent[],
  limits: Limits,
  translating: boolean,
  styleAlign: (style: string) => number,
  glossary: GlossaryTerm[] = [],
  spelling: (ev: SubtitleEvent) => string[] | undefined = () => undefined,
): Issue[] {
  const issues: Issue[] = [];
  const glossaryCheck = translating ? glossaryMatcher(glossary) : null;
  const indexById = new Map(events.map((e, i) => [e.id, i]));
  const add = (ev: SubtitleEvent, rule: Rule, severity: Severity, message: string, fix?: Issue["fix"]) =>
    issues.push({ key: `${ev.id}:${rule}`, id: ev.id, index: indexById.get(ev.id) ?? 0, rule, severity, message, fix });

  const dialogue = events.filter((e) => e.kind === "dialogue");
  const timeline = [...dialogue].sort((a, b) => a.start - b.start || a.end - b.end);
  const nextById = new Map<string, SubtitleEvent>();
  const overlapById = new Map<string, SubtitleEvent>();
  const lanes = new Map<string, SubtitleEvent[]>();
  for (const ev of timeline) {
    const lane = `${ev.layer}:${band(alignment(ev, styleAlign))}`;
    const list = lanes.get(lane) ?? [];
    list.push(ev);
    lanes.set(lane, list);
  }
  for (const list of lanes.values()) {
    list.forEach((ev, i) => {
      const next = list[i + 1];
      if (next) nextById.set(ev.id, next);
      for (let j = i + 1; j < list.length && list[j].start < ev.end; j += 1) {
        overlapById.set(ev.id, list[j]);
        break;
      }
    });
  }

  for (const ev of dialogue) {
    const text = ev.text;
    const plain = plainText(text);
    const duration = ev.end - ev.start;
    const next = nextById.get(ev.id);
    const nextStart = next ? next.start : Infinity;

    if (duration <= 0) add(ev, "timing", "error", duration === 0 ? "Starts and ends at the same time" : "Ends before it starts");

    if (!plain) {
      if (!translating && !stripTags(text).trim()) add(ev, "empty", "warn", "Has no text, so it is left out when saved as SRT");
      continue;
    }

    const tag = tagProblem(text);
    if (tag) add(ev, "tags", "error", tag);

    if (duration > 0) {
      const rate = cps(text, ev.start, ev.end);
      if (rate > limits.cps) {
        const needed = Math.ceil((visibleLength(text) / limits.cps) * 1000);
        const room = Math.min(ev.start + needed, nextStart - limits.minGap);
        add(
          ev,
          "speed",
          rate > limits.cps * 1.5 ? "error" : "warn",
          `${rate.toFixed(1)} characters a second, over ${limits.cps}`,
          room > ev.end ? { label: room >= ev.start + needed ? "Lengthen" : "Lengthen to next line", patch: { end: room } } : undefined,
        );
      }
      if (duration < limits.minDuration) {
        const room = Math.min(ev.start + limits.minDuration, nextStart - limits.minGap);
        add(
          ev,
          "short",
          "warn",
          `On screen for ${seconds(duration)}, under ${seconds(limits.minDuration)}`,
          room > ev.end ? { label: "Lengthen", patch: { end: room } } : undefined,
        );
      }
      if (duration > limits.maxDuration) {
        add(ev, "long", "warn", `On screen for ${seconds(duration)}, over ${seconds(limits.maxDuration)}`, {
          label: "Shorten",
          patch: { end: ev.start + limits.maxDuration },
        });
      }
    }

    const rows = text.split("\\N").map((seg) => visibleLength(seg));
    const widest = Math.max(...rows);
    if (widest > limits.chars) add(ev, "length", "warn", `A row has ${widest} characters, over ${limits.chars}`);
    const filled = rows.filter((n) => n > 0).length;
    if (filled > limits.lines) add(ev, "lines", "warn", `${filled} rows of text, over ${limits.lines}`);

    const overlap = overlapById.get(ev.id);
    if (overlap) {
      const at = indexById.get(overlap.id) ?? 0;
      add(
        ev,
        "overlap",
        "warn",
        `Overlaps line ${at + 1} by ${seconds(ev.end - overlap.start)}`,
        overlap.start > ev.start ? { label: `End at line ${at + 1}`, patch: { end: overlap.start } } : undefined,
      );
    } else if (next) {
      const gap = next.start - ev.end;
      if (gap > 0 && gap < limits.minGap) {
        const at = indexById.get(next.id) ?? 0;
        add(ev, "gap", "warn", `Only ${gap} ms before line ${at + 1}, so the picture flickers`, {
          label: "Close the gap",
          patch: { end: next.start },
        });
      }
    }

    const unknown = spelling(ev);
    if (unknown && unknown.length) {
      const list = [...new Set(unknown)];
      add(ev, "spelling", "warn", `Not in the dictionary: ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""}`);
    }

    const tidy = tidySpaces(text);
    if (tidy !== text) add(ev, "spaces", "warn", "Extra spaces or empty rows", { label: "Tidy", patch: { text: tidy } });

    if (translating && ev.source.trim()) {
      if (!isMon(plain) && /[A-Za-z]{2}/.test(plain)) add(ev, "language", "warn", "Has no Mon text");
      const a = numbers(ev.source);
      const b = numbers(text);
      if (a.join(" ") !== b.join(" ")) {
        const missing = a.filter((n) => !b.includes(n));
        const extra = b.filter((n) => !a.includes(n));
        if (missing.length || extra.length) {
          const parts = [missing.length && `English has ${missing.join(", ")}`, extra.length && `Mon has ${extra.join(", ")}`].filter(Boolean);
          add(ev, "numbers", "warn", `Numbers differ: ${parts.join("; ")}`);
        }
      }
      const missing = glossaryCheck ? glossaryCheck(ev.source, plain) : [];
      if (missing.length) add(ev, "glossary", "warn", `Glossary: ${missing.join("; ")}`);
    }
  }

  return issues.sort((a, b) => a.index - b.index || (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}
