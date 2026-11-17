export function toEditable(ass: string): string {
  return ass.replace(/\\N/g, "\n");
}

export function fromEditable(text: string): string {
  return text.replace(/\r\n|\n/g, "\\N");
}

export function stripTags(text: string): string {
  return text.replace(/\{[^}]*\}/g, "").replace(/<[^>]*>/g, "");
}

export function plainText(ass: string): string {
  return stripTags(ass).replace(/\\[Nn]/g, " ").replace(/\\h/g, " ").replace(/\s+/g, " ").trim();
}

export function displayLines(ass: string): string {
  return stripTags(ass).replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
}

const MON_RANGE = /[က-႟ꧠ-꧿ꩠ-ꩿ]/;

export function isMon(text: string): boolean {
  return MON_RANGE.test(text);
}

export function visibleLength(ass: string): number {
  const plain = plainText(ass);
  let count = 0;
  for (const ch of plain) {
    if (ch === " ") continue;
    const code = ch.codePointAt(0) ?? 0;
    const combining =
      (code >= 0x102b && code <= 0x103e) ||
      (code >= 0x1056 && code <= 0x1059) ||
      (code >= 0x105e && code <= 0x1060) ||
      (code >= 0x1062 && code <= 0x1064) ||
      (code >= 0x1067 && code <= 0x106d) ||
      (code >= 0x1071 && code <= 0x1074) ||
      (code >= 0x1082 && code <= 0x108d) ||
      code === 0x108f ||
      (code >= 0x109a && code <= 0x109d) ||
      code === 0x1039;
    if (!combining) count += 1;
  }
  return count;
}

export function cps(ass: string, start: number, end: number): number {
  const seconds = Math.max(0.001, (end - start) / 1000);
  return visibleLength(ass) / seconds;
}

export function insertAt(value: string, selectionStart: number, selectionEnd: number, insert: string) {
  const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
  return { value: next, caret: selectionStart + insert.length };
}

export function leadingTags(text: string): string {
  return text.match(/^(?:\{[^}]*\})+/)?.[0] ?? "";
}

export function shownText(text: string, source: string): string {
  if (!plainText(text)) return text;
  const tags = leadingTags(source);
  if (!tags) return text;
  if (!text.startsWith("{")) return tags + text;
  if (/\\(an[1-9]|pos\()/.test(text)) return text;
  const an = [...tags.matchAll(/\\an([1-9])/g)].pop();
  return an ? `{\\an${an[1]}}${text}` : text;
}
