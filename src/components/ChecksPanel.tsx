import { useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleEvent } from "../lib/api";
import { DEFAULT_LIMITS, RULE_LABELS, type Issue, type Limits, type Rule } from "../lib/checks";
import { plainText } from "../lib/text";
import { formatTime } from "../lib/time";
import { CheckIcon, PrevLineIcon, NextLineIcon, WarningIcon } from "./Icons";

interface Props {
  issues: Issue[];
  events: SubtitleEvent[];
  limits: Limits;
  selectedId: string | null;
  onLimits: (limits: Limits) => void;
  onSelect: (id: string) => void;
  onFix: (issues: Issue[]) => void;
}

const SHOWN = 400;

const LIMIT_FIELDS: { key: keyof Limits; label: string; unit: string; step: number; scale: number }[] = [
  { key: "cps", label: "Reading speed", unit: "chars/s", step: 1, scale: 1 },
  { key: "chars", label: "Row length", unit: "chars", step: 1, scale: 1 },
  { key: "lines", label: "Rows per line", unit: "rows", step: 1, scale: 1 },
  { key: "minDuration", label: "Shortest", unit: "s", step: 0.1, scale: 1000 },
  { key: "maxDuration", label: "Longest", unit: "s", step: 0.5, scale: 1000 },
  { key: "minGap", label: "Smallest gap", unit: "ms", step: 10, scale: 1 },
];

function LimitInput({ value, step, onCommit }: { value: number; step: number; onCommit: (value: number) => void }) {
  const shown = String(Number(value.toFixed(2)));
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);
  return (
    <input
      className="control num"
      type="number"
      min={step}
      step={step}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(shown);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() && Number.isFinite(v) && v > 0) onCommit(v);
      }}
    />
  );
}

export function LimitsForm({ limits, onLimits }: { limits: Limits; onLimits: (l: Limits) => void }) {
  return (
    <div className="checks__limits">
      {LIMIT_FIELDS.map((f) => (
        <label key={f.key} className="checks__limit">
          <span>{f.label}</span>
          <span className="checks__limit-input">
            <LimitInput value={limits[f.key] / f.scale} step={f.step} onCommit={(v) => onLimits({ ...limits, [f.key]: Math.round(v * f.scale) })} />
            <em>{f.unit}</em>
          </span>
        </label>
      ))}
      <button className="btn btn--plain btn--small" onClick={() => onLimits({ ...DEFAULT_LIMITS })}>
        Reset to defaults
      </button>
    </div>
  );
}

export function ChecksPanel({ issues, events, limits, selectedId, onLimits, onSelect, onFix }: Props) {
  const [severity, setSeverity] = useState<"all" | "error">("all");
  const [pickedRule, setRule] = useState<Rule | "all">("all");
  const [showLimits, setShowLimits] = useState(false);

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const ruleCounts = useMemo(() => {
    const counts = new Map<Rule, number>();
    for (const i of issues) counts.set(i.rule, (counts.get(i.rule) ?? 0) + 1);
    return counts;
  }, [issues]);
  const rule = pickedRule !== "all" && ruleCounts.has(pickedRule) ? pickedRule : "all";
  const errors = issues.filter((i) => i.severity === "error").length;
  const visible = issues.filter((i) => (severity === "all" || i.severity === "error") && (rule === "all" || i.rule === rule));
  const fixable = visible.filter((i) => i.fix);

  const groups = useMemo(() => {
    const out: { id: string; index: number; items: Issue[] }[] = [];
    for (const issue of visible) {
      const last = out[out.length - 1];
      if (last && last.id === issue.id) last.items.push(issue);
      else out.push({ id: issue.id, index: issue.index, items: [issue] });
    }
    return out;
  }, [visible]);

  const selectedIndex = events.findIndex((e) => e.id === selectedId);
  const jump = (dir: 1 | -1) => {
    if (!groups.length) return;
    const target =
      dir === 1
        ? (groups.find((g) => g.index > selectedIndex) ?? groups[0])
        : ([...groups].reverse().find((g) => g.index < selectedIndex) ?? groups[groups.length - 1]);
    onSelect(target.id);
  };

  return (
    <div className="checks">
      <div className="checks__summary">
        {issues.length === 0 ? (
          <span className="checks__ok">
            <CheckIcon size={14} />
            No problems found
          </span>
        ) : (
          <span className="checks__count">
            {errors > 0 && (
              <b className="checks__count--error">
                <span className="num">{errors}</span> {errors === 1 ? "error" : "errors"}
              </b>
            )}
            {issues.length - errors > 0 && (
              <b className="checks__count--warn">
                <span className="num">{issues.length - errors}</span> {issues.length - errors === 1 ? "warning" : "warnings"}
              </b>
            )}
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn icon-btn--small" onClick={() => jump(-1)} disabled={!groups.length} title="Previous line with a problem" aria-label="Previous problem">
          <PrevLineIcon size={13} />
        </button>
        <button className="icon-btn icon-btn--small" onClick={() => jump(1)} disabled={!groups.length} title="Next line with a problem" aria-label="Next problem">
          <NextLineIcon size={13} />
        </button>
        <button className={`btn btn--plain btn--small${showLimits ? " is-on" : ""}`} onClick={() => setShowLimits((s) => !s)} aria-expanded={showLimits}>
          Limits
        </button>
      </div>

      {showLimits && <LimitsForm limits={limits} onLimits={onLimits} />}

      {issues.length > 0 && (
        <div className="checks__filters">
          <div className="segmented segmented--small" role="tablist" aria-label="Severity">
            <button role="tab" aria-selected={severity === "all"} className={severity === "all" ? "is-on" : ""} onClick={() => setSeverity("all")}>
              All
            </button>
            <button role="tab" aria-selected={severity === "error"} className={severity === "error" ? "is-on" : ""} onClick={() => setSeverity("error")}>
              Errors <em className="num">{errors}</em>
            </button>
          </div>
          <select className="control checks__rule" value={rule} onChange={(e) => setRule(e.target.value as Rule | "all")} aria-label="Kind of problem">
            <option value="all">Every kind</option>
            {[...ruleCounts.entries()].map(([r, n]) => (
              <option key={r} value={r}>
                {RULE_LABELS[r]} ({n})
              </option>
            ))}
          </select>
          {fixable.length > 0 && (
            <button className="btn btn--small" onClick={() => onFix(fixable)} title="Apply every suggested fix shown in this list. Undo reverts them all at once.">
              Fix <span className="num">{fixable.length}</span>
            </button>
          )}
        </div>
      )}

      {issues.length > 0 && visible.length === 0 && <p className="empty">Nothing matches this filter.</p>}

      <ul className="checks__list">
        {groups.slice(0, SHOWN).map((g) => {
          const ev = byId.get(g.id);
          return (
            <li key={g.id} className={`checks__line${g.id === selectedId ? " is-selected" : ""}`}>
              <button className="checks__head" onClick={() => onSelect(g.id)}>
                <span className="checks__where">
                  Line <span className="num">{g.index + 1}</span>
                  {ev && <span className="num checks__time">{formatTime(ev.start)}</span>}
                </span>
                <span className="checks__text mon">{ev ? plainText(ev.text) || plainText(ev.source) : ""}</span>
              </button>
              <ul>
                {g.items.map((issue) => (
                  <li key={issue.key} className={`checks__issue checks__issue--${issue.severity}`}>
                    <WarningIcon size={12} />
                    <button type="button" className="checks__msg" onClick={() => onSelect(g.id)}>
                      {issue.message}
                    </button>
                    {issue.fix && (
                      <button className="btn btn--plain btn--small checks__fix" onClick={() => onFix([issue])}>
                        {issue.fix.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {groups.length > SHOWN && (
        <p className="empty">
          Showing the first {SHOWN} of {groups.length} lines. Fix these or narrow the filter to see the rest.
        </p>
      )}
    </div>
  );
}
