import { useEffect, useState, type ReactNode } from "react";
import { api, errorText, type Concordance, type DictEntry, type GlossaryTerm, type SuggestResponse, type TmStats } from "../lib/api";
import { displayLines } from "../lib/text";
import { MOD } from "../lib/keys";
import { CloseIcon, SearchIcon } from "./Icons";

export type MemoryTab = "matches" | "search" | "glossary" | "dictionary";
export type SideView = "memory" | "assist" | "checks";
export type DictRequest = { text: string; n: number };

interface Props {
  tab: MemoryTab;
  onTab: (tab: MemoryTab) => void;
  suggestions: SuggestResponse;
  loading: boolean;
  hasLine: boolean;
  stats: TmStats | null;
  glossaryDraft: string;
  dictRequest: DictRequest;
  onApply: (index: number) => void;
  onInsert: (text: string) => void;
  onForget: (id: string) => void;
  onGlossaryChanged: () => void;
  memoryRev: number;
  onNotify: (text: string, tone?: "ok" | "error") => void;
  view: SideView;
  onView: (view: SideView) => void;
  issueCount: number;
  errorCount: number;
  checks: ReactNode;
  assist: ReactNode;
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < day * 30) return `${Math.floor(diff / day)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function tier(score: number) {
  if (score === 100) return "exact";
  if (score >= 85) return "high";
  return "low";
}

function Matches(props: Props) {
  const { suggestions, loading, hasLine, onApply, onInsert, onForget } = props;
  if (!hasLine) return <p className="empty">Select a line with English text to see what you translated before.</p>;
  return (
    <div className="matches">
      {suggestions.terms.length > 0 && (
        <section className="terms" aria-label="Glossary terms in this line">
          <h3 className="pane-label">Glossary in this line</h3>
          <div className="terms__list">
            {suggestions.terms.map((t) => (
              <button key={t.id} className="term" onClick={() => onInsert(t.target)} title={t.note || "Insert at cursor"}>
                <span>{t.source}</span>
                <b className="mon">{t.target}</b>
              </button>
            ))}
          </div>
        </section>
      )}
      {suggestions.matches.length === 0 && !loading && (
        <p className="empty">Nothing in memory is close to this line yet. Confirm your translation and it will be offered next time.</p>
      )}
      {suggestions.matches.length === 0 && loading && (
        <div className="skeleton" aria-label="Looking up memory">
          <span />
          <span />
          <span />
        </div>
      )}
      <ol className="match-list">
        {suggestions.matches.map((m, i) => (
          <li key={m.id} className={`match match--${tier(m.score)}`}>
            <button className="match__body" onClick={() => onApply(i)}>
              <span className="match__top">
                <span className={`score num score--${tier(m.score)}`}>{m.score}%</span>
                {m.contextMatch && <span className="tag">Same scene</span>}
                {m.sameWork && <span className="tag">This film</span>}
                <span className="spacer" />
                {i < 9 && (
                  <kbd>
                    {MOD}
                    {i + 1}
                  </kbd>
                )}
              </span>
              <span className="match__target mon">{displayLines(m.target)}</span>
              <span className="match__source">
                {m.diff.length === 0
                  ? displayLines(m.source)
                  : m.diff.map((d, k) => (
                      <span key={k} className={`diff diff--${d.op}`}>
                        {d.text}{" "}
                      </span>
                    ))}
              </span>
              <span className="match__meta">
                {m.work || "Untitled"} · {m.useCount > 1 ? `used ${m.useCount} times` : ago(m.updatedAt)}
              </span>
            </button>
            <button className="match__forget icon-btn icon-btn--small" onClick={() => onForget(m.id)} aria-label="Remove from memory" title="Remove from memory">
              <CloseIcon size={12} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Search({ onInsert, onNotify }: Pick<Props, "onInsert" | "onNotify">) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Concordance[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .concordance(q, 80)
        .then((r) => {
          if (!cancelled) setResults(r);
        })
        .catch((e) => {
          if (!cancelled) onNotify(errorText(e), "error");
        });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);
  return (
    <div className="search">
      <label className="searchfield">
        <SearchIcon size={14} />
        <input
          placeholder="Search English or Mon"
          aria-label="Search memory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </label>
      {!query && <p className="empty">Find every earlier translation of a word or phrase, in either language.</p>}
      {query && results.length === 0 && <p className="empty">Nothing found for “{query}”.</p>}
      <ul className="concordance">
        {results.map((r) => (
          <li key={r.id}>
            <button onClick={() => onInsert(r.target)}>
              <p className="mon">{displayLines(r.target)}</p>
              <p className="concordance__src">{displayLines(r.source)}</p>
              <span className="match__meta">
                {r.work || "Untitled"} · {r.useCount > 1 ? `used ${r.useCount} times` : ago(r.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Glossary({ glossaryDraft, onInsert, onGlossaryChanged, onNotify, memoryRev }: Props) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [source, setSource] = useState(glossaryDraft);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");

  const load = () => api.glossaryList().then(setTerms).catch((e) => onNotify(errorText(e), "error"));
  useEffect(() => {
    load();
  }, [memoryRev]);
  useEffect(() => setSource(glossaryDraft), [glossaryDraft]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const term = await api.glossaryAdd(source, target, note);
      if (!term) return;
      setSource("");
      setTarget("");
      setNote("");
      await load();
      onGlossaryChanged();
    } catch (err) {
      onNotify(errorText(err), "error");
    }
  };

  const remove = async (id: string) => {
    try {
      await api.glossaryDelete(id);
      await load();
      onGlossaryChanged();
    } catch (err) {
      onNotify(errorText(err), "error");
    }
  };

  const shown = terms.filter(
    (t) => !filter || t.source.toLowerCase().includes(filter.toLowerCase()) || t.target.includes(filter),
  );

  return (
    <div className="glossary">
      <form className="glossary__form" onSubmit={add}>
        <input className="field" placeholder="English word or name" aria-label="English" value={source} onChange={(e) => setSource(e.target.value)} />
        <input className="field mon" lang="mnw" placeholder="Mon" aria-label="Mon" value={target} onChange={(e) => setTarget(e.target.value)} />
        <input className="field" placeholder="Note, optional" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn--primary" disabled={!source.trim() || !target.trim()}>
          Add term
        </button>
      </form>
      {terms.length > 6 && (
        <label className="searchfield">
          <SearchIcon size={14} />
          <input placeholder="Filter terms" aria-label="Filter terms" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}
      {terms.length === 0 && <p className="empty">Names, places and recurring words go here so they stay the same across the film.</p>}
      <ul className="glossary__list">
        {shown.map((t) => (
          <li key={t.id}>
            <button className="glossary__item" onClick={() => onInsert(t.target)}>
              <span>{t.source}</span>
              <b className="mon">{t.target}</b>
              {t.note && <small>{t.note}</small>}
            </button>
            <button className="match__forget icon-btn icon-btn--small" onClick={() => remove(t.id)} aria-label={`Delete ${t.source}`} title="Delete term">
              <CloseIcon size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANG_LABEL: Record<string, string> = { eng: "EN", mya: "MY", tha: "TH", mnw: "MN" };
const LANG_ATTR: Record<string, string> = { eng: "en", mya: "my", tha: "th", mnw: "mnw" };
const POS_LABEL: Record<string, string> = {
  n: "noun",
  v: "verb",
  adv: "adverb",
  adj: "adjective",
  prep: "preposition",
  pron: "pronoun",
  conj: "conjunction",
  clf: "classifier",
  pali: "Pali",
  sansakrit: "Sanskrit",
  uncl: "",
  int: "interjection",
  num: "number",
  part: "particle",
  art: "article",
  prefix: "prefix",
  suffix: "suffix",
  aux: "auxiliary",
  abbr: "abbreviation",
};
const FOLDED_PER_LANG: Record<string, number> = { eng: 4, mya: 2, tha: 1, mnw: 3 };
const MON_NUMBER = /^[\u1040-\u1049\d]+$/;

function posLabel(pos: string) {
  return pos
    .split("/")
    .filter(Boolean)
    .map((p) => POS_LABEL[p] ?? p)
    .filter(Boolean)
    .join(", ");
}

function glossGroups(text: string) {
  const groups: string[][] = [[]];
  for (const raw of text.split(/[\u104A\u104B]/)) {
    const item = raw.trim();
    if (!item) continue;
    if (MON_NUMBER.test(item)) {
      if (groups[groups.length - 1].length) groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(item);
  }
  return groups.filter((g) => g.length);
}

function EnglishEntry({ entry, onInsert }: { entry: DictEntry; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? entry.senses : entry.senses.slice(0, FOLDED_PER_LANG.mnw);
  const hidden = entry.senses.length - shown.length;
  return (
    <li className="dict__entry dict__entry--english">
      <div className="dict__head dict__head--static">
        <b lang="en">{entry.word}</b>
      </div>
      <ol className="dict__senses">
        {shown.map((s, i) => (
          <li key={i} className="dict__sense dict__sense--mnw">
            <span className="dict__lang">{LANG_LABEL.mnw}</span>
            <span className="dict__text">
              {posLabel(s.pos) && <em className="dict__pos">{posLabel(s.pos)}</em>}
              {s.example && <span className="dict__note">{s.example}</span>}
              {glossGroups(s.text).map((group, g) => (
                <span key={g} className="dict__glosses">
                  {group.map((item, k) => (
                    <button key={k} className="dict__gloss mon" lang="mnw" onClick={() => onInsert(item)} title="Insert at cursor">
                      {item}
                    </button>
                  ))}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <button className="btn btn--plain btn--small dict__more" onClick={() => setOpen(true)}>
          {hidden} more {hidden === 1 ? "meaning" : "meanings"}
        </button>
      )}
    </li>
  );
}

function DictionaryEntry({ entry, onInsert }: { entry: DictEntry; onInsert: (text: string) => void }) {
  if (entry.kind === "english") return <EnglishEntry entry={entry} onInsert={onInsert} />;
  const [open, setOpen] = useState(false);
  const shown = open
    ? entry.senses
    : entry.senses.filter((s, i, all) => all.slice(0, i).filter((x) => x.lang === s.lang).length < (FOLDED_PER_LANG[s.lang] ?? 1));
  const hidden = entry.senses.length - shown.length;
  return (
    <li className="dict__entry">
      <button className="dict__head" onClick={() => onInsert(entry.word)} title="Insert at cursor">
        <b className="mon" lang="mnw">
          {entry.word}
        </b>
        {entry.ipa && <span className="dict__ipa">/{entry.ipa}/</span>}
      </button>
      <ol className="dict__senses">
        {shown.map((s, i) => (
          <li key={i} className={`dict__sense dict__sense--${s.lang}`}>
            <span className="dict__lang">{LANG_LABEL[s.lang] ?? s.lang}</span>
            <span className="dict__text" lang={LANG_ATTR[s.lang]}>
              {posLabel(s.pos) && <em className="dict__pos">{posLabel(s.pos)}</em>}
              {s.text}
              {s.example && <span className="dict__example">{s.example}</span>}
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <button className="btn btn--plain btn--small dict__more" onClick={() => setOpen(true)}>
          {hidden} more {hidden === 1 ? "meaning" : "meanings"}
        </button>
      )}
    </li>
  );
}

function DictionaryView({ dictRequest, onInsert }: Pick<Props, "dictRequest" | "onInsert">) {
  const [query, setQuery] = useState(dictRequest.text);
  const [results, setResults] = useState<DictEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => setQuery(dictRequest.text), [dictRequest]);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(() => {
      api
        .dictLookup(q, 40)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setError(null);
        })
        .catch((e) => {
          if (!cancelled) setError(errorText(e));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);
  return (
    <div className="dict">
      <label className="searchfield">
        <SearchIcon size={14} />
        <input
          placeholder="English or Mon word"
          aria-label="Look up in dictionary"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          spellCheck={false}
        />
      </label>
      {error && <p className="empty">{error}</p>}
      {!error && !query.trim() && (
        <p className="empty">
          Look up an English word to find Mon words for it, or a Mon word to see its meaning. Double-click a word in the English line, or select
          it and press {MOD}D.
        </p>
      )}
      {!error && query.trim() && !searching && results.length === 0 && <p className="empty">No entries for “{query.trim()}”.</p>}
      <ul className="dict__list">
        {results.map((entry) => (
          <DictionaryEntry key={`${entry.kind}-${entry.id}`} entry={entry} onInsert={onInsert} />
        ))}
      </ul>
      <p className="dict__credit">
        Dictionary data: MonDictDB (MIT licence) and the Mon–English dictionary by Nai Aung Nyan Lynn, Nai Tun Wai and others from Nai Saik
        Chan’s mon2engdict app, used with permission.
      </p>
    </div>
  );
}

export function MemoryPanel(props: Props) {
  const { tab, onTab, stats, suggestions, view, onView, issueCount, errorCount, checks, assist } = props;
  const tabs: { id: MemoryTab; label: string; count?: number }[] = [
    { id: "matches", label: "Matches", count: suggestions.matches.length },
    { id: "search", label: "Search" },
    { id: "glossary", label: "Glossary" },
    { id: "dictionary", label: "Dictionary" },
  ];
  return (
    <aside className="memory" aria-label={view === "checks" ? "Quality checks" : view === "assist" ? "Translation assistant" : "Translation memory"}>
      <header className="memory__head">
        <div className="memory__title">
          <div className="sideswitch" role="tablist" aria-label="Side panel">
            <button role="tab" aria-selected={view === "memory"} className={view === "memory" ? "is-on" : ""} onClick={() => onView("memory")}>
              Memory
            </button>
            <button role="tab" aria-selected={view === "assist"} className={view === "assist" ? "is-on" : ""} onClick={() => onView("assist")}>
              Assist
            </button>
            <button role="tab" aria-selected={view === "checks"} className={view === "checks" ? "is-on" : ""} onClick={() => onView("checks")}>
              Checks
              {issueCount > 0 && <em className={`num sideswitch__badge${errorCount > 0 ? " is-error" : ""}`}>{issueCount}</em>}
            </button>
          </div>
          {view === "memory" && stats && (
            <span className="memory__stats">
              <span className="num">{stats.segments.toLocaleString()}</span> lines · <span className="num">{stats.terms.toLocaleString()}</span> terms
            </span>
          )}
        </div>
        {view === "memory" && (
          <div className="segmented" role="tablist" aria-label="Memory views">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => onTab(t.id)}>
                {t.label}
                {t.count ? <em className="num">{t.count}</em> : null}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="memory__body" role="tabpanel">
        {view === "checks" && checks}
        {view === "assist" && assist}
        {view === "memory" && tab === "matches" && <Matches {...props} />}
        {view === "memory" && tab === "search" && <Search onInsert={props.onInsert} onNotify={props.onNotify} />}
        {view === "memory" && tab === "glossary" && <Glossary {...props} />}
        {view === "memory" && tab === "dictionary" && <DictionaryView dictRequest={props.dictRequest} onInsert={props.onInsert} />}
      </div>
    </aside>
  );
}
