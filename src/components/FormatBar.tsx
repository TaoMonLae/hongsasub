import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { applyColor, applyFont, applyMark, styleColorHex, type ColorSlot, type Edit, type Mark, type Syntax } from "../lib/format";
import { MOD } from "../lib/keys";
import type { StyleFields } from "../lib/styles";
import { useFonts as useLoadedFonts } from "../lib/fonts";

type Apply = (fn: (value: string, start: number, end: number) => Edit) => void;

interface Props {
  syntax: Syntax;
  fields: StyleFields;
  onApply: Apply;
  onStyles: () => void;
}

const MARKS: { mark: Mark; label: string; title: string; key?: string }[] = [
  { mark: "b", label: "B", title: "Bold", key: "B" },
  { mark: "i", label: "I", title: "Italic", key: "I" },
  { mark: "u", label: "U", title: "Underline", key: "U" },
  { mark: "s", label: "S", title: "Strikethrough" },
];

const COLORS: { slot: ColorSlot; title: string }[] = [
  { slot: 1, title: "Text colour" },
  { slot: 2, title: "Karaoke colour" },
  { slot: 3, title: "Outline colour" },
  { slot: 4, title: "Shadow colour" },
];

export function useFonts(enabled: boolean) {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .listFonts()
      .then((list) => {
        if (!cancelled) setFonts(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return fonts;
}

export function FontPicker({ value, onChange, id, autoFocus }: { value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean }) {
  const fonts = useFonts(true);
  return (
    <>
      <input
        id={id}
        className="control"
        list={`${id}-list`}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder="Font name"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-list`}>
        {fonts.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}

function FontPopover({ fields, onPick, onClose }: { fields: StyleFields; onPick: (font: string, size: string) => void; onClose: () => void }) {
  const [font, setFont] = useState(fields.Fontname);
  const [size, setSize] = useState(fields.Fontsize);
  const ref = useRef<HTMLDivElement>(null);
  useLoadedFonts([font]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current && !ref.current.contains(t) && !t.closest?.(".fmtbar__btn--fn")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const submit = () => {
    onPick(font === fields.Fontname ? "" : font, size === fields.Fontsize ? "" : size);
    onClose();
  };
  return (
    <div className="fontpop" ref={ref} role="dialog" aria-label="Font">
      <label className="fontpop__row">
        <span>Font</span>
        <FontPicker id="fontpop-font" value={font} onChange={setFont} autoFocus />
      </label>
      <label className="fontpop__row">
        <span>Size</span>
        <input
          className="control num fontpop__size"
          type="number"
          min={1}
          value={size}
          onChange={(e) => setSize(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </label>
      <p className="fontpop__preview" style={{ fontFamily: `"${font}", var(--font-mon)` }}>
        မန် Mon Aa
      </p>
      <div className="fontpop__actions">
        <button className="btn btn--small" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn--small btn--primary" onClick={submit}>
          Apply to selection
        </button>
      </div>
    </div>
  );
}

export function FormatBar({ syntax, fields, onApply, onStyles }: Props) {
  const [fontOpen, setFontOpen] = useState(false);
  const pending = useRef<ColorSlot>(1);
  const picker = useRef<HTMLInputElement>(null);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const colors = syntax === "html" ? COLORS.slice(0, 1) : COLORS;
  const latest = useRef({ onApply, syntax, fields });
  latest.current = { onApply, syntax, fields };

  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const onChange = () => {
      const { onApply: apply, syntax: sx, fields: f } = latest.current;
      const hex = input.value;
      apply((v, s, en) => applyColor(v, s, en, pending.current, hex, sx, f));
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="fmtbar" role="toolbar" aria-label="Text formatting">
      <div className="fmtbar__group">
        {MARKS.map(({ mark, label, title, key }) => (
          <button
            key={mark}
            className={`fmtbar__btn fmtbar__btn--${mark}`}
            onMouseDown={keep}
            onClick={() => onApply((v, s, e) => applyMark(v, s, e, mark, syntax, fields))}
            title={key ? `${title}  ${MOD}${key}` : title}
            aria-label={title}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="fmtbar__group fmtbar__font">
        <button className="fmtbar__btn fmtbar__btn--fn" onMouseDown={keep} onClick={() => setFontOpen((o) => !o)} title="Font and size for the selection" aria-label="Font" aria-expanded={fontOpen}>
          fn
        </button>
        {fontOpen && (
          <FontPopover
            fields={fields}
            onClose={() => setFontOpen(false)}
            onPick={(font, size) => onApply((v, s, e) => applyFont(v, s, e, font, size, syntax, fields))}
          />
        )}
      </div>
      <div className="fmtbar__group">
        {colors.map(({ slot, title }) => (
          <button
            key={slot}
            className="fmtbar__btn fmtbar__color"
            onMouseDown={keep}
            onClick={() => {
              pending.current = slot;
              const input = picker.current;
              if (!input) return;
              input.value = styleColorHex(fields, slot).toLowerCase();
              input.click();
            }}
            title={title}
            aria-label={title}
          >
            <span className={`fmtbar__swatch fmtbar__swatch--${slot}`} style={{ ["--swatch" as string]: styleColorHex(fields, slot) }}>
              A
            </span>
          </button>
        ))}
        <input
          ref={picker}
          type="color"
          className="fmtbar__picker"
          tabIndex={-1}
          aria-hidden
        />
      </div>
      <span className="spacer" />
      <button className="btn btn--plain btn--small" onMouseDown={keep} onClick={onStyles} title="Create and edit styles">
        Styles…
      </button>
    </div>
  );
}
