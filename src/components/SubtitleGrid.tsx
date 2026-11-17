import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SubtitleEvent } from "../lib/api";
import type { Issue } from "../lib/checks";
import { cps, plainText } from "../lib/text";
import { formatTime } from "../lib/time";

interface Props {
  events: SubtitleEvent[];
  selectedId: string | null;
  translating: boolean;
  onSelect: (id: string) => void;
  issues: Map<string, Issue[]>;
  cpsLimit: number;
}

const ROW = 34;
const OVERSCAN = 8;

export function SubtitleGrid({ events, selectedId, translating, onSelect, issues, cpsLimit }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);
  const [filter, setFilter] = useState<"all" | "todo" | "issues">("all");

  const rows =
    filter === "todo"
      ? events.filter((e) => e.kind === "dialogue" && e.status !== "confirmed")
      : filter === "issues"
        ? events.filter((e) => issues.has(e.id))
        : events;
  const indexById = new Map(events.map((e, i) => [e.id, i]));

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const row = rows.findIndex((e) => e.id === selectedId);
    if (!el || row < 0) return;
    const top = row * ROW;
    if (top < el.scrollTop + ROW) el.scrollTop = Math.max(0, top - ROW * 2);
    else if (top + ROW > el.scrollTop + el.clientHeight - ROW) el.scrollTop = top - el.clientHeight + ROW * 3;
  }, [selectedId, rows.length, filter]);

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN);
  const todo = events.filter((e) => e.kind === "dialogue" && e.status !== "confirmed").length;

  return (
    <section className="grid">
      <div className="grid__bar">
        <h2 className="pane-title">Lines</h2>
        <div className="segmented segmented--small" role="tablist" aria-label="Filter lines">
          <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
            All <em className="num">{events.length}</em>
          </button>
          <button role="tab" aria-selected={filter === "todo"} className={filter === "todo" ? "is-on" : ""} onClick={() => setFilter("todo")}>
            Not confirmed <em className="num">{todo}</em>
          </button>
          <button role="tab" aria-selected={filter === "issues"} className={filter === "issues" ? "is-on" : ""} onClick={() => setFilter("issues")}>
            With problems <em className="num">{issues.size}</em>
          </button>
        </div>
      </div>
      <div className={`grid__head${translating ? "" : " grid__head--single"}`}>
        <span aria-label="Status" />
        <span>#</span>
        <span>Start</span>
        <span>End</span>
        <span>CPS</span>
        {translating && <span>English</span>}
        <span>{translating ? "Mon" : "Text"}</span>
      </div>
      <div className="grid__scroll" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {rows.slice(first, last).map((ev, i) => {
            const row = first + i;
            const rate = cps(ev.text, ev.start, ev.end);
            const target = plainText(ev.text);
            const problems = issues.get(ev.id);
            const level = problems ? (problems.some((p) => p.severity === "error") ? "error" : "warn") : null;
            return (
              <div
                key={ev.id}
                className={`grid__row${translating ? "" : " grid__row--single"}${ev.id === selectedId ? " is-selected" : ""}${
                  ev.kind === "comment" ? " is-comment" : ""
                }`}
                style={{ top: row * ROW, height: ROW }}
                onMouseDown={() => onSelect(ev.id)}
              >
                <span className={`dot dot--${ev.kind === "comment" ? "comment" : ev.status}`} />
                <span className={`num${level ? ` grid__problem grid__problem--${level}` : ""}`} title={problems?.map((p) => p.message).join("\n")}>
                  {(indexById.get(ev.id) ?? row) + 1}
                </span>
                <span className="num">{formatTime(ev.start)}</span>
                <span className="num">{formatTime(ev.end)}</span>
                <span className={`num${target && rate > cpsLimit ? " is-warn" : ""}`}>{target ? rate.toFixed(0) : "–"}</span>
                {translating && <span className="cell-src">{plainText(ev.source)}</span>}
                <span className={`cell-mon mon${target ? "" : " is-empty"}`}>{target}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
