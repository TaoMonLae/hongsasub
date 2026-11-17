import { cssColor, type StyleFields } from "./styles";

export interface RunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  primary: string;
  outline: string;
  shadow: string;
  font: string;
  size: number;
  border: number;
  depth: number;
}

export interface Run {
  text: string;
  style: RunStyle;
}

export interface Rendered {
  align: number;
  lines: Run[][];
}

export function baseStyle(fields: StyleFields): RunStyle {
  return {
    bold: fields.Bold === "1" || fields.Bold === "-1",
    italic: fields.Italic === "1" || fields.Italic === "-1",
    underline: fields.Underline === "1",
    strike: fields.StrikeOut === "1",
    primary: cssColor(fields.PrimaryColour),
    outline: cssColor(fields.OutlineColour),
    shadow: cssColor(fields.BackColour),
    font: fields.Fontname,
    size: Number(fields.Fontsize) || 48,
    border: Number(fields.Outline) || 0,
    depth: Number(fields.Shadow) || 0,
  };
}

function assHex(value: string) {
  const digits = value.replace(/^&?h/i, "").replace(/&.*$/, "");
  return /^[0-9a-f]+$/i.test(digits) ? `&H00${digits.padStart(6, "0").slice(-6)}` : null;
}

function applyTags(block: string, state: RunStyle, base: RunStyle, setAlign: (n: number) => void): RunStyle {
  const s = { ...state };
  for (const raw of block.split("\\").slice(1)) {
    const tag = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = tag.match(/^an([1-9])$/))) setAlign(Number(m[1]));
    else if (tag === "r" || /^r[^n]/.test(tag)) Object.assign(s, base);
    else if ((m = tag.match(/^fn(.*)$/))) s.font = m[1].trim() || base.font;
    else if ((m = tag.match(/^fs([\d.]*)$/))) s.size = Number(m[1]) || base.size;
    else if ((m = tag.match(/^bord([\d.]*)$/))) s.border = m[1] ? Number(m[1]) : base.border;
    else if ((m = tag.match(/^shad([\d.]*)$/))) s.depth = m[1] ? Number(m[1]) : base.depth;
    else if ((m = tag.match(/^([1-4]?)c((?:&|h).*|)$/i))) {
      const slot = m[1] || "1";
      const hex = assHex(m[2]);
      const css = hex ? cssColor(hex) : null;
      if (slot === "1") s.primary = css ?? base.primary;
      if (slot === "3") s.outline = css ?? base.outline;
      if (slot === "4") s.shadow = css ?? base.shadow;
    } else if ((m = tag.match(/^b(\d*)$/))) s.bold = m[1] ? Number(m[1]) === 1 || Number(m[1]) >= 500 : base.bold;
    else if ((m = tag.match(/^i(\d*)$/))) s.italic = m[1] ? m[1] !== "0" : base.italic;
    else if ((m = tag.match(/^u(\d*)$/))) s.underline = m[1] ? m[1] !== "0" : base.underline;
    else if ((m = tag.match(/^s(\d*)$/))) s.strike = m[1] ? m[1] !== "0" : base.strike;
  }
  return s;
}

function htmlColor(value: string) {
  const v = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(v) ? cssColor(`&H00${v.slice(4, 6)}${v.slice(2, 4)}${v.slice(0, 2)}`) : null;
}

export function renderText(text: string, fields: StyleFields): Rendered {
  const base = baseStyle(fields);
  let align = Number(fields.Alignment) || 2;
  const lines: Run[][] = [[]];
  let state = { ...base };
  const fontStack: RunStyle[] = [];
  const push = (chunk: string) => {
    const parts = chunk.replace(/\\h/g, " ").split(/\\[Nn]|\n/);
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, style: state });
    });
  };
  const pattern = /\{([^}]*)\}|<\s*(\/?)\s*(b|i|u|s|font)\b([^>]*)>/gi;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) push(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      state = applyTags(m[1], state, base, (n) => (align = n));
      continue;
    }
    const closing = m[2] === "/";
    const name = m[3].toLowerCase();
    if (name === "font") {
      if (closing) state = fontStack.pop() ?? state;
      else {
        fontStack.push(state);
        const next = { ...state };
        for (const a of m[4].matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
          const key = a[1].toLowerCase();
          const val = a[2] ?? a[3] ?? a[4] ?? "";
          if (key === "color") next.primary = htmlColor(val) ?? next.primary;
          if (key === "face") next.font = val;
          if (key === "size") next.size = Number(val) || next.size;
        }
        state = next;
      }
      continue;
    }
    const key = ({ b: "bold", i: "italic", u: "underline", s: "strike" } as const)[name as "b" | "i" | "u" | "s"];
    state = { ...state, [key]: !closing };
  }
  if (last < text.length) push(text.slice(last));
  return { align, lines: lines.filter((l, i) => l.length > 0 || i < lines.length - 1) };
}
