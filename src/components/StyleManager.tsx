import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type Style, type StyleLibrary } from "../lib/api";
import {
  DEFAULT_FIELDS,
  STYLE_FORMAT,
  formatAssColor,
  fromStandard,
  parseAssColor,
  readFields,
  toStandard,
  uniqueName,
  writeFields,
  type StyleField,
  type StyleFields,
} from "../lib/styles";
import { Caption } from "./Caption";
import { FontPicker } from "./FormatBar";

const STANDARD = [...STYLE_FORMAT];
const DEFAULT_CATALOG = "Default";

export interface StyleChange {
  styles: Style[];
  renames: Record<string, string>;
}

interface Props {
  styles: Style[];
  styleFormat: string[];
  usage: Record<string, number>;
  srt: boolean;
  playResX: number;
  onChange: (change: StyleChange) => void;
  onNotify: (text: string, tone?: "ok" | "error") => void;
  onClose: () => void;
}

type Side = "storage" | "script";

function emptyLibrary(): StyleLibrary {
  return { current: DEFAULT_CATALOG, catalogs: { [DEFAULT_CATALOG]: [writeFields(DEFAULT_FIELDS, STANDARD)] } };
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

function OrderButtons({ index, count, onMove, onSort }: { index: number; count: number; onMove: (to: number) => void; onSort: () => void }) {
  const none = index < 0;
  return (
    <div className="stylemgr__order" role="group" aria-label="Order">
      <button className="icon-btn icon-btn--small" disabled={none || index === 0} onClick={() => onMove(index - 1)} title="Move up" aria-label="Move up">
        ▲
      </button>
      <button className="icon-btn icon-btn--small" disabled={none || index === count - 1} onClick={() => onMove(index + 1)} title="Move down" aria-label="Move down">
        ▼
      </button>
      <button className="icon-btn icon-btn--small" disabled={none || index === 0} onClick={() => onMove(0)} title="Move to top" aria-label="Move to top">
        ⤒
      </button>
      <button className="icon-btn icon-btn--small" disabled={none || index === count - 1} onClick={() => onMove(count - 1)} title="Move to bottom" aria-label="Move to bottom">
        ⤓
      </button>
      <button className="icon-btn icon-btn--small" disabled={count < 2} onClick={onSort} title="Sort by name" aria-label="Sort by name">
        A–Z
      </button>
    </div>
  );
}

function StyleList({
  label,
  names,
  selected,
  usage,
  onSelect,
  onOpen,
}: {
  label: string;
  names: string[];
  selected: number;
  usage?: Record<string, number>;
  onSelect: (i: number) => void;
  onOpen: (i: number) => void;
}) {
  return (
    <ul className="stylemgr__list" role="listbox" aria-label={label} tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onSelect(Math.min(names.length - 1, selected + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onSelect(Math.max(0, selected - 1));
        } else if (e.key === "Enter" && selected >= 0) {
          e.preventDefault();
          onOpen(selected);
        }
      }}
    >
      {names.map((name, i) => (
        <li
          key={`${name}-${i}`}
          role="option"
          aria-selected={i === selected}
          className={i === selected ? "is-selected" : ""}
          onMouseDown={() => onSelect(i)}
          onDoubleClick={() => onOpen(i)}
        >
          <span>{name}</span>
          {usage && <em className="num">{usage[name] ? `${usage[name]} ${usage[name] === 1 ? "line" : "lines"}` : "unused"}</em>}
        </li>
      ))}
      {names.length === 0 && <li className="stylemgr__none">No styles</li>}
    </ul>
  );
}

export function StyleManager({ styles, styleFormat, usage, srt, playResX, onChange, onNotify, onClose }: Props) {
  const [library, setLibrary] = useState<StyleLibrary | null>(null);
  const [storageSel, setStorageSel] = useState(-1);
  const [scriptSel, setScriptSel] = useState(styles.length ? 0 : -1);
  const [editing, setEditing] = useState<{ side: Side; index: number | null; fields: StyleFields } | null>(null);
  const [naming, setNaming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .styleLibraryLoad()
      .then((lib) => {
        if (cancelled) return;
        const valid = lib && lib.catalogs && Object.keys(lib.catalogs).length ? lib : emptyLibrary();
        if (!valid.catalogs[valid.current]) valid.current = Object.keys(valid.catalogs)[0];
        setLibrary(valid);
        setStorageSel(valid.catalogs[valid.current].length ? 0 : -1);
      })
      .catch((e) => {
        if (!cancelled) {
          onNotify(errorText(e), "error");
          setLibrary(emptyLibrary());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onNotify]);

  const persist = useCallback(
    (next: StyleLibrary) => {
      setLibrary(next);
      api.styleLibrarySave(next).catch((e) => onNotify(`Could not save the style storage: ${errorText(e)}`, "error"));
    },
    [onNotify],
  );

  const storage = useMemo(() => (library ? library.catalogs[library.current] ?? [] : []), [library]);
  const setStorage = (list: Style[]) => library && persist({ ...library, catalogs: { ...library.catalogs, [library.current]: list } });
  const setScript = (list: Style[], renames: Record<string, string> = {}) => onChange({ styles: list, renames });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing && naming === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, naming, onClose]);

  const scriptNames = styles.map((s) => s.name);
  const storageNames = storage.map((s) => s.name);

  const copyToScript = async () => {
    const style = storage[storageSel];
    if (!style) return;
    const converted = fromStandard(style, styleFormat);
    const at = styles.findIndex((s) => s.name === style.name);
    if (at >= 0) {
      const replace = await ask(`The script already has a style named “${style.name}”. Replace it?`, { title: "Replace style", kind: "warning", okLabel: "Replace", cancelLabel: "Keep both" });
      if (replace) {
        setScript(styles.map((s, i) => (i === at ? converted : s)));
        setScriptSel(at);
        return;
      }
      const name = uniqueName(style.name, scriptNames);
      setScript([...styles, { ...converted, name, values: [name, ...converted.values.slice(1)] }]);
      setScriptSel(styles.length);
      return;
    }
    setScript([...styles, converted]);
    setScriptSel(styles.length);
  };

  const copyToStorage = async () => {
    const style = styles[scriptSel];
    if (!style) return;
    const converted = toStandard(style, styleFormat);
    const at = storage.findIndex((s) => s.name === style.name);
    if (at >= 0) {
      const replace = await ask(`Storage already has a style named “${style.name}”. Replace it?`, { title: "Replace style", kind: "warning", okLabel: "Replace", cancelLabel: "Keep both" });
      if (replace) {
        setStorage(storage.map((s, i) => (i === at ? converted : s)));
        setStorageSel(at);
        return;
      }
      const name = uniqueName(style.name, storageNames);
      setStorage([...storage, { name, values: [name, ...converted.values.slice(1)] }]);
      setStorageSel(storage.length);
      return;
    }
    setStorage([...storage, converted]);
    setStorageSel(storage.length);
  };

  const importFromScript = async () => {
    const path = await open({ filters: [{ name: "ASS subtitles", extensions: ["ass", "ssa"] }] });
    if (typeof path !== "string") return;
    try {
      const found = await api.readStyles(path);
      let next = [...styles];
      let added = 0;
      for (const s of found.styles) {
        const converted = fromStandard(toStandard(s, found.styleFormat), styleFormat);
        const name = uniqueName(s.name, next.map((x) => x.name));
        next = [...next, { name, values: [name, ...converted.values.slice(1)] }];
        added += 1;
      }
      setScript(next);
      onNotify(added ? `Imported ${added} ${added === 1 ? "style" : "styles"}` : "That file has no styles", added ? "ok" : "error");
    } catch (e) {
      onNotify(errorText(e), "error");
    }
  };

  const remove = async (side: Side) => {
    if (side === "storage") {
      const style = storage[storageSel];
      if (!style) return;
      setStorage(storage.filter((_, i) => i !== storageSel));
      setStorageSel(Math.min(storageSel, storage.length - 2));
      return;
    }
    const style = styles[scriptSel];
    if (!style) return;
    const used = usage[style.name] ?? 0;
    if (used > 0) {
      const ok = await ask(`${used} ${used === 1 ? "line uses" : "lines use"} “${style.name}”. Delete it anyway? Those lines will show with the player's default look.`, { title: "Delete style", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
      if (!ok) return;
    }
    setScript(styles.filter((_, i) => i !== scriptSel));
    setScriptSel(Math.min(scriptSel, styles.length - 2));
  };

  const duplicate = (side: Side) => {
    const list = side === "storage" ? storage : styles;
    const sel = side === "storage" ? storageSel : scriptSel;
    const style = list[sel];
    if (!style) return;
    const name = uniqueName(`${style.name} copy`, list.map((s) => s.name));
    const copy = { name, values: [name, ...style.values.slice(1)] };
    if (side === "storage") {
      setStorage([...storage, copy]);
      setStorageSel(storage.length);
    } else {
      setScript([...styles, copy]);
      setScriptSel(styles.length);
    }
  };

  const openEditor = (side: Side, index: number | null) => {
    const list = side === "storage" ? storage : styles;
    const format = side === "storage" ? STANDARD : styleFormat;
    const base = index === null ? { ...DEFAULT_FIELDS, Name: uniqueName("New style", list.map((s) => s.name)) } : readFields(list[index], format);
    setEditing({ side, index, fields: base });
  };

  const saveEditor = (fields: StyleFields) => {
    if (!editing) return;
    const { side, index } = editing;
    if (side === "storage") {
      const style = writeFields(fields, STANDARD);
      const next = index === null ? [...storage, style] : storage.map((s, i) => (i === index ? style : s));
      setStorage(next);
      setStorageSel(index ?? storage.length);
    } else {
      const style = writeFields(fields, styleFormat);
      const old = index === null ? null : styles[index].name;
      const next = index === null ? [...styles, style] : styles.map((s, i) => (i === index ? style : s));
      setScript(next, old && old !== style.name ? { [old]: style.name } : {});
      setScriptSel(index ?? styles.length);
    }
    setEditing(null);
  };

  const newCatalog = (name: string) => {
    if (!library) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (library.catalogs[trimmed]) {
      onNotify(`A storage named “${trimmed}” already exists`, "error");
      return;
    }
    persist({ current: trimmed, catalogs: { ...library.catalogs, [trimmed]: [] } });
    setStorageSel(-1);
    setNaming(null);
  };

  const deleteCatalog = async () => {
    if (!library || library.current === DEFAULT_CATALOG) return;
    const ok = await ask(`Delete the storage “${library.current}” and its ${storage.length} styles?`, { title: "Delete storage", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
    if (!ok) return;
    const catalogs = { ...library.catalogs };
    delete catalogs[library.current];
    const current = catalogs[DEFAULT_CATALOG] ? DEFAULT_CATALOG : Object.keys(catalogs)[0];
    persist({ current, catalogs });
    setStorageSel(catalogs[current]?.length ? 0 : -1);
  };

  const editingTaken = editing
    ? (editing.side === "storage" ? storageNames : scriptNames).filter((_, i) => i !== editing.index)
    : [];

  return (
    <div className="modal modal--wide" onMouseDown={() => !editing && onClose()}>
      <div className="modal__card stylemgr" role="dialog" aria-modal="true" aria-label="Styles Manager" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Styles Manager</h2>
        {srt && <p className="stylemgr__note">This is an SRT file. Styles are kept in the project and saved when you save or export as ASS. SRT files have no styles.</p>}

        <section className="stylemgr__catalog" aria-label="Style storage">
          <span className="stylemgr__heading">Storage</span>
          <div className="stylemgr__catalog-row">
            {naming === null ? (
              <>
                <select
                  className="control"
                  value={library?.current ?? ""}
                  onChange={(e) => {
                    if (!library) return;
                    persist({ ...library, current: e.target.value });
                    setStorageSel(library.catalogs[e.target.value]?.length ? 0 : -1);
                  }}
                  aria-label="Storage"
                >
                  {Object.keys(library?.catalogs ?? {}).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <button className="btn btn--small" onClick={() => setNaming("")}>
                  New
                </button>
                <button className="btn btn--small" onClick={deleteCatalog} disabled={!library || library.current === DEFAULT_CATALOG}>
                  Delete
                </button>
              </>
            ) : (
              <>
                <input
                  className="control"
                  autoFocus
                  placeholder="Name for the new storage"
                  value={naming}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") newCatalog(naming);
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setNaming(null);
                    }
                  }}
                />
                <button className="btn btn--small btn--primary" onClick={() => newCatalog(naming)} disabled={!naming.trim()}>
                  Create
                </button>
                <button className="btn btn--small" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </section>

        <div className="stylemgr__panes">
          <section className="stylemgr__pane" aria-label="Storage styles">
            <span className="stylemgr__heading">Styles in storage</span>
            <div className="stylemgr__body">
              <StyleList label="Storage styles" names={storageNames} selected={storageSel} onSelect={setStorageSel} onOpen={(i) => openEditor("storage", i)} />
              <OrderButtons
                index={storageSel}
                count={storage.length}
                onMove={(to) => {
                  setStorage(moveItem(storage, storageSel, to));
                  setStorageSel(to);
                }}
                onSort={() => setStorage([...storage].sort((a, b) => a.name.localeCompare(b.name)))}
              />
            </div>
            <button className="btn btn--block" onClick={copyToScript} disabled={storageSel < 0}>
              Copy to script →
            </button>
            <div className="stylemgr__buttons">
              <button className="btn btn--small" onClick={() => openEditor("storage", null)}>New</button>
              <button className="btn btn--small" onClick={() => openEditor("storage", storageSel)} disabled={storageSel < 0}>Edit</button>
              <button className="btn btn--small" onClick={() => duplicate("storage")} disabled={storageSel < 0}>Copy</button>
              <button className="btn btn--small" onClick={() => remove("storage")} disabled={storageSel < 0}>Delete</button>
            </div>
          </section>

          <section className="stylemgr__pane" aria-label="Styles in this script">
            <span className="stylemgr__heading">Styles in this script</span>
            <div className="stylemgr__body">
              <StyleList label="Script styles" names={scriptNames} selected={scriptSel} usage={usage} onSelect={setScriptSel} onOpen={(i) => openEditor("script", i)} />
              <OrderButtons
                index={scriptSel}
                count={styles.length}
                onMove={(to) => {
                  setScript(moveItem(styles, scriptSel, to));
                  setScriptSel(to);
                }}
                onSort={() => setScript([...styles].sort((a, b) => a.name.localeCompare(b.name)))}
              />
            </div>
            <div className="stylemgr__pair">
              <button className="btn btn--block" onClick={copyToStorage} disabled={scriptSel < 0}>
                ← Copy to storage
              </button>
              <button className="btn btn--block" onClick={importFromScript}>
                Import from file…
              </button>
            </div>
            <div className="stylemgr__buttons">
              <button className="btn btn--small" onClick={() => openEditor("script", null)}>New</button>
              <button className="btn btn--small" onClick={() => openEditor("script", scriptSel)} disabled={scriptSel < 0}>Edit</button>
              <button className="btn btn--small" onClick={() => duplicate("script")} disabled={scriptSel < 0}>Copy</button>
              <button className="btn btn--small" onClick={() => remove("script")} disabled={scriptSel < 0}>Delete</button>
            </div>
          </section>
        </div>

        <div className="modal__actions">
          <button className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {editing && (
        <StyleEditor
          initial={editing.fields}
          taken={editingTaken}
          usage={editing.side === "script" && editing.index !== null ? usage[styles[editing.index].name] ?? 0 : 0}
          playResX={editing.side === "script" ? playResX : 1920}
          onSave={saveEditor}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ALIGN_GRID = [7, 8, 9, 4, 5, 6, 1, 2, 3];
const ALIGN_NAMES: Record<number, string> = {
  7: "Top left",
  8: "Top centre",
  9: "Top right",
  4: "Middle left",
  5: "Middle centre",
  6: "Middle right",
  1: "Bottom left",
  2: "Bottom centre",
  3: "Bottom right",
};

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const color = parseAssColor(value);
  const opacity = Math.round(((255 - color.alpha) / 255) * 100);
  return (
    <div className="stylecolor">
      <span>{label}</span>
      <input type="color" value={color.hex.toLowerCase()} onChange={(e) => onChange(formatAssColor({ hex: e.target.value, alpha: color.alpha }))} aria-label={`${label} colour`} />
      <label className="stylecolor__alpha" title="Opacity">
        <input
          className="control num"
          type="number"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => {
            const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0));
            onChange(formatAssColor({ hex: color.hex, alpha: 255 - Math.round((pct / 100) * 255) }));
          }}
          aria-label={`${label} opacity percent`}
        />
        <em>%</em>
      </label>
    </div>
  );
}

function NumberField({ label, field, fields, set, step = 1, min }: { label: string; field: StyleField; fields: StyleFields; set: (f: StyleField, v: string) => void; step?: number; min?: number }) {
  return (
    <label className="stylefield">
      <span>{label}</span>
      <input className="control num" type="number" step={step} min={min} value={fields[field]} onChange={(e) => set(field, e.target.value)} />
    </label>
  );
}

function StyleEditor({ initial, taken, usage, playResX, onSave, onCancel }: { initial: StyleFields; taken: string[]; usage: number; playResX: number; onSave: (f: StyleFields) => void; onCancel: () => void }) {
  const [fields, setFields] = useState<StyleFields>(initial);
  const [sample, setSample] = useState("မန် ဗှ်ဂုန် · Mon subtitles");
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(560);
  const set = (f: StyleField, v: string) => setFields((cur) => ({ ...cur, [f]: v }));
  const toggle = (f: StyleField) => setFields((cur) => ({ ...cur, [f]: cur[f] === "1" ? "0" : "1" }));
  const name = fields.Name.trim();
  const nameProblem = !name ? "Give the style a name." : taken.includes(name) ? "Another style already has this name." : name.includes(",") ? "Style names can't contain commas." : null;

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const scale = previewWidth / playResX;

  return (
    <div className="modal modal--stacked" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal__card styleedit" role="dialog" aria-modal="true" aria-label="Edit style">
        <h2>Edit style</h2>
        <div className="styleedit__grid">
          <fieldset className="styleedit__group styleedit__group--wide">
            <legend>Name</legend>
            <input className="control" value={fields.Name} onChange={(e) => set("Name", e.target.value.replace(/,/g, ""))} aria-invalid={Boolean(nameProblem)} spellCheck={false} />
            {nameProblem ? <small className="styleedit__error">{nameProblem}</small> : usage > 0 && initial.Name !== name ? <small className="styleedit__hint">{usage} {usage === 1 ? "line" : "lines"} will switch to the new name.</small> : null}
          </fieldset>

          <fieldset className="styleedit__group styleedit__group--wide">
            <legend>Font</legend>
            <div className="styleedit__font">
              <FontPicker id="styleedit-font" value={fields.Fontname} onChange={(v) => set("Fontname", v)} />
              <input className="control num styleedit__size" type="number" min={1} value={fields.Fontsize} onChange={(e) => set("Fontsize", e.target.value)} aria-label="Font size" />
              <div className="styleedit__marks" role="group" aria-label="Font style">
                {(
                  [
                    ["Bold", "B"],
                    ["Italic", "I"],
                    ["Underline", "U"],
                    ["StrikeOut", "S"],
                  ] as [StyleField, string][]
                ).map(([f, l]) => (
                  <button key={f} className={`fmtbar__btn fmtbar__btn--${l.toLowerCase()}${fields[f] === "1" ? " is-on" : ""}`} aria-pressed={fields[f] === "1"} onClick={() => toggle(f)} title={f === "StrikeOut" ? "Strikethrough" : f}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset className="styleedit__group">
            <legend>Colours</legend>
            <ColorField label="Text" value={fields.PrimaryColour} onChange={(v) => set("PrimaryColour", v)} />
            <ColorField label="Karaoke" value={fields.SecondaryColour} onChange={(v) => set("SecondaryColour", v)} />
            <ColorField label="Outline" value={fields.OutlineColour} onChange={(v) => set("OutlineColour", v)} />
            <ColorField label="Shadow" value={fields.BackColour} onChange={(v) => set("BackColour", v)} />
          </fieldset>

          <fieldset className="styleedit__group">
            <legend>Position</legend>
            <div className="styleedit__align" role="radiogroup" aria-label="Alignment">
              {ALIGN_GRID.map((n) => (
                <button key={n} role="radio" aria-checked={fields.Alignment === String(n)} className={fields.Alignment === String(n) ? "is-on" : ""} onClick={() => set("Alignment", String(n))} title={ALIGN_NAMES[n]} aria-label={ALIGN_NAMES[n]}>
                  {n}
                </button>
              ))}
            </div>
            <div className="styleedit__row3">
              <NumberField label="Left" field="MarginL" fields={fields} set={set} min={0} />
              <NumberField label="Right" field="MarginR" fields={fields} set={set} min={0} />
              <NumberField label="Vertical" field="MarginV" fields={fields} set={set} min={0} />
            </div>
          </fieldset>

          <fieldset className="styleedit__group">
            <legend>Border</legend>
            <div className="styleedit__row3">
              <NumberField label="Outline" field="Outline" fields={fields} set={set} step={0.5} min={0} />
              <NumberField label="Shadow" field="Shadow" fields={fields} set={set} step={0.5} min={0} />
            </div>
            <label className="check">
              <input type="checkbox" checked={fields.BorderStyle === "3"} onChange={(e) => set("BorderStyle", e.target.checked ? "3" : "1")} />
              <span>Opaque box behind text</span>
            </label>
          </fieldset>

          <fieldset className="styleedit__group">
            <legend>Shape</legend>
            <div className="styleedit__row3">
              <NumberField label="Width %" field="ScaleX" fields={fields} set={set} min={1} />
              <NumberField label="Height %" field="ScaleY" fields={fields} set={set} min={1} />
              <NumberField label="Spacing" field="Spacing" fields={fields} set={set} step={0.5} />
            </div>
            <div className="styleedit__row3">
              <NumberField label="Rotation" field="Angle" fields={fields} set={set} />
              <NumberField label="Encoding" field="Encoding" fields={fields} set={set} min={0} />
            </div>
          </fieldset>
        </div>

        <div className="styleedit__preview" ref={previewRef}>
          <div className="styleedit__stage">
            <Caption texts={[{ text: sample, fields: { ...fields, Alignment: "5", MarginL: "0", MarginR: "0", MarginV: "0" } }]} scale={scale} />
          </div>
          <input className="control styleedit__sample" value={sample} onChange={(e) => setSample(e.target.value)} aria-label="Preview text" />
        </div>

        <div className="modal__actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={Boolean(nameProblem)} onClick={() => onSave({ ...fields, Name: name })}>
            Save style
          </button>
        </div>
      </div>
    </div>
  );
}
