import { formatAssColor, parseAssColor, type StyleFields } from "./styles";

export type Mark = "b" | "i" | "u" | "s";
export type ColorSlot = 1 | 2 | 3 | 4;
export type Syntax = "ass" | "html";

export interface Edit {
  value: string;
  start: number;
  end: number;
}

const COLOR_FIELD: Record<ColorSlot, keyof StyleFields> = {
  1: "PrimaryColour",
  2: "SecondaryColour",
  3: "OutlineColour",
  4: "BackColour",
};

function wrap(value: string, start: number, end: number, open: string, close: string): Edit {
  const before = value.slice(0, start);
  const inside = value.slice(start, end);
  const after = value.slice(end);
  if (before.endsWith(open) && after.startsWith(close)) {
    const v = before.slice(0, -open.length) + inside + after.slice(close.length);
    return { value: v, start: start - open.length, end: end - open.length };
  }
  if (inside.startsWith(open) && inside.endsWith(close) && inside.length >= open.length + close.length) {
    const core = inside.slice(open.length, inside.length - close.length);
    return { value: before + core + after, start, end: start + core.length };
  }
  return { value: before + open + inside + close + after, start: start + open.length, end: end + open.length };
}

function recolor(value: string, start: number, end: number, opener: RegExp, open: string, close: string): Edit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const found = before.match(opener);
  if (found && after.startsWith(close)) {
    const head = before.slice(0, before.length - found[0].length) + open;
    return { value: head + value.slice(start, end) + after, start: head.length, end: head.length + (end - start) };
  }
  return wrap(value, start, end, open, close);
}

function block(tags: string) {
  return `{${tags}}`;
}

export function applyMark(value: string, start: number, end: number, mark: Mark, syntax: Syntax, fields: StyleFields): Edit {
  if (syntax === "html") return wrap(value, start, end, `<${mark}>`, `</${mark}>`);
  const styleOn = { b: fields.Bold, i: fields.Italic, u: fields.Underline, s: fields.StrikeOut }[mark] === "1";
  const on = styleOn ? 0 : 1;
  return wrap(value, start, end, block(`\\${mark}${on}`), block(`\\${mark}${1 - on}`));
}

export function applyColor(value: string, start: number, end: number, slot: ColorSlot, hex: string, syntax: Syntax, fields: StyleFields): Edit {
  if (syntax === "html") return recolor(value, start, end, /<font color="#[0-9A-Fa-f]{6}">$/, `<font color="${hex.toUpperCase()}">`, "</font>");
  const color = formatAssColor({ hex, alpha: 0 }, false);
  const base = formatAssColor({ hex: parseAssColor(fields[COLOR_FIELD[slot]]).hex, alpha: 0 }, false);
  return recolor(value, start, end, new RegExp(`\\{\\\\${slot}c&H[0-9A-Fa-f]{6}&\\}$`), block(`\\${slot}c${color}`), block(`\\${slot}c${base}`));
}

export function applyFont(value: string, start: number, end: number, font: string, size: string, syntax: Syntax, fields: StyleFields): Edit {
  const face = font.trim();
  const fs = size.trim();
  if (syntax === "html") {
    const attrs = [face && `face="${face}"`, fs && `size="${fs}"`].filter(Boolean).join(" ");
    return attrs ? wrap(value, start, end, `<font ${attrs}>`, "</font>") : { value, start, end };
  }
  const open = `${face ? `\\fn${face}` : ""}${fs ? `\\fs${fs}` : ""}`;
  const close = `${face ? `\\fn${fields.Fontname}` : ""}${fs ? `\\fs${fields.Fontsize}` : ""}`;
  return open ? wrap(value, start, end, block(open), block(close)) : { value, start, end };
}

export function styleColorHex(fields: StyleFields, slot: ColorSlot) {
  return parseAssColor(fields[COLOR_FIELD[slot]]).hex;
}
