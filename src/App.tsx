import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  errorText,
  type CommitRequest,
  type GlossaryTerm,
  type Misspelling,
  type OpenMode,
  type Peaks,
  type Project,
  type Style,
  type SubtitleEvent,
  type SuggestResponse,
  type TmStats,
  type VideoProgress,
} from "./lib/api";
import { insertAt, isMon, plainText, toEditable, fromEditable } from "./lib/text";
import { HongsaIcon, HongsaMark } from "./components/Brand";
import { AutoThemeIcon, ExportIcon, FilmIcon, FolderIcon, MemoryIcon, MoonIcon, RedoIcon, SaveIcon, SunIcon, UndoIcon } from "./components/Icons";
import { useTheme, type ThemePref } from "./lib/theme";
import { Transport } from "./components/Transport";
import { ALT, ENTER, MOD, SHIFT } from "./lib/keys";
import { LineEditor } from "./components/LineEditor";
import { MemoryPanel, type DictRequest, type MemoryTab, type SideView } from "./components/MemoryPanel";
import { ChecksPanel } from "./components/ChecksPanel";
import { loadLimits, runChecks, storeLimits, type Issue, type Limits } from "./lib/checks";
import { ExportModal, ImportModal, OpenModeModal } from "./components/Modals";
import { SubtitleGrid } from "./components/SubtitleGrid";
import { Workspace } from "./components/Workspace";
import { FillModal, ReplaceModal, ShiftModal, ToolsMenu } from "./components/Tools";
import { mergeEvents, shiftEvents, splitEvent } from "./lib/edits";
import { formatLeft, pace } from "./lib/pace";
import { Timeline } from "./components/Timeline";
import { VideoPane, type VideoState } from "./components/VideoPane";
import { StyleManager, type StyleChange } from "./components/StyleManager";
import { DEFAULT_FIELDS, documentFields, playRes, readFields } from "./lib/styles";

type Modal = { kind: "open-mode"; path: string } | { kind: "export" } | { kind: "import" } | { kind: "styles" } | { kind: "fill" } | { kind: "replace" } | { kind: "shift" } | null;
type Toast = { text: string; tone: "ok" | "error" } | null;
type Snapshot = { events: SubtitleEvent[]; styles: Style[]; focusId: string | null };
type History = { past: Snapshot[]; future: Snapshot[]; group: string | null; at: number };

const HISTORY_LIMIT = 300;
const NEXT_THEME: Record<ThemePref, ThemePref> = { system: "paper", paper: "dark", dark: "system" };
const THEME_LABEL: Record<ThemePref, string> = { system: "follows macOS", paper: "Paper", dark: "Dark" };
const COALESCE_MS = 1200;
const EMPTY_HISTORY: History = { past: [], future: [], group: null, at: 0 };

const EMPTY_SUGGESTIONS: SuggestResponse = { matches: [], terms: [] };
const OPEN_FILTER = [
  { name: "Subtitles and projects", extensions: ["hongsa", "ass", "ssa", "srt"] },
  { name: "HongsaSub project", extensions: ["hongsa"] },
];
const SAVE_FILTERS = {
  ass: { name: "ASS subtitles", extensions: ["ass"] },
  srt: { name: "SRT subtitles", extensions: ["srt"] },
  hongsa: { name: "HongsaSub project", extensions: ["hongsa"] },
};
const SAVE_EXTENSIONS = ["ass", "ssa", "srt", "hongsa"];

function extension(path: string) {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

const VIDEO_FILTER = [{ name: "Video", extensions: ["mp4", "m4v", "mkv", "webm", "mov", "avi", "ts"] }];

function stem(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoState>({ src: null, status: "idle" });
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [peaksStatus, setPeaksStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [time, setTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestResponse>(EMPTY_SUGGESTIONS);
  const [suggesting, setSuggesting] = useState(false);
  const [stats, setStats] = useState<TmStats | null>(null);
  const [tab, setTabState] = useState<MemoryTab>("matches");
  const [sideView, setSideView] = useState<SideView>("memory");
  const [autosaveTick, setAutosaveTick] = useState(0);
  const [limits, setLimitsState] = useState<Limits>(loadLimits);
  const setTab = useCallback((t: MemoryTab) => {
    setTabState(t);
    setSideView("memory");
  }, []);
  const [glossaryDraft, setGlossaryDraft] = useState("");
  const [dictRequest, setDictRequest] = useState<DictRequest>({ text: "", n: 0 });
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [memoryRev, setMemoryRev] = useState(0);
  const [pps, setPps] = useState(70);
  const { pref: themePref, theme, setPref: setThemePref } = useTheme();
  const [focusLayout, setFocusLayoutState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("hongsasub.layout") === "focus";
    } catch {
      return false;
    }
  });
  const setFocusLayout = useCallback((on: boolean) => {
    setFocusLayoutState(on);
    try {
      localStorage.setItem("hongsasub.layout", on ? "focus" : "timing");
    } catch {
      return;
    }
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;
  const revisionRef = useRef(0);
  const confirmingRef = useRef(false);
  const [stamps, setStamps] = useState<number[]>([]);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const videoTokenRef = useRef(0);
  const videoPathRef = useRef<string | null>(null);
  const historyRef = useRef<History>(EMPTY_HISTORY);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const events = project?.document.events ?? [];
  const translating = useMemo(() => events.some((e) => e.source.trim().length > 0), [events]);
  const selectedIndex = events.findIndex((e) => e.id === selectedId);
  const selected = selectedIndex >= 0 ? events[selectedIndex] : null;
  const dialogue = useMemo(() => events.filter((e) => e.kind === "dialogue"), [events]);
  const confirmed = dialogue.filter((e) => e.status === "confirmed").length;
  const lastEnd = events.reduce((m, e) => Math.max(m, e.end), 0);
  const duration = Math.max(videoDuration, lastEnd + 5000);
  const styles = project?.document.styles.map((s) => s.name) ?? [];
  const active = useMemo(
    () => events.filter((e) => e.kind === "dialogue" && e.start <= time && time < e.end),
    [events, time],
  );

  const doc = project?.document ?? null;
  const resolution = useMemo(() => (doc ? playRes(doc) : { x: 1920, y: 1080 }), [doc]);
  const fieldsFor = useCallback((style: string) => (doc ? documentFields(doc, style) : { ...DEFAULT_FIELDS }), [doc]);
  const checkedEvents = useDeferredValue(events);
  const spellCache = useRef(new Map<string, Misspelling[]>());
  const spellFailed = useRef(false);
  const [spellTick, setSpellTick] = useState(0);
  useEffect(() => {
    if (spellFailed.current) return;
    const cache = spellCache.current;
    const texts = [...new Set(checkedEvents.filter((e) => e.kind === "dialogue" && isMon(e.text)).map((e) => toEditable(e.text)))].filter((t) => !cache.has(t));
    if (!texts.length) return;
    const handle = setTimeout(() => {
      api
        .spellCheck(texts)
        .then((results) => {
          if (cache.size > 20000) cache.clear();
          texts.forEach((t, i) => cache.set(t, results[i] ?? []));
          setSpellTick((n) => n + 1);
        })
        .catch(() => {
          spellFailed.current = true;
        });
    }, 450);
    return () => clearTimeout(handle);
  }, [checkedEvents, spellTick]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  useEffect(() => {
    if (!translating) return;
    let live = true;
    api
      .glossaryList()
      .then((terms) => live && setGlossary(terms))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [translating, memoryRev]);
  const docStyles = doc?.styles;
  const docStyleFormat = doc?.styleFormat;
  const issues = useMemo(() => {
    if (!docStyles || !docStyleFormat) return [] as Issue[];
    const aligns = new Map<string, number>();
    for (const st of docStyles) aligns.set(st.name, Number(readFields(st, docStyleFormat).Alignment) || 2);
    const fallback = aligns.get("Default") ?? 2;
    const styleAlign = (style: string) => aligns.get(style) ?? fallback;
    const cache = spellCache.current;
    const spelling = (ev: SubtitleEvent) => cache.get(toEditable(ev.text))?.map((m) => m.word);
    return runChecks(checkedEvents, limits, translating, styleAlign, glossary, spelling);
  }, [checkedEvents, limits, translating, docStyles, docStyleFormat, glossary, spellTick]);
  const issueErrors = useMemo(() => issues.filter((i) => i.severity === "error").length, [issues]);
  const issuesById = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const i of issues) map.set(i.id, [...(map.get(i.id) ?? []), i]);
    return map;
  }, [issues]);
  const setLimits = useCallback((l: Limits) => {
    setLimitsState(l);
    storeLimits(l);
  }, []);

  const videoName = project?.videoPath ? (project.videoPath.split(/[\\/]/).pop() ?? null) : null;

  const notify = useCallback((text: string, tone: "ok" | "error" = "ok") => setToast({ text, tone }), []);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), toast.tone === "error" ? 6000 : 2800);
    return () => clearTimeout(handle);
  }, [toast]);

  const lookUp = useCallback((text: string) => {
    const word = text.replace(/\s+/g, " ").trim().slice(0, 80);
    setDictRequest((r) => ({ text: word, n: r.n + 1 }));
    setTab("dictionary");
  }, []);

  const refreshStats = useCallback(() => {
    api.stats().then(setStats).catch(() => undefined);
  }, []);

  useEffect(refreshStats, [refreshStats]);

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    setDirty(true);
  }, []);

  const confirmDiscard = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return ask("You have unsaved changes. Discard them?", { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!(await confirmDiscard())) event.preventDefault();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, [confirmDiscard]);

  const syncHistorySize = useCallback(() => {
    const h = historyRef.current;
    setHistorySize({ undo: h.past.length, redo: h.future.length });
  }, []);

  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [], group: null, at: 0 };
    syncHistorySize();
  }, [syncHistorySize]);

  const record = useCallback(
    (id: string, group: string | null) => {
      const p = projectRef.current;
      if (!p) return;
      const h = historyRef.current;
      const now = Date.now();
      const extends_ = group !== null && h.group === group && now - h.at < COALESCE_MS;
      if (!extends_) {
        h.past.push({ events: p.document.events, styles: p.document.styles, focusId: id });
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
      }
      h.future = [];
      h.group = group;
      h.at = now;
      syncHistorySize();
    },
    [syncHistorySize],
  );

  const updateEvent = useCallback((id: string, patch: Partial<SubtitleEvent>, group: string | null = null) => {
    record(id, group);
    setProject((p) =>
      p
        ? {
            ...p,
            document: { ...p.document, events: p.document.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) },
          }
        : p,
    );
    markDirty();
  }, [markDirty, record]);

  const setEvents = useCallback(
    (change: (events: SubtitleEvent[]) => SubtitleEvent[], focusId?: string) => {
      record(focusId ?? selectedIdRef.current ?? "", null);
      setProject((p) => (p ? { ...p, document: { ...p.document, events: change(p.document.events) } } : p));
      markDirty();
    },
    [markDirty, record],
  );

  const applyFixes = useCallback(
    (list: Issue[]) => {
      const patches = new Map<string, Partial<SubtitleEvent>>();
      for (const issue of list) {
        if (!issue.fix) continue;
        const current = patches.get(issue.id) ?? {};
        const clash = Object.keys(issue.fix.patch).some((k) => k in current);
        if (!clash) patches.set(issue.id, { ...current, ...issue.fix.patch });
      }
      if (!patches.size) return;
      record(list.length === 1 ? list[0].id : (selectedIdRef.current ?? ""), null);
      setProject((p) =>
        p ? { ...p, document: { ...p.document, events: p.document.events.map((e) => (patches.has(e.id) ? { ...e, ...patches.get(e.id) } : e)) } } : p,
      );
      markDirty();
      notify(patches.size === 1 ? "Fixed 1 line" : `Fixed ${patches.size} lines`);
    },
    [markDirty, record, notify],
  );

  const updateStyles = useCallback(
    ({ styles, renames }: StyleChange) => {
      record(selectedIdRef.current ?? "", null);
      setProject((p) => {
        if (!p) return p;
        const renamed = Object.keys(renames).length > 0;
        const events = renamed ? p.document.events.map((e) => (renames[e.style] ? { ...e, style: renames[e.style] } : e)) : p.document.events;
        return { ...p, document: { ...p.document, styles, events } };
      });
      markDirty();
    },
    [markDirty, record],
  );

  const stepHistory = useCallback(
    (direction: "undo" | "redo") => {
      const p = projectRef.current;
      const h = historyRef.current;
      const from = direction === "undo" ? h.past : h.future;
      const to = direction === "undo" ? h.future : h.past;
      const snap = from.pop();
      if (!p || !snap) return;
      to.push({ events: p.document.events, styles: p.document.styles, focusId: snap.focusId });
      h.group = null;
      setProject({ ...p, document: { ...p.document, events: snap.events, styles: snap.styles } });
      if (snap.focusId && snap.events.some((e) => e.id === snap.focusId)) setSelectedId(snap.focusId);
      markDirty();
      syncHistorySize();
    },
    [markDirty, syncHistorySize],
  );

  const neighbours = useCallback((id: string) => {
    const list = (projectRef.current?.document.events ?? []).filter((e) => e.kind === "dialogue");
    const i = list.findIndex((e) => e.id === id);
    return { prev: i > 0 ? list[i - 1].source : "", next: i >= 0 && i < list.length - 1 ? list[i + 1].source : "" };
  }, []);

  const seek = useCallback((ms: number) => {
    const v = videoRef.current;
    stopAtRef.current = null;
    setTime(ms);
    if (v) v.currentTime = ms / 1000;
  }, []);

  const select = useCallback(
    (id: string) => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.closest(".timefield")) active.blur();
      setSelectedId(id);
      const ev = projectRef.current?.document.events.find((e) => e.id === id);
      const v = videoRef.current;
      if (ev && (!v || v.paused)) seek(ev.start);
    },
    [seek],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<VideoProgress>("video-progress", (event) => {
      if (event.payload.source !== videoPathRef.current) return;
      setVideo((v) => (v.status === "preparing" ? { ...v, mode: event.payload.mode, progress: event.payload.ratio } : v));
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const attachVideo = useCallback(async (path: string, force = false) => {
    const token = ++videoTokenRef.current;
    videoPathRef.current = path;
    setPlaying(false);
    setVideo({ src: null, status: "preparing", progress: null, mode: force ? "transcode" : undefined });
    if (force) {
      try {
        const prepared = await api.videoPrepare(path, true);
        if (token !== videoTokenRef.current) return;
        setVideo({ src: prepared.url, path: prepared.path, status: "ready", proxied: prepared.proxied, mode: prepared.mode });
      } catch (e) {
        if (token !== videoTokenRef.current) return;
        setVideo({ src: null, status: "error", message: errorText(e) });
      }
      return;
    }
    setPeaks(null);
    setPeaksStatus("loading");
    api
      .audioPeaks(path)
      .then((p) => {
        if (token !== videoTokenRef.current) return;
        setPeaks(p);
        setPeaksStatus("ready");
      })
      .catch(() => {
        if (token === videoTokenRef.current) setPeaksStatus("error");
      });
    try {
      const prepared = await api.videoPrepare(path);
      if (token !== videoTokenRef.current) return;
      setVideo({ src: prepared.url, path: prepared.path, status: "ready", proxied: prepared.proxied, mode: prepared.mode });
    } catch (e) {
      if (token !== videoTokenRef.current) return;
      setVideo({ src: null, status: "error", message: errorText(e) });
    }
  }, []);

  const reportedPlayRef = useRef<string | null>(null);
  const onVideoReady = useCallback(() => {
    const source = videoPathRef.current;
    if (!source || !video.path || reportedPlayRef.current === video.path) return;
    reportedPlayRef.current = video.path;
    api.videoPlayed(source, video.path).catch(() => undefined);
  }, [video.path]);

  const onVideoError = useCallback(() => {
    const path = videoPathRef.current;
    if (!path) return;
    if (video.mode === "transcode") {
      setVideo({ src: null, status: "error", message: "This video's format can't be played, even after converting it." });
      return;
    }
    attachVideo(path, true);
  }, [attachVideo, video.mode]);

  const loadProject = useCallback(
    (p: Project, path: string | null) => {
      setProject(p);
      setProjectPath(path);
      setStamps([]);
      resetHistory();
      revisionRef.current += 1;
      setDirty(path === null);
      setPlaying(false);
      setTime(0);
      setVideoDuration(0);
      setSuggestions(EMPTY_SUGGESTIONS);
      const first = p.document.events.find((e) => e.kind === "dialogue" && e.status !== "confirmed") ?? p.document.events[0];
      setSelectedId(first?.id ?? null);
      if (p.videoPath) attachVideo(p.videoPath);
      else {
        videoTokenRef.current += 1;
        videoPathRef.current = null;
        setVideo({ src: null, status: "idle" });
        setPeaks(null);
        setPeaksStatus("idle");
      }
    },
    [attachVideo, resetHistory],
  );

  const openFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const path = await open({ filters: OPEN_FILTER });
    if (typeof path !== "string") return;
    if (path.toLowerCase().endsWith(".hongsa")) {
      try {
        loadProject(await api.openProject(path), path);
      } catch (e) {
        notify(errorText(e), "error");
      }
    } else {
      setModal({ kind: "open-mode", path });
    }
  }, [loadProject, notify, confirmDiscard]);

  const openSubtitle = useCallback(
    async (path: string, mode: OpenMode) => {
      setModal(null);
      try {
        loadProject(await api.openSubtitle(path, mode), mode === "edit" ? path : null);
        notify(mode === "translate" ? "Ready to translate. Matches appear on the right." : "Opened for editing.");
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [loadProject, notify],
  );

  const saveProject = useCallback(
    async (saveAs = false) => {
      const p = projectRef.current;
      if (!p) return;
      let path = projectPath;
      const hasSource = p.document.events.some((e) => e.source.trim());
      if (!path || saveAs) {
        const current = path ? extension(path) : extension(p.sourcePath ?? "");
        const preferred = current === "hongsa" || (!path && hasSource) ? "hongsa" : current === "srt" ? "srt" : "ass";
        const base = path ? stem(path) : hasSource && preferred !== "hongsa" ? `${p.title}.mnw` : p.title;
        const order = [preferred, ...(["ass", "srt", "hongsa"] as const).filter((k) => k !== preferred)] as (keyof typeof SAVE_FILTERS)[];
        const picked = await save({ defaultPath: `${base}.${preferred}`, filters: order.map((k) => SAVE_FILTERS[k]) });
        if (!picked) return;
        path = SAVE_EXTENSIONS.includes(extension(picked)) ? picked : `${picked}.${preferred}`;
      }
      const revision = revisionRef.current;
      const kind = extension(path);
      try {
        if (kind === "hongsa") {
          const saved = await api.saveProject(path, p);
          setProject((cur) => (cur ? { ...cur, updatedAt: saved.updatedAt } : cur));
        } else {
          await api.exportSubtitle(path, p, false);
          if (hasSource) {
            notify(`Exported ${path.split(/[\\/]/).pop() ?? path}. Save as a HongsaSub project to keep the English and unfinished lines.`);
            return;
          }
        }
        setProjectPath(path);
        if (revisionRef.current === revision) setDirty(false);
        const name = path.split(/[\\/]/).pop() ?? path;
        notify(kind === "srt" && p.document.format !== "srt" ? `Saved ${name}. SRT keeps no styles or positions.` : `Saved ${name}`);
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [projectPath, notify],
  );

  useEffect(() => {
    if (!dirty || !projectPath || extension(projectPath) !== "hongsa") return;
    const handle = setTimeout(() => {
      const p = projectRef.current;
      if (!p) return;
      const revision = revisionRef.current;
      api
        .saveProject(projectPath, p)
        .then(() => {
          if (revisionRef.current === revision) setDirty(false);
        })
        .catch((e) => notify(`Autosave failed: ${errorText(e)}`, "error"))
        .finally(() => setAutosaveTick((t) => t + 1));
    }, 45_000);
    return () => clearTimeout(handle);
  }, [dirty, projectPath, notify, autosaveTick]);

  const exportTo = useCallback(
    async (format: "ass" | "srt", fallback: boolean) => {
      const p = projectRef.current;
      if (!p) return;
      setModal(null);
      const picked = await save({
        defaultPath: `${p.title}.mnw.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!picked) return;
      const path = picked.toLowerCase().endsWith(`.${format}`) ? picked : `${picked}.${format}`;
      try {
        await api.exportSubtitle(path, p, fallback);
        notify(`Exported ${stem(path)}.${format}`);
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [notify],
  );

  const fillFromMemory = useCallback(
    async (minScore: number) => {
      const p = projectRef.current;
      if (!p) return;
      const dialogue = p.document.events.filter((e) => e.kind === "dialogue");
      const open = dialogue.map((e, i) => ({ e, i })).filter(({ e }) => e.source.trim() && !plainText(e.text));
      if (!open.length) return;
      try {
        const hits = await api.pretranslate(
          open.map(({ e, i }) => ({ source: e.source, prev: dialogue[i - 1]?.source ?? "", next: dialogue[i + 1]?.source ?? "", work: p.work })),
          minScore,
        );
        const fills = new Map<string, string>();
        hits.forEach((h, k) => h && fills.set(open[k].e.id, h.target));
        setModal(null);
        if (!fills.size) {
          notify("Memory had no matches for the untranslated lines");
          return;
        }
        const filled = projectRef.current?.document.events.filter((e) => fills.has(e.id) && !plainText(e.text)).length ?? 0;
        setEvents((events) => events.map((e) => (fills.has(e.id) && !plainText(e.text) ? { ...e, text: fills.get(e.id) ?? e.text, status: "draft" } : e)));
        notify(`Filled ${filled.toLocaleString()} ${filled === 1 ? "line" : "lines"} as drafts. Check them, then confirm.`);
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [notify, setEvents],
  );

  const replaceAll = useCallback(
    (patches: Map<string, Partial<SubtitleEvent>>) => {
      if (!patches.size) return;
      setEvents((events) =>
        events.map((e) => {
          const patch = patches.get(e.id);
          if (!patch) return e;
          const next = { ...e, ...patch };
          const status: SubtitleEvent["status"] = !plainText(next.text) ? "untranslated" : e.status === "untranslated" ? "draft" : e.status;
          return { ...next, status };
        }),
      );
      setModal(null);
      notify(`Replaced in ${patches.size.toLocaleString()} ${patches.size === 1 ? "line" : "lines"}`);
    },
    [notify, setEvents],
  );

  const shiftTimings = useCallback(
    (delta: number, fromIndex: number) => {
      setEvents((events) => shiftEvents(events, delta, fromIndex));
      setModal(null);
      notify(`Moved ${fromIndex === 0 ? "every line" : `lines from ${fromIndex + 1} on`} ${delta > 0 ? "later" : "earlier"} by ${(Math.abs(delta) / 1000).toFixed(3).replace(/\.?0+$/, "")}s`);
    },
    [notify, setEvents],
  );

  const splitLine = useCallback(
    (id: string, caret: number | null) => {
      const ev = projectRef.current?.document.events.find((e) => e.id === id);
      if (!ev || ev.end - ev.start < 200) return;
      const [a, b] = splitEvent(ev, caret);
      setEvents((events) => events.flatMap((e) => (e.id === id ? [a, b] : [e])), id);
      notify("Split into two lines");
    },
    [notify, setEvents],
  );

  const mergeNext = useCallback(
    (id: string) => {
      const list = projectRef.current?.document.events ?? [];
      const i = list.findIndex((e) => e.id === id);
      const next = list.slice(i + 1).find((e) => e.kind === list[i]?.kind);
      if (i < 0 || !next) return;
      const merged = mergeEvents(list[i], next);
      setEvents((events) => events.filter((e) => e.id !== next.id).map((e) => (e.id === id ? merged : e)), id);
      notify("Merged with the next line");
    },
    [notify, setEvents],
  );

  const addWord = useCallback(
    async (word: string) => {
      try {
        await api.spellAdd(word);
        spellCache.current.clear();
        setSpellTick((n) => n + 1);
        notify(`Added “${word}” to your words`);
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [notify],
  );
  const importPairs = useCallback(
    async (pairs: CommitRequest[]) => {
      try {
        const count = await api.commitPairs(pairs);
        setModal(null);
        refreshStats();
        notify(count > 0 ? `Memory learned ${count.toLocaleString()} lines` : "No lines matched by timing", count > 0 ? "ok" : "error");
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [notify, refreshStats],
  );

  const pickVideo = useCallback(async () => {
    const path = await open({ filters: VIDEO_FILTER });
    if (typeof path !== "string") return;
    setProject((p) => (p ? { ...p, videoPath: path } : p));
    markDirty();
    attachVideo(path);
  }, [attachVideo, markDirty]);

  useEffect(() => {
    if (!selected || !selected.source.trim()) {
      setSuggestions(EMPTY_SUGGESTIONS);
      setSuggesting(false);
      return;
    }
    let cancelled = false;
    const id = selected.id;
    const source = selected.source;
    const { prev, next } = neighbours(id);
    setSuggesting(true);
    setSuggestions(EMPTY_SUGGESTIONS);
    const handle = setTimeout(() => {
      api
        .suggest({ source, prev, next, work: projectRef.current?.work ?? "", limit: 9 })
        .then((res) => {
          if (cancelled) return;
          setSuggestions(res);
          const top = res.matches[0];
          const current = projectRef.current?.document.events.find((e) => e.id === id);
          if (top && top.score === 100 && current && !plainText(current.text)) {
            updateEvent(id, { text: top.target, status: "draft" });
          }
        })
        .catch((e) => {
          if (!cancelled) notify(errorText(e), "error");
        })
        .finally(() => {
          if (!cancelled) setSuggesting(false);
        });
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [selected?.id, selected?.source, memoryRev, neighbours, notify, updateEvent]);

  const insertIntoEditor = useCallback(
    (text: string) => {
      const ev = selected;
      const area = editorRef.current;
      if (!ev) return;
      const editable = toEditable(ev.text);
      const startPos = area ? area.selectionStart : editable.length;
      const endPos = area ? area.selectionEnd : editable.length;
      const { value, caret } = insertAt(editable, startPos, endPos, toEditable(text));
      updateEvent(ev.id, { text: fromEditable(value), status: "draft" });
      requestAnimationFrame(() => {
        area?.focus();
        area?.setSelectionRange(caret, caret);
      });
    },
    [selected, updateEvent],
  );

  const applyMatch = useCallback(
    (i: number) => {
      const m = suggestions.matches[i];
      if (!m || !selected) return;
      updateEvent(selected.id, { text: m.target, status: "draft" });
      requestAnimationFrame(() => {
        const area = editorRef.current;
        if (!area) return;
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });
    },
    [suggestions, selected, updateEvent],
  );

  const forget = useCallback(
    async (id: string) => {
      try {
        await api.forget(id);
        setSuggestions((s) => ({ ...s, matches: s.matches.filter((m) => m.id !== id) }));
        refreshStats();
      } catch (e) {
        notify(errorText(e), "error");
      }
    },
    [refreshStats, notify],
  );

  const move = useCallback(
    (delta: number) => {
      const list = projectRef.current?.document.events ?? [];
      const i = list.findIndex((e) => e.id === selectedId);
      const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
      if (next) select(next.id);
    },
    [selectedId, select],
  );

  const confirm = useCallback(async () => {
    const ev = selected;
    if (!ev || ev.kind === "comment" || confirmingRef.current) return;
    if (ev.source.trim() && plainText(ev.text)) {
      const { prev, next } = neighbours(ev.id);
      confirmingRef.current = true;
      try {
        await api.commit({ source: ev.source, target: ev.text, prev, next, work: projectRef.current?.work ?? "" });
        refreshStats();
      } catch (e) {
        notify(errorText(e), "error");
        return;
      } finally {
        confirmingRef.current = false;
      }
      if (selectedIdRef.current !== ev.id) {
        updateEvent(ev.id, { status: "confirmed" });
        return;
      }
    }
    if (plainText(ev.text) && ev.status !== "confirmed") setStamps((list) => [...list.slice(-199), Date.now()]);
    updateEvent(ev.id, { status: plainText(ev.text) ? "confirmed" : "untranslated" });
    const list = projectRef.current?.document.events ?? [];
    const i = list.findIndex((e) => e.id === ev.id);
    const after = list.slice(i + 1).find((e) => e.kind === "dialogue");
    if (after) select(after.id);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [selected, neighbours, updateEvent, select, refreshStats, notify]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    stopAtRef.current = null;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const playLine = useCallback(() => {
    const v = videoRef.current;
    if (!v || !selected) return;
    v.currentTime = selected.start / 1000;
    stopAtRef.current = selected.end;
    v.play().catch(() => undefined);
  }, [selected]);

  const step = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      if (!v) return;
      seek(Math.max(0, v.currentTime * 1000 + ms));
    },
    [seek],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const now = v.currentTime * 1000;
        if (stopAtRef.current !== null && now >= stopAtRef.current) {
          v.pause();
          v.currentTime = stopAtRef.current / 1000;
          stopAtRef.current = null;
        }
        setTime(v.currentTime * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const focusLayoutRef = useRef(focusLayout);
  focusLayoutRef.current = focusLayout;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) return;
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      const control = typing || target.tagName === "BUTTON" || target.tagName === "A" || Boolean(target.closest?.('[role="tab"], [role="separator"], button, a'));
      const ownField = target === editorRef.current || !typing;
      const lower = e.key.toLowerCase();
      if (mod && ownField && projectRef.current && (lower === "z" || lower === "y")) {
        e.preventDefault();
        stepHistory(lower === "y" || e.shiftKey ? "redo" : "undo");
      } else if (mod && e.key === "Enter" && ownField) {
        e.preventDefault();
        confirm();
      } else if (mod && /^[1-9]$/.test(e.key) && ownField) {
        e.preventDefault();
        applyMatch(Number(e.key) - 1);
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.altKey && e.code === "KeyP") {
        e.preventDefault();
        playLine();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openFile();
      } else if (mod && e.key.toLowerCase() === "e" && projectRef.current) {
        e.preventDefault();
        setModal({ kind: "export" });
      } else if (mod && e.key.toLowerCase() === "g" && selected) {
        e.preventDefault();
        const picked = window.getSelection()?.toString().trim();
        setGlossaryDraft(picked || "");
        setTab("glossary");
      } else if (mod && lower === "d") {
        e.preventDefault();
        const area = editorRef.current;
        const fromEditor = area && target === area ? area.value.slice(area.selectionStart, area.selectionEnd) : "";
        lookUp(fromEditor || window.getSelection()?.toString() || "");
      } else if (mod && e.shiftKey && lower === "h" && projectRef.current) {
        e.preventDefault();
        setModal({ kind: "replace" });
      } else if (mod && e.shiftKey && lower === "f" && projectRef.current) {
        e.preventDefault();
        setFocusLayout(!focusLayoutRef.current);
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("search");
      } else if (!control && e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (!control && e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (!control && e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (!control && e.key === "Enter") {
        e.preventDefault();
        editorRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, confirm, applyMatch, move, playLine, saveProject, openFile, togglePlay, selected, stepHistory, lookUp, setFocusLayout]);

  const setWork = (work: string) => {
    setProject((p) => (p ? { ...p, work } : p));
    markDirty();
  };

  const progress = dialogue.length ? confirmed / dialogue.length : 0;
  const speed = pace(stamps, dialogue.length - confirmed);
  const styleUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.style] = (counts[e.style] ?? 0) + 1;
    return counts;
  }, [events]);

  return (
    <div className={`app${project ? "" : " app--welcome"}`}>
      <header className="toolbar">
        <div className="brand">
          <HongsaMark />
          <span>HongsaSub</span>
        </div>
        {project && (
          <div className="doc">
            <span className="doc__title" title={projectPath ?? "Not saved yet"}>
              {project.title}
            </span>
            <span className={`doc__state${dirty ? " is-dirty" : ""}`}>{dirty ? "Edited" : "Saved"}</span>
            <label className="doc__work" title="Film title. Memory uses it to mark matches from this film.">
              <span className="doc__work-icon" aria-hidden>
                <FilmIcon size={14} />
              </span>
              <span>Film</span>
              <input
                className="control"
                value={project.work}
                placeholder="Film title"
                onChange={(e) => setWork(e.target.value)}
                spellCheck={false}
                aria-label="Film title used in memory"
              />
            </label>
          </div>
        )}
        <span className="spacer" />
        {project && dialogue.length > 0 && (
          <div
            className="progress"
            title={`${confirmed} of ${dialogue.length} lines confirmed${
              speed ? `. This session: ${speed.count} confirmed, about ${Math.round(speed.perHour)} an hour, breaks over 3 minutes not counted.` : ""
            }`}
          >
            <span className="progress__text">
              <b className="num">{Math.round(progress * 100)}%</b> confirmed
              {speed && confirmed < dialogue.length && (
                <span className="progress__pace">
                  {" · "}
                  <span className="num">{Math.round(speed.perHour)}</span>/h · <span className="num">{formatLeft(speed.leftMs)}</span> left
                </span>
              )}
            </span>
            <span className="progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={dialogue.length} aria-valuenow={confirmed} aria-label="Lines confirmed">
              <span className="progress__fill" style={{ width: `${progress * 100}%` }} />
            </span>
          </div>
        )}
        {project && (
          <div className="history" role="group" aria-label="Undo and redo">
            <button className="icon-btn" onClick={() => stepHistory("undo")} disabled={historySize.undo === 0} aria-label="Undo" title={`Undo  ${MOD}Z`}>
              <UndoIcon />
            </button>
            <button className="icon-btn" onClick={() => stepHistory("redo")} disabled={historySize.redo === 0} aria-label="Redo" title={`Redo  ${MOD}${SHIFT}Z`}>
              <RedoIcon />
            </button>
          </div>
        )}
        {project && (
          <div className="segmented segmented--small layoutswitch" role="radiogroup" aria-label="Layout">
            <button role="radio" aria-checked={focusLayout} className={focusLayout ? "is-on" : ""} onClick={() => setFocusLayout(true)} title={`Focus: editor and memory, no timeline  ${MOD}${SHIFT}F`}>
              Focus
            </button>
            <button role="radio" aria-checked={!focusLayout} className={!focusLayout ? "is-on" : ""} onClick={() => setFocusLayout(false)} title={`Timing: timeline and line list  ${MOD}${SHIFT}F`}>
              Timing
            </button>
          </div>
        )}
        <button
          className="icon-btn themeswitch"
          onClick={() => setThemePref(NEXT_THEME[themePref])}
          title={`Appearance: ${THEME_LABEL[themePref]}. Click for ${THEME_LABEL[NEXT_THEME[themePref]]}.`}
          aria-label={`Appearance: ${THEME_LABEL[themePref]}`}
        >
          {themePref === "system" ? <AutoThemeIcon /> : themePref === "paper" ? <SunIcon /> : <MoonIcon />}
        </button>
        <nav className="actions" aria-label="File">
          {project && (
            <ToolsMenu
              items={[
                { label: "Fill from memory…", disabled: !translating, run: () => setModal({ kind: "fill" }) },
                { label: "Find and replace…", hint: `${MOD}${SHIFT}H`, run: () => setModal({ kind: "replace" }) },
                { label: "Shift timings…", run: () => setModal({ kind: "shift" }) },
              ]}
            />
          )}
          <button className="btn" onClick={() => setModal({ kind: "import" })} title="Teach memory from finished subtitles">
            <MemoryIcon size={14} />
            Teach memory
          </button>
          <button className="btn" onClick={openFile} title={`Open  ${MOD}O`}>
            <FolderIcon size={14} />
            Open
          </button>
          {project && (
            <>
              <button className="btn" onClick={() => saveProject(false)} title={`Save  ${MOD}S`}>
                <SaveIcon size={14} />
                Save
              </button>
              <button className="btn btn--primary" onClick={() => setModal({ kind: "export" })} title={`Export  ${MOD}E`}>
                <ExportIcon size={14} />
                Export
              </button>
            </>
          )}
        </nav>
      </header>

      {project ? (
        <Workspace focus={focusLayout}>
          <VideoPane
            videoRef={videoRef}
            video={video}
            videoName={videoName}
            active={active}
            onAttach={pickVideo}
            onToggle={togglePlay}
            onLoaded={setVideoDuration}
            onPlaying={setPlaying}
            onError={onVideoError}
            onReady={onVideoReady}
            fieldsFor={fieldsFor}
            playResY={resolution.y}
          />
          {selected ? (
            <LineEditor
              event={selected}
              index={selectedIndex}
              total={events.length}
              terms={suggestions.terms}
              translating={translating}
              styles={styles}
              editorRef={editorRef}
              onChange={(patch, group) => updateEvent(selected.id, patch, group)}
              onConfirm={confirm}
              onPlayLine={playLine}
              onInsertTerm={insertIntoEditor}
              onLookUp={lookUp}
              syntax={project.document.format === "srt" ? "html" : "ass"}
              fields={documentFields(project.document, selected.style)}
              onStyles={() => setModal({ kind: "styles" })}
              issues={issuesById.get(selected.id) ?? []}
              onFix={applyFixes}
              cpsLimit={limits.cps}
              onSplit={(caret) => splitLine(selected.id, caret)}
              onMerge={() => mergeNext(selected.id)}
              canMerge={selectedIndex >= 0 && selectedIndex < events.length - 1}
              misspellings={spellCache.current.get(toEditable(selected.text)) ?? null}
              onAddWord={addWord}
            />
          ) : (
            <section className="editor editor--empty">
              <p className="empty">This file has no lines.</p>
            </section>
          )}
          <MemoryPanel
            tab={tab}
            onTab={setTab}
            suggestions={suggestions}
            loading={suggesting}
            hasLine={Boolean(selected?.source.trim())}
            stats={stats}
            glossaryDraft={glossaryDraft}
            dictRequest={dictRequest}
            onApply={applyMatch}
            onInsert={insertIntoEditor}
            onForget={forget}
            onGlossaryChanged={() => {
              refreshStats();
              setMemoryRev((r) => r + 1);
            }}
            onNotify={notify}
            view={sideView}
            onView={setSideView}
            issueCount={issues.length}
            errorCount={issueErrors}
            checks={
              <ChecksPanel
                issues={issues}
                events={events}
                limits={limits}
                selectedId={selectedId}
                onLimits={setLimits}
                onSelect={select}
                onFix={applyFixes}
              />
            }
          />
          <Transport
            events={events}
            selectedId={selectedId}
            time={time}
            duration={duration}
            playing={playing}
            canPlay={Boolean(video.src)}
            pps={pps}
            onPps={setPps}
            onToggle={togglePlay}
            onStep={step}
            onMove={move}
            onPlayLine={playLine}
            onJump={select}
          />
          <Timeline
            events={events}
            selectedId={selectedId}
            time={time}
            duration={duration}
            playing={playing}
            translating={translating}
            pps={pps}
            onPps={setPps}
            peaks={peaks}
            peaksStatus={peaksStatus}
            onSeek={seek}
            onSelect={select}
            onTiming={(id, start, end) => updateEvent(id, { start, end }, `drag:${id}`)}
            theme={theme}
          />
          <SubtitleGrid events={events} selectedId={selectedId} translating={translating} onSelect={select} issues={issuesById} cpsLimit={limits.cps} />
        </Workspace>
      ) : (
        <main className="welcome">
          <div className="welcome__panel">
            <HongsaIcon size={88} />
            <h1>HongsaSub</h1>
            <p className="welcome__lead">Translate film subtitles into Mon. Every line you confirm is remembered and offered again when the same or a similar line comes back.</p>
            <div className="welcome__actions">
              <button className="btn btn--primary btn--large" onClick={openFile}>
                <FolderIcon size={15} />
                Open subtitle or project…
              </button>
              <button className="btn btn--large" onClick={() => setModal({ kind: "import" })}>
                <MemoryIcon size={15} />
                Teach memory from finished work…
              </button>
            </div>
            {stats && (
              <p className="welcome__memory">
                {stats.segments > 0 ? (
                  <>
                    Memory holds <b className="num">{stats.segments.toLocaleString()}</b> lines and <b className="num">{stats.terms.toLocaleString()}</b> glossary terms from{" "}
                    <b className="num">{stats.works.toLocaleString()}</b> {stats.works === 1 ? "film" : "films"}.
                  </>
                ) : (
                  <>Memory is empty. Teach it from a finished English and Mon pair, or start translating.</>
                )}
              </p>
            )}
            <dl className="welcome__keys">
              <div>
                <dt>
                  <kbd>{MOD}{ENTER}</kbd>
                </dt>
                <dd>Confirm the line and go to the next</dd>
              </div>
              <div>
                <dt>
                  <kbd>{MOD}1</kbd>–<kbd>{MOD}9</kbd>
                </dt>
                <dd>Use a memory match</dd>
              </div>
              <div>
                <dt>
                  <kbd>{ALT}↑</kbd> <kbd>{ALT}↓</kbd>
                </dt>
                <dd>Move between lines</dd>
              </div>
              <div>
                <dt>
                  <kbd>{ALT}P</kbd>
                </dt>
                <dd>Play the current line</dd>
              </div>
              <div>
                <dt>
                  <kbd>{MOD}Z</kbd> <kbd>{MOD}{SHIFT}Z</kbd>
                </dt>
                <dd>Undo and redo text and timing edits</dd>
              </div>
              <div>
                <dt>
                  <kbd>{MOD}D</kbd>
                </dt>
                <dd>Look up the selected word in the Mon dictionary</dd>
              </div>
            </dl>
          </div>
        </main>
      )}

      {modal?.kind === "open-mode" && (
        <OpenModeModal path={modal.path} onPick={(mode) => openSubtitle(modal.path, mode)} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "export" && (
        <ExportModal translating={translating} onExport={exportTo} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "fill" && project && (
        <FillModal
          open={events.filter((e) => e.kind === "dialogue" && e.source.trim() && !plainText(e.text)).length}
          onFill={fillFromMemory}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "replace" && project && <ReplaceModal events={events} onReplace={replaceAll} onSelect={select} onClose={() => setModal(null)} />}
      {modal?.kind === "shift" && project && (
        <ShiftModal selectedIndex={selectedIndex} total={events.length} onShift={shiftTimings} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "import" && <ImportModal onCommit={importPairs} onClose={() => setModal(null)} />}
      {modal?.kind === "styles" && project && (
        <StyleManager
          styles={project.document.styles}
          styleFormat={project.document.styleFormat}
          usage={styleUsage}
          srt={project.document.format === "srt"}
          playResX={resolution.x}
          onChange={updateStyles}
          onNotify={notify}
          onClose={() => setModal(null)}
        />
      )}
      {toast && (
        <div className={`toast toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
