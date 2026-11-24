import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, errorText, type DictInfo, type RestoreSummary, type TmStats } from "../lib/api";
import type { Limits } from "../lib/checks";
import { loadBundledFonts } from "../lib/fonts";
import { ALT, MOD } from "../lib/keys";
import { fileName } from "../lib/text";
import { AUTOSAVE_CHOICES, DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import type { Theme, ThemePref } from "../lib/theme";
import { HongsaIcon } from "./Brand";
import { LimitsForm } from "./ChecksPanel";
import { Shell } from "./Modals";

export type SettingsPage = "general" | "editing" | "checks" | "memory" | "about";

interface Props {
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  themePref: ThemePref;
  theme: Theme;
  onTheme: (pref: ThemePref) => void;
  focusLayout: boolean;
  onFocusLayout: (on: boolean) => void;
  limits: Limits;
  onLimits: (limits: Limits) => void;
  stats: TmStats | null;
  onMemoryChanged: () => void;
  onClose: () => void;
}

const PAGES: { id: SettingsPage; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editing", label: "Editing" },
  { id: "checks", label: "Checks" },
  { id: "memory", label: "Memory" },
  { id: "about", label: "About" },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: "paper", label: "Light" },
  { id: "dark", label: "Dark" },
];

function autosaveLabel(seconds: number) {
  if (seconds === 0) return "Off";
  return seconds < 60 ? `${seconds} seconds` : `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`;
}

function Row({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="settings__row">
      <div className="settings__text">
        <b>{label}</b>
        {note && <span>{note}</span>}
      </div>
      <div className="settings__control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return <input type="checkbox" className="settings__toggle" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
}

const BACKUP_FILTER = { name: "HongsaSub memory backup", extensions: ["hongsamemory"] };

function count(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function restoreText(r: RestoreSummary) {
  const parts: string[] = [];
  if (r.lines.added) parts.push(`${count(r.lines.added, "line")} added`);
  if (r.lines.updated) parts.push(`${count(r.lines.updated, "line")} updated`);
  if (r.terms.added) parts.push(`${count(r.terms.added, "glossary term")} added`);
  if (r.terms.updated) parts.push(`${count(r.terms.updated, "glossary term")} updated`);
  if (r.words) parts.push(`${count(r.words, "spelling word")} added`);
  if (r.styleCatalogs) parts.push(`${count(r.styleCatalogs, "style catalogue")} added`);
  const from = r.createdAt ? ` from ${new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : "";
  if (!parts.length) return `Restored the backup${from}. Everything in it was already in memory.`;
  return `Restored the backup${from}: ${parts.join(", ")}.`;
}

function MemoryPage({ stats, onChanged }: { stats: TmStats | null; onChanged: () => void }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  useEffect(() => {
    let live = true;
    api
      .memoryFolder()
      .then((f) => live && setFolder(f))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const backup = async () => {
    const date = new Date().toISOString().slice(0, 10);
    const path = await save({ defaultPath: `HongsaSub memory ${date}.hongsamemory`, filters: [BACKUP_FILTER] });
    if (!path) return;
    setBusy(true);
    setStatus(null);
    try {
      const s = await api.memoryBackup(path);
      setStatus({
        tone: "ok",
        text: `Saved ${count(s.lines, "line")}, ${count(s.terms, "glossary term")} and ${count(s.words, "spelling word")} to ${fileName(path)}.`,
      });
    } catch (e) {
      setStatus({ tone: "error", text: `Couldn't save the backup. ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const path = await open({ filters: [BACKUP_FILTER] });
    if (typeof path !== "string") return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.memoryRestore(path);
      onChanged();
      setStatus({ tone: "ok", text: restoreText(r) });
    } catch (e) {
      setStatus({ tone: "error", text: `Couldn't restore ${fileName(path)}. ${errorText(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="modal__lead">
        Your memory, glossary, spelling words and style library are kept on this computer. Back them up to keep them safe, or to move them to another computer.
      </p>
      <Row label="Back up" note="Saves everything to one file. Keep it in a cloud folder or on a USB drive.">
        <button className="btn" onClick={backup} disabled={busy}>
          Back up…
        </button>
      </Row>
      <Row label="Restore from a backup" note="Adds the backup to this memory. Nothing is removed, and where both have the same line, the newer one is kept.">
        <button className="btn" onClick={restore} disabled={busy}>
          Restore…
        </button>
      </Row>
      <p className={`settings__status${status?.tone === "error" ? " is-error" : ""}`} role={status?.tone === "error" ? "alert" : "status"}>
        {busy ? "Working…" : status?.text}
      </p>
      <dl className="about__facts">
        <div>
          <dt>Memory</dt>
          <dd>
            {stats
              ? `${count(stats.segments, "line")} and ${count(stats.terms, "glossary term")} from ${count(stats.works, "film")}`
              : "Not loaded"}
          </dd>
        </div>
        <div>
          <dt>Kept in</dt>
          <dd className="settings__path">{folder || " "}</dd>
        </div>
      </dl>
    </>
  );
}

function About({ stats }: { stats: TmStats | null }) {
  const [version, setVersion] = useState("");
  const [dict, setDict] = useState<DictInfo | null>(null);
  const [fonts, setFonts] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    getVersion()
      .then((v) => live && setVersion(v))
      .catch(() => undefined);
    api
      .dictInfo()
      .then((d) => live && setDict(d))
      .catch(() => undefined);
    loadBundledFonts()
      .then((list) => live && setFonts(new Set(list.map((f) => f.family)).size))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="about">
      <div className="about__head">
        <HongsaIcon size={64} />
        <div>
          <h3>HongsaSub</h3>
          <p className="num">{version ? `Version ${version}` : " "}</p>
          <p>A subtitle editor for translating films into Mon, with a memory of every line you confirm.</p>
        </div>
      </div>
      <dl className="about__facts">
        <div>
          <dt>Memory</dt>
          <dd>
            {stats
              ? `${stats.segments.toLocaleString()} lines and ${stats.terms.toLocaleString()} glossary terms from ${stats.works.toLocaleString()} ${stats.works === 1 ? "film" : "films"}`
              : "Not loaded"}
          </dd>
        </div>
        <div>
          <dt>Dictionary</dt>
          <dd>
            {dict
              ? `${dict.words.toLocaleString()} words · ${dict.source || "MonDictDB"}${dict.revision ? ` (${dict.revision})` : ""} · ${dict.license || "MIT"} licence`
              : "Not available"}
          </dd>
        </div>
        <div>
          <dt>Bundled fonts</dt>
          <dd>{fonts === null ? "Not loaded" : `${fonts.toLocaleString()} Mon font ${fonts === 1 ? "family" : "families"}, listed in every font picker`}</dd>
        </div>
        <div>
          <dt>Video</dt>
          <dd>Videos the app can't play directly are converted with FFmpeg, which comes with the Mac and Windows downloads under the LGPL 2.1 licence.</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>MIT or Apache-2.0, at your choice.</dd>
        </div>
      </dl>
    </div>
  );
}

export function SettingsModal(props: Props) {
  const { page, onPage, settings, onSettings, themePref, theme, onTheme, focusLayout, onFocusLayout, limits, onLimits, stats, onMemoryChanged, onClose } = props;
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  return (
    <Shell title={page === "about" ? "About HongsaSub" : "Settings"} onClose={onClose} cardClass="modal__card--settings">
      <div className="segmented settings__tabs" role="tablist" aria-label="Settings pages">
        {PAGES.map((p) => (
          <button key={p.id} role="tab" aria-selected={page === p.id} className={page === p.id ? "is-on" : ""} onClick={() => onPage(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="settings__page" role="tabpanel">
        {page === "general" && (
          <>
            <Row label="Appearance">
              <div className="segmented segmented--small" role="radiogroup" aria-label="Appearance">
                {THEMES.map((t) => (
                  <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? "is-on" : ""} onClick={() => onTheme(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Match the system" note="Switch between light and dark with your computer.">
              <Toggle checked={themePref === "system"} onChange={(on) => onTheme(on ? "system" : theme)} label="Match the system" />
            </Row>
            <Row label="Layout" note="Focus hides the timeline and line list. Timing shows them.">
              <div className="segmented segmented--small" role="radiogroup" aria-label="Layout">
                <button role="radio" aria-checked={focusLayout} className={focusLayout ? "is-on" : ""} onClick={() => onFocusLayout(true)}>
                  Focus
                </button>
                <button role="radio" aria-checked={!focusLayout} className={!focusLayout ? "is-on" : ""} onClick={() => onFocusLayout(false)}>
                  Timing
                </button>
              </div>
            </Row>
            <Row label="Autosave" note="Saves HongsaSub projects in the background while you work. Exported subtitle files are never autosaved.">
              <select className="control" value={settings.autosaveSeconds} onChange={(e) => set({ autosaveSeconds: Number(e.target.value) })} aria-label="Autosave">
                {AUTOSAVE_CHOICES.map((s) => (
                  <option key={s} value={s}>
                    {autosaveLabel(s)}
                  </option>
                ))}
              </select>
            </Row>
          </>
        )}
        {page === "editing" && (
          <>
            <Row label="Fill exact matches" note="When you open an untranslated line that memory knows exactly, its translation is filled in as a draft.">
              <Toggle checked={settings.autoFill} onChange={(autoFill) => set({ autoFill })} label="Fill exact matches" />
            </Row>
            <Row label="Snap while dragging" note={`Clip edges on the timeline snap to other lines, the playhead and speech. Hold ${ALT.replace("+", "")} to drag freely.`}>
              <Toggle checked={settings.snap} onChange={(snap) => set({ snap })} label="Snap while dragging" />
            </Row>
            <button className="btn btn--plain btn--small settings__reset" onClick={() => onSettings({ ...DEFAULT_SETTINGS })}>
              Reset to defaults
            </button>
          </>
        )}
        {page === "checks" && (
          <>
            <p className="modal__lead">Lines that break these limits are listed under Checks. The limits are saved on this computer.</p>
            <LimitsForm limits={limits} onLimits={onLimits} />
          </>
        )}
        {page === "memory" && <MemoryPage stats={stats} onChanged={onMemoryChanged} />}
        {page === "about" && <About stats={stats} />}
      </div>
      <div className="modal__actions">
        <span className="settings__hint">
          <kbd>{MOD},</kbd> opens settings
        </span>
        <button className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Shell>
  );
}
