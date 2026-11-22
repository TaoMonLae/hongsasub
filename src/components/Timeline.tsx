import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Peaks, SubtitleEvent } from "../lib/api";
import { plainText } from "../lib/text";
import { formatDuration, formatShort, formatTime } from "../lib/time";
import { MAX_PPS, MIN_PPS } from "./Transport";

interface Props {
  events: SubtitleEvent[];
  selectedId: string | null;
  time: number;
  duration: number;
  playing: boolean;
  translating: boolean;
  pps: number;
  onPps: (pps: number) => void;
  peaks: Peaks | null;
  peaksStatus: "idle" | "loading" | "ready" | "error";
  onSeek: (ms: number) => void;
  onSelect: (id: string) => void;
  onTiming: (id: string, start: number, end: number, group: string) => void;
  snap: boolean;
  theme: string;
}

type DragMode = "start" | "end" | "move" | "scrub";
type TrackKey = "mon" | "en" | "audio";

interface Drag {
  id: string;
  mode: DragMode;
  group: string;
  originX: number;
  originMs: number;
  lastX: number;
  free: boolean;
  start: number;
  end: number;
  moved: boolean;
  points: number[] | null;
}

interface Track {
  key: TrackKey;
  label: string;
  top: number;
  height: number;
}

const RULER = 22;
const AUDIO = 40;
const MIN_LENGTH = 100;
const SNAP_PX = 8;
const EDGE_PX = 36;
const GRIP_PX = 7;

let dragCount = 0;

function speechEdges(peaks: Peaks | null): number[] {
  if (!peaks || peaks.peaks.length === 0 || peaks.rate <= 0) return [];
  const list = peaks.peaks;
  const max = list.reduce((m, v) => (v > m ? v : m), 0);
  if (max <= 0) return [];
  const loud = max * 0.14;
  const quiet = max * 0.06;
  const out: number[] = [];
  let speaking = false;
  let silentFor = 0;
  const hold = Math.max(1, Math.round(peaks.rate * 0.15));
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    if (!speaking && v >= loud) {
      speaking = true;
      silentFor = 0;
      out.push(Math.round((i / peaks.rate) * 1000));
    } else if (speaking) {
      silentFor = v < quiet ? silentFor + 1 : 0;
      if (silentFor >= hold) {
        speaking = false;
        out.push(Math.round(((i - hold + 1) / peaks.rate) * 1000));
      }
    }
  }
  return out;
}

function nearest(points: number[], value: number, range: number): number | null {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  let best: number | null = null;
  for (const i of [lo - 1, lo]) {
    const p = points[i];
    if (p === undefined) continue;
    if (Math.abs(p - value) <= range && (best === null || Math.abs(p - value) < Math.abs(best - value))) best = p;
  }
  return best;
}

function tickStep(pps: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 76) ?? 600;
}

function assignLanes(events: SubtitleEvent[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const laneEnds: number[] = [];
  const sorted = [...events].sort((a, b) => a.start - b.start);
  for (const ev of sorted) {
    let lane = laneEnds.findIndex((end) => end <= ev.start);
    if (lane === -1) {
      lane = laneEnds.length < 3 ? laneEnds.length : 2;
      if (lane >= laneEnds.length) laneEnds.push(ev.end);
    }
    laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, ev.end);
    lanes.set(ev.id, lane);
  }
  return lanes;
}

function cssVar(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export function Timeline(props: Props) {
  const { events, selectedId, time, duration, playing, translating, pps, onPps, peaks, peaksStatus, onSeek, onSelect, onTiming, snap, theme } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewW, setViewW] = useState(800);
  const [viewH, setViewH] = useState(160);
  const [scrollLeft, setScrollLeft] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ id: string; mode: DragMode } | null>(null);
  const speech = useMemo(() => speechEdges(peaks), [peaks]);

  const totalW = Math.max(viewW, (duration / 1000) * pps + 120);
  const dialogue = useMemo(() => events.filter((e) => e.kind === "dialogue"), [events]);
  const lanes = useMemo(() => assignLanes(dialogue), [dialogue]);
  const laneCount = Math.max(1, ...Array.from(lanes.values()).map((l) => l + 1));

  const tracks = useMemo<Track[]>(() => {
    const textKeys: TrackKey[] = translating ? ["mon", "en"] : ["mon"];
    const area = Math.max(40, viewH - RULER - AUDIO);
    const each = area / textKeys.length;
    const list: Track[] = textKeys.map((key, i) => ({
      key,
      label: key === "mon" ? (translating ? "Mon" : "Subtitles") : "English",
      top: RULER + i * each,
      height: each,
    }));
    list.push({ key: "audio", label: "Audio", top: RULER + area, height: AUDIO });
    return list;
  }, [translating, viewH]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth);
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);
    const wave = cssVar(canvas, "--wave", "#5d7d9a");
    const band = cssVar(canvas, "--track-band", "#1f1f21");
    const sep = cssVar(canvas, "--track-sep", "#111");
    const tick = cssVar(canvas, "--tick", "#555");
    const label = cssVar(canvas, "--tick-label", "#8e8e93");

    tracks.forEach((t, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = band;
        ctx.fillRect(0, t.top, viewW, t.height);
      }
      ctx.fillStyle = sep;
      ctx.fillRect(0, Math.round(t.top), viewW, 1);
    });

    const audio = tracks[tracks.length - 1];
    if (peaks && peaks.peaks.length > 0) {
      const mid = audio.top + audio.height / 2;
      const amp = audio.height / 2 - 5;
      ctx.fillStyle = wave;
      const perPx = peaks.rate / pps;
      for (let x = 0; x < viewW; x++) {
        const t0 = Math.floor(((scrollLeft + x) / pps) * peaks.rate);
        const t1 = Math.max(t0 + 1, Math.floor(t0 + perPx));
        let max = 0;
        for (let i = t0; i < t1 && i < peaks.peaks.length; i++) {
          if (peaks.peaks[i] > max) max = peaks.peaks[i];
        }
        const h = (max / 255) * amp;
        if (h > 0.4) ctx.fillRect(x, mid - h, 1, h * 2);
      }
    }

    const step = tickStep(pps);
    const minor = step / 5;
    ctx.font = "10px ui-monospace, 'SF Mono', Menlo, monospace";
    ctx.textBaseline = "middle";
    const firstMinor = Math.floor(scrollLeft / pps / minor) * minor;
    ctx.fillStyle = tick;
    for (let s = firstMinor; s * pps < scrollLeft + viewW; s += minor) {
      const x = Math.round(s * pps - scrollLeft) + 0.5;
      ctx.fillRect(x, RULER - 4, 1, 4);
    }
    const firstSecond = Math.floor(scrollLeft / pps / step) * step;
    for (let s = firstSecond; s * pps < scrollLeft + viewW; s += step) {
      const x = Math.round(s * pps - scrollLeft) + 0.5;
      ctx.fillStyle = tick;
      ctx.fillRect(x, RULER - 9, 1, 9);
      ctx.fillStyle = label;
      ctx.fillText(formatShort(s * 1000), x + 4, 8);
    }
    ctx.fillStyle = sep;
    ctx.fillRect(0, RULER - 1, viewW, 1);
  }, [peaks, pps, scrollLeft, viewW, viewH, tracks, theme]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = (time / 1000) * pps;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2);
    }
  }, [time, pps, playing]);

  useEffect(() => {
    const el = scrollRef.current;
    const ev = events.find((e) => e.id === selectedId);
    if (!el || !ev || dragRef.current) return;
    const a = (ev.start / 1000) * pps;
    const b = (ev.end / 1000) * pps;
    if (a < el.scrollLeft || b > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, a - el.clientWidth * 0.3), behavior: "smooth" });
    }
  }, [selectedId, pps]);

  const zoomRef = useRef({ pps, onPps });
  zoomRef.current = { pps, onPps };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { pps: current, onPps: setZoom } = zoomRef.current;
      const rect = el.getBoundingClientRect();
      const anchorX = e.clientX - rect.left;
      const anchorSec = (el.scrollLeft + anchorX) / current;
      const next = Math.min(MAX_PPS, Math.max(MIN_PPS, current * (e.deltaY < 0 ? 1.15 : 0.87)));
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = anchorSec * next - anchorX;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const live = useRef({ pps, dialogue, speech, time, snap, onTiming, onSeek });
  live.current = { pps, dialogue, speech, time, snap, onTiming, onSeek };

  const msFromClientX = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, ((clientX - rect.left + el.scrollLeft) / live.current.pps) * 1000);
  };

  const applyDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const now = live.current;
    const at = msFromClientX(drag.lastX);
    if (drag.mode === "scrub") {
      now.onSeek(at);
      return;
    }
    if (!drag.moved) return;
    const delta = Math.round((at - drag.originMs) / 10) * 10;
    const range = (SNAP_PX / now.pps) * 1000;
    drag.points ??= [...now.dialogue.filter((d) => d.id !== drag.id).flatMap((d) => [d.start, d.end]), now.time, ...now.speech].sort((x, y) => x - y);
    const points = drag.free || !now.snap ? [] : drag.points;
    const near = (v: number) => nearest(points, v, range);
    let start = drag.start;
    let end = drag.end;
    let hit: number | null = null;
    if (drag.mode === "start") {
      const raw = drag.start + delta;
      hit = near(raw);
      start = Math.min(drag.end - MIN_LENGTH, Math.max(0, hit ?? raw));
      if (start !== hit) hit = null;
    }
    if (drag.mode === "end") {
      const raw = drag.end + delta;
      hit = near(raw);
      end = Math.max(drag.start + MIN_LENGTH, hit ?? raw);
      if (end !== hit) hit = null;
    }
    if (drag.mode === "move") {
      let shift = Math.max(-drag.start, delta);
      const a = near(drag.start + shift);
      const b = near(drag.end + shift);
      const da = a === null ? Infinity : Math.abs(a - (drag.start + shift));
      const db = b === null ? Infinity : Math.abs(b - (drag.end + shift));
      if (a !== null && da <= db) {
        shift = a - drag.start;
        hit = a;
      } else if (b !== null && b - drag.end >= -drag.start) {
        shift = b - drag.end;
        hit = b;
      }
      start = drag.start + shift;
      end = drag.end + shift;
    }
    setGuide(hit);
    now.onTiming(drag.id, start, end, drag.group);
  };

  const startDrag = (e: React.PointerEvent, id: string, mode: DragMode, start: number, end: number) => {
    dragCount += 1;
    dragRef.current = {
      id,
      mode,
      group: `drag:${id}:${dragCount}`,
      originX: e.clientX,
      originMs: msFromClientX(e.clientX),
      lastX: e.clientX,
      free: e.altKey,
      start,
      end,
      moved: false,
      points: null,
    };
    setDragging({ id, mode });
  };

  const beginDrag = (e: React.PointerEvent, ev: SubtitleEvent, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startDrag(e, ev.id, mode, ev.start, ev.end);
    if (ev.id !== selectedId) onSelect(ev.id);
  };

  const beginScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.button !== 0 || e.clientY > el.getBoundingClientRect().top + el.clientHeight) return;
    el.setPointerCapture(e.pointerId);
    startDrag(e, "", "scrub", 0, 0);
    onSeek(msFromClientX(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.lastX = e.clientX;
    drag.free = e.altKey;
    if (Math.abs(e.clientX - drag.originX) > 2) drag.moved = true;
    applyDrag();
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setGuide(null);
    setDragging(null);
    if (drag && !drag.moved && drag.mode === "move") onSeek(drag.start);
  };

  useEffect(() => {
    if (!dragging) return;
    const el = scrollRef.current;
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current;
      if (el && drag && (drag.moved || drag.mode === "scrub")) {
        const rect = el.getBoundingClientRect();
        const over = drag.lastX < rect.left + EDGE_PX ? drag.lastX - rect.left - EDGE_PX : drag.lastX > rect.right - EDGE_PX ? drag.lastX - rect.right + EDGE_PX : 0;
        if (over !== 0) {
          const before = el.scrollLeft;
          el.scrollLeft = before + Math.max(-28, Math.min(28, over * 0.5));
          if (el.scrollLeft !== before) applyDrag();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => {
      const drag = dragRef.current;
      if (e.key !== "Escape" || !drag) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.moved && drag.mode !== "scrub") live.current.onTiming(drag.id, drag.start, drag.end, drag.group);
      dragRef.current = null;
      setGuide(null);
      setDragging(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [dragging]);

  const visibleFrom = ((scrollLeft - 200) / pps) * 1000;
  const visibleTo = ((scrollLeft + viewW + 200) / pps) * 1000;
  const visible = dialogue.filter((ev) => (ev.end >= visibleFrom && ev.start <= visibleTo) || ev.id === dragging?.id);
  const dragged = dragging && dragging.mode !== "scrub" ? dialogue.find((ev) => ev.id === dragging.id) : undefined;
  const textTracks = tracks.filter((t) => t.key !== "audio");
  const audioNote =
    peaksStatus === "loading" ? "Reading audio…" : peaksStatus === "error" ? "No waveform: ffmpeg not found" : peaksStatus === "idle" ? "No video" : "";

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline__heads" style={{ gridTemplateRows: `${RULER}px ${tracks.map((t) => `${t.height}px`).join(" ")}` }}>
        <span className="timeline__corner" title="Drag a clip to move it, drag its edges to retime. Edges snap to other lines, the playhead and speech; hold Option to drag freely, press Esc to cancel. Drag empty space to scrub. Ctrl + scroll zooms.">
          Tracks
        </span>
        {tracks.map((t) => (
          <div key={t.key} className={`track-head track-head--${t.key}`}>
            <span className="track-head__swatch" aria-hidden />
            <span className="track-head__label">{t.label}</span>
            {t.key === "audio" && audioNote && <span className="track-head__note">{audioNote}</span>}
          </div>
        ))}
      </div>
      <div
        className={`timeline__scroll${dragging ? ` is-${dragging.mode === "scrub" ? "scrubbing" : "dragging"}` : ""}`}
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerDown={beginScrub}
      >
        <div className="timeline__inner" style={{ width: totalW }}>
          <canvas className="timeline__canvas" ref={canvasRef} style={{ width: viewW, height: viewH }} />
          {textTracks.map((track) =>
            visible.map((ev) => {
              const lane = lanes.get(ev.id) ?? 0;
              const inner = track.height - 8;
              const h = Math.max(14, inner / laneCount - 3);
              const top = track.top + 4 + lane * (h + 3) + (inner - laneCount * (h + 3) + 3) / 2;
              const left = (ev.start / 1000) * pps;
              const width = Math.max(4, ((ev.end - ev.start) / 1000) * pps);
              const grip = Math.min(GRIP_PX, Math.max(2, width / 3));
              const isMon = track.key === "mon";
              const text = isMon ? plainText(ev.text) : plainText(ev.source);
              const statusClass = isMon ? ` clip--${translating ? ev.status : "confirmed"}` : " clip--source";
              return (
                <div
                  key={`${track.key}-${ev.id}`}
                  className={`clip${statusClass}${ev.id === selectedId ? " is-selected" : ""}${ev.id === dragging?.id ? " is-dragging" : ""}`}
                  style={{ left, width, top, height: h }}
                  onPointerDown={(e) => beginDrag(e, ev, "move")}
                  title={text || "Untranslated"}
                >
                  <span className="clip__handle clip__handle--start" style={{ width: grip }} onPointerDown={(e) => beginDrag(e, ev, "start")} />
                  <span className={`clip__label${isMon && text ? " mon" : ""}`}>{text}</span>
                  <span className="clip__handle clip__handle--end" style={{ width: grip }} onPointerDown={(e) => beginDrag(e, ev, "end")} />
                </div>
              );
            }),
          )}
          <div className="playhead" style={{ left: (time / 1000) * pps }} />
          {guide !== null && <div className="snapguide" style={{ left: (guide / 1000) * pps }} aria-hidden />}
          {dragged && (
            <div className="dragtip num" style={{ left: (dragged.start / 1000) * pps }} aria-hidden>
              {formatTime(dragged.start)} – {formatTime(dragged.end)} · {formatDuration(dragged.end - dragged.start)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
