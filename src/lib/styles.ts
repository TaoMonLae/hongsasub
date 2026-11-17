import type { Style, SubtitleDocument } from "./api";

export const STYLE_FORMAT = [
  "Name",
  "Fontname",
  "Fontsize",
  "PrimaryColour",
  "SecondaryColour",
  "OutlineColour",
  "BackColour",
  "Bold",
  "Italic",
  "Underline",
  "StrikeOut",
  "ScaleX",
  "ScaleY",
  "Spacing",
  "Angle",
  "BorderStyle",
  "Outline",
  "Shadow",
  "Alignment",
  "MarginL",
  "MarginR",
  "MarginV",
  "Encoding",
] as const;

export type StyleField = (typeof STYLE_FORMAT)[number];
export type StyleFields = Record<StyleField, string>;

export const DEFAULT_FIELDS: StyleFields = {
  Name: "Default",
  Fontname: "Noto Sans Myanmar",
  Fontsize: "64",
  PrimaryColour: "&H00FFFFFF",
  SecondaryColour: "&H000000FF",
  OutlineColour: "&H00000000",
  BackColour: "&H80000000",
  Bold: "0",
  Italic: "0",
  Underline: "0",
  StrikeOut: "0",
  ScaleX: "100",
  ScaleY: "100",
  Spacing: "0",
  Angle: "0",
  BorderStyle: "1",
  Outline: "3",
  Shadow: "1",
  Alignment: "2",
  MarginL: "60",
  MarginR: "60",
  MarginV: "48",
  Encoding: "1",
};

const SSA_ALIGN_TO_ASS: Record<string, string> = { "1": "1", "2": "2", "3": "3", "9": "4", "10": "5", "11": "6", "5": "7", "6": "8", "7": "9" };
const ASS_ALIGN_TO_SSA: Record<string, string> = Object.fromEntries(Object.entries(SSA_ALIGN_TO_ASS).map(([k, v]) => [v, k]));

function formatOf(format: string[]): string[] {
  return format.length ? format : [...STYLE_FORMAT];
}

export function isSsaFormat(format: string[]) {
  return format.some((f) => f.toLowerCase() === "tertiarycolour");
}

export function readFields(style: Style, format: string[]): StyleFields {
  const cols = formatOf(format).map((c) => c.toLowerCase());
  const fields: StyleFields = { ...DEFAULT_FIELDS, Name: style.name };
  for (const key of STYLE_FORMAT) {
    const alias = key === "OutlineColour" && !cols.includes("outlinecolour") ? "tertiarycolour" : key.toLowerCase();
    const at = cols.indexOf(alias);
    if (at >= 0 && style.values[at] !== undefined) fields[key] = style.values[at].trim();
  }
  if (isSsaFormat(format)) fields.Alignment = SSA_ALIGN_TO_ASS[fields.Alignment] ?? "2";
  if (fields.Bold === "-1") fields.Bold = "1";
  if (fields.Italic === "-1") fields.Italic = "1";
  return fields;
}

export function writeFields(fields: StyleFields, format: string[]): Style {
  const ssa = isSsaFormat(format);
  const values = formatOf(format).map((col) => {
    const lower = col.toLowerCase();
    if (lower === "tertiarycolour") return fields.OutlineColour;
    if (lower === "alignment" && ssa) return ASS_ALIGN_TO_SSA[fields.Alignment] ?? "2";
    if ((lower === "bold" || lower === "italic") && ssa) return fields[col as StyleField] === "1" ? "-1" : "0";
    if (lower === "alphalevel") return "0";
    const key = STYLE_FORMAT.find((k) => k.toLowerCase() === lower);
    return key ? fields[key] : "0";
  });
  return { name: fields.Name, values };
}

export function toStandard(style: Style, format: string[]): Style {
  return writeFields(readFields(style, format), [...STYLE_FORMAT]);
}

export function fromStandard(style: Style, format: string[]): Style {
  return writeFields(readFields(style, [...STYLE_FORMAT]), format);
}

export function documentFields(doc: SubtitleDocument, name: string): StyleFields {
  const style = doc.styles.find((s) => s.name === name) ?? doc.styles.find((s) => s.name === "Default") ?? doc.styles[0];
  return style ? readFields(style, doc.styleFormat) : { ...DEFAULT_FIELDS };
}

export function playRes(doc: SubtitleDocument): { x: number; y: number } {
  const read = (key: string) => {
    const line = doc.scriptInfo.find((l) => l.toLowerCase().replace(/\s/g, "").startsWith(`${key.toLowerCase()}:`));
    const n = line ? Number(line.split(":")[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const y = read("PlayResY") ?? (read("PlayResX") ? Math.round((read("PlayResX") as number) * 0.75) : 288);
  const x = read("PlayResX") ?? Math.round((y * 4) / 3);
  return { x, y };
}

export interface AssColor {
  hex: string;
  alpha: number;
}

export function parseAssColor(value: string): AssColor {
  const digits = value.trim().replace(/^&?h/i, "").replace(/&$/, "");
  const n = /^[0-9a-f]+$/i.test(digits) ? digits.padStart(8, "0").slice(-8) : "00FFFFFF";
  const alpha = parseInt(n.slice(0, 2), 16);
  const bb = n.slice(2, 4);
  const gg = n.slice(4, 6);
  const rr = n.slice(6, 8);
  return { hex: `#${rr}${gg}${bb}`.toUpperCase(), alpha };
}

export function formatAssColor({ hex, alpha }: AssColor, withAlpha = true): string {
  const h = hex.replace("#", "").padStart(6, "0").toUpperCase();
  const bgr = `${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
  const a = Math.max(0, Math.min(255, Math.round(alpha))).toString(16).padStart(2, "0").toUpperCase();
  return withAlpha ? `&H${a}${bgr}` : `&H${bgr}&`;
}

export function cssColor(value: string): string {
  const { hex, alpha } = parseAssColor(value);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${((255 - alpha) / 255).toFixed(3)})`;
}

export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
