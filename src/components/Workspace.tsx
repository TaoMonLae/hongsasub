import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type PaneKey = "side" | "viewer" | "top" | "timeline";
type Sizes = Partial<Record<PaneKey, number>>;

const KEY = "hongsasub.panes";
const TRANSPORT = 44;
const GAP = 1;
const MIN = { side: 240, viewer: 200, editor: 400, top: 170, timeline: 100, grid: 96 };

function loadSizes(): Sizes {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const out: Sizes = {};
    for (const k of ["side", "viewer", "top", "timeline"] as PaneKey[]) {
      const v = Number(raw[k]);
      if (Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function storeSizes(sizes: Sizes) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  } catch {
    return;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

function layout(w: number, h: number, sizes: Sizes) {
  const side = clamp(sizes.side ?? clamp(w * 0.24, 300, 380), MIN.side, w - MIN.viewer - MIN.editor - 2 * GAP);
  const main = w - side - GAP;
  const viewer = clamp(sizes.viewer ?? main * 0.46, MIN.viewer, main - MIN.editor - GAP);
  const timeline = clamp(sizes.timeline ?? clamp(h * 0.19, 120, 196), MIN.timeline, h - TRANSPORT - MIN.top - MIN.grid - 3 * GAP);
  const top = clamp(sizes.top ?? (h - TRANSPORT - timeline) * 0.55, MIN.top, h - TRANSPORT - timeline - MIN.grid - 3 * GAP);
  return { side, main, viewer, top, timeline };
}

interface SplitterProps {
  axis: "x" | "y";
  style: CSSProperties;
  label: string;
  value: number;
  onDrag: (value: number) => void;
  onReset: () => void;
  invert?: boolean;
}

function Splitter({ axis, style, label, value, onDrag, onReset, invert }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const origin = axis === "x" ? e.clientX : e.clientY;
    const base = value;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const d = (axis === "x" ? ev.clientX : ev.clientY) - origin;
      onDrag(base + (invert ? -d : d));
    };
    const end = () => {
      setDragging(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const d = (e.key === fwd ? step : -step) * (invert ? -1 : 1);
    onDrag(value + d);
  };
  return (
    <div
      className={`splitter splitter--${axis}${dragging ? " is-dragging" : ""}`}
      style={style}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={`${label}. Drag to resize, double-click to reset.`}
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}

export function Workspace({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [sizes, setSizes] = useState<Sizes>(loadSizes);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => storeSizes(sizes), 250);
    return () => window.clearTimeout(t);
  }, [sizes]);

  const ready = box.w > 0 && box.h > 0;
  const l = layout(box.w, box.h, sizes);
  const set = (k: PaneKey) => (v: number) =>
    setSizes((s) => {
      const next = { ...s, [k]: v };
      return { ...next, [k]: Math.round(layout(box.w, box.h, next)[k]) };
    });
  const reset = (k: PaneKey) => () =>
    setSizes((s) => {
      const next = { ...s };
      delete next[k];
      return next;
    });

  const fullTop = Math.max(MIN.top, box.h - TRANSPORT - GAP);
  const style = ready
    ? ({
        gridTemplateColumns: `${l.viewer}px minmax(0, 1fr) ${l.side}px`,
        gridTemplateRows: focus ? `minmax(0, 1fr) ${TRANSPORT}px` : `${l.top}px ${TRANSPORT}px ${l.timeline}px minmax(0, 1fr)`,
      } as CSSProperties)
    : undefined;

  const timelineEdge = l.top + GAP + TRANSPORT + GAP + l.timeline;

  return (
    <main className={`workspace${focus ? " workspace--focus" : ""}`} ref={ref} style={style}>
      {children}
      {ready && (
        <>
          <Splitter
            axis="x"
            label="Side panel width"
            value={l.side}
            invert
            onDrag={set("side")}
            onReset={reset("side")}
            style={{ left: l.main, top: 0, bottom: 0 }}
          />
          <Splitter
            axis="x"
            label="Video width"
            value={l.viewer}
            onDrag={set("viewer")}
            onReset={reset("viewer")}
            style={{ left: l.viewer, top: 0, height: focus ? fullTop : l.top }}
          />
          {!focus && (
            <>
          <Splitter
            axis="y"
            label="Video and editor height"
            value={l.top}
            onDrag={set("top")}
            onReset={reset("top")}
            style={{ top: l.top, left: 0, width: l.main }}
          />
          <Splitter
            axis="y"
            label="Timeline height"
            value={l.timeline}
            onDrag={set("timeline")}
            onReset={reset("timeline")}
            style={{ top: timelineEdge, left: 0, width: l.main }}
          />
            </>
          )}
        </>
      )}
    </main>
  );
}
