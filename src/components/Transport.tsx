import { useMemo, useRef } from "react";
import type { SubtitleEvent } from "../lib/api";
import { formatShort, formatTime } from "../lib/time";
import {
  BackIcon,
  ForwardIcon,
  LoopLineIcon,
  MinusIcon,
  NextLineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PrevLineIcon,
} from "./Icons";

interface Props {
  events: SubtitleEvent[];
  selectedId: string | null;
  time: number;
  duration: number;
  playing: boolean;
  canPlay: boolean;
  pps: number;
  onPps: (pps: number) => void;
  onToggle: () => void;
  onStep: (ms: number) => void;
  onMove: (delta: number) => void;
  onPlayLine: () => void;
  onJump: (id: string) => void;
}

export const MIN_PPS = 8;
export const MAX_PPS = 400;

export function Transport(props: Props) {
  const { events, selectedId, time, duration, playing, canPlay, pps, onPps, onToggle, onStep, onMove, onPlayLine, onJump } = props;
  const stripRef = useRef<HTMLDivElement>(null);
  const dialogue = useMemo(() => events.filter((e) => e.kind === "dialogue"), [events]);
  const counts = useMemo(() => {
    const c = { confirmed: 0, draft: 0, untranslated: 0, comment: 0 };
    for (const e of events) {
      if (e.kind === "comment") c.comment += 1;
      else c[e.status] += 1;
    }
    return c;
  }, [events]);
  const selected = events.find((e) => e.id === selectedId);
  const span = Math.max(1, duration);

  const jumpAt = (clientX: number) => {
    const el = stripRef.current;
    if (!el || dialogue.length === 0) return;
    const rect = el.getBoundingClientRect();
    const ms = ((clientX - rect.left) / rect.width) * span;
    let best = dialogue[0];
    for (const e of dialogue) {
      if (Math.abs((e.start + e.end) / 2 - ms) < Math.abs((best.start + best.end) / 2 - ms)) best = e;
    }
    onJump(best.id);
  };

  return (
    <div className="transport" role="toolbar" aria-label="Playback">
      <div className="overview">
        <div
          className="overview__strip"
          ref={stripRef}
          role="slider"
          aria-label="Film overview by line status"
          aria-valuemin={0}
          aria-valuemax={Math.round(span / 1000)}
          aria-valuenow={Math.round(time / 1000)}
          tabIndex={-1}
          onPointerDown={(e) => jumpAt(e.clientX)}
        >
          <svg viewBox={`0 0 ${span} 10`} preserveAspectRatio="none" aria-hidden>
            {dialogue.map((e) => (
              <rect key={e.id} className={`ov ov--${e.status}`} x={e.start} y={0} width={Math.max(span / 1500, e.end - e.start)} height={10} />
            ))}
          </svg>
          {selected && <span className="overview__sel" style={{ left: `${(selected.start / span) * 100}%` }} />}
          <span className="overview__head" style={{ left: `${Math.min(100, (time / span) * 100)}%` }} />
        </div>
        <div className="overview__legend num" aria-label="Lines by status: confirmed, draft, untranslated">
          <span className="key key--confirmed" title="Confirmed">{counts.confirmed}</span>
          <span className="key key--draft" title="Draft">{counts.draft}</span>
          <span className="key key--untranslated" title="Untranslated">{counts.untranslated}</span>
          {counts.comment > 0 && <span className="key key--comment">+{counts.comment} {counts.comment === 1 ? "comment" : "comments"}</span>}
        </div>
      </div>

      <div className="transport__center">
      <div className="transport__controls">
          <button className="icon-btn" onClick={() => onMove(-1)} aria-label="Previous line" title="Previous line  Alt ↑">
            <PrevLineIcon />
          </button>
          <button className="icon-btn" onClick={() => onStep(-2000)} disabled={!canPlay} aria-label="Back 2 seconds" title="Back 2 seconds">
            <BackIcon />
          </button>
          <button
            className="icon-btn icon-btn--play"
            onClick={onToggle}
            disabled={!canPlay}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause  Space" : "Play  Space"}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="icon-btn" onClick={() => onStep(2000)} disabled={!canPlay} aria-label="Forward 2 seconds" title="Forward 2 seconds">
            <ForwardIcon />
          </button>
          <button className="icon-btn" onClick={() => onMove(1)} aria-label="Next line" title="Next line  Alt ↓">
            <NextLineIcon />
          </button>
          <button className="icon-btn" onClick={onPlayLine} disabled={!canPlay || !selected} aria-label="Play current line" title="Play current line  Alt P">
            <LoopLineIcon />
          </button>
        </div>

        <div className="timecode" aria-live="off">
          <span className="timecode__now num">{formatTime(time)}</span>
          <span className="timecode__total num">{formatShort(duration)}</span>
        </div>
      </div>

      <div className="zoom">
        <button className="icon-btn icon-btn--small" onClick={() => onPps(Math.max(MIN_PPS, pps / 1.4))} aria-label="Zoom out timeline">
          <MinusIcon size={14} />
        </button>
        <input
          type="range"
          min={MIN_PPS}
          max={MAX_PPS}
          value={pps}
          onChange={(e) => onPps(Number(e.target.value))}
          aria-label="Timeline zoom"
        />
        <button className="icon-btn icon-btn--small" onClick={() => onPps(Math.min(MAX_PPS, pps * 1.4))} aria-label="Zoom in timeline">
          <PlusIcon size={14} />
        </button>
      </div>
    </div>
  );
}
