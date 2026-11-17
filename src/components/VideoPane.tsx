import { useEffect, useRef, useState } from "react";
import type { PrepareMode, SubtitleEvent } from "../lib/api";
import { plainText, shownText } from "../lib/text";
import type { StyleFields } from "../lib/styles";
import { Caption } from "./Caption";
import { FilmIcon } from "./Icons";

export type Zoom = "fit" | number;
const ZOOMS: Zoom[] = ["fit", 25, 50, 75, 100, 125, 150, 200];
const ZOOM_KEY = "hongsasub.videoZoom";

function storedZoom(): Zoom {
  try {
    const v = localStorage.getItem(ZOOM_KEY);
    if (!v || v === "fit") return "fit";
    const n = Number(v);
    return ZOOMS.includes(n) ? n : "fit";
  } catch {
    return "fit";
  }
}

export interface VideoState {
  src: string | null;
  path?: string;
  status: "idle" | "preparing" | "ready" | "error";
  message?: string;
  proxied?: boolean;
  mode?: PrepareMode;
  progress?: number | null;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  video: VideoState;
  videoName: string | null;
  active: SubtitleEvent[];
  onAttach: () => void;
  onToggle: () => void;
  onLoaded: (duration: number) => void;
  onPlaying: (playing: boolean) => void;
  onError: () => void;
  onReady: () => void;
  fieldsFor: (style: string) => StyleFields;
  playResY: number;
}

function preparingText(video: VideoState) {
  const pct = typeof video.progress === "number" ? ` ${Math.floor(video.progress * 100)}%` : "";
  if (video.mode === "remux") {
    return { title: `Opening the film${pct}`, note: "Repackaging it for playback without re-encoding. Full quality, done once and cached." };
  }
  if (video.mode === "transcode") {
    return { title: `Converting the film${pct}`, note: "This format can't be played directly, so a preview copy is being made with ffmpeg, once." };
  }
  return { title: "Checking the video", note: "Reading its format with ffprobe." };
}

export function VideoPane(props: Props) {
  const { videoRef, video, videoName, active, onAttach, onToggle, onLoaded, onPlaying, onError, onReady, fieldsFor, playResY } = props;
  const preparing = preparingText(video);
  const caption = active
    .map((e) => (plainText(e.text) ? { text: shownText(e.text, e.source), fields: fieldsFor(e.style) } : { text: e.source, fields: fieldsFor(e.style), dim: true }))
    .filter((c) => plainText(c.text));
  const [zoom, setZoom] = useState<Zoom>(storedZoom);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!video.src) setNatural({ w: 0, h: 0 });
  }, [video.src]);

  const pickZoom = (z: Zoom) => {
    setZoom(z);
    try {
      localStorage.setItem(ZOOM_KEY, String(z));
    } catch {
      return;
    }
  };

  const known = natural.w > 0 && natural.h > 0;
  const factor = !known ? 1 : zoom === "fit" ? Math.min(frame.w / natural.w, frame.h / natural.h) || 1 : zoom / 100;
  const stage = known ? { w: Math.round(natural.w * factor), h: Math.round(natural.h * factor) } : null;
  const shown = known ? Math.round(factor * 100) : null;

  return (
    <section className="viewer" aria-label="Viewer">
      <div className={`viewer__frame${zoom !== "fit" ? " is-zoomed" : ""}`} ref={frameRef}>
        {video.src ? (
          <div className="viewer__stage" style={stage ? { width: stage.w, height: stage.h } : { width: "100%", height: "100%" }}>
          <video
            ref={videoRef}
            src={video.src}
            preload="auto"
            onLoadedMetadata={(e) => {
              onLoaded(e.currentTarget.duration * 1000);
              setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
            }}
            onPlay={() => onPlaying(true)}
            onPause={() => onPlaying(false)}
            onEnded={() => onPlaying(false)}
            onClick={onToggle}
            onError={onError}
            onCanPlay={onReady}
          />
            {caption.length > 0 && (
              <div className="viewer__caption">
                <Caption texts={caption} scale={(stage ? stage.h : frame.h) / playResY} />
              </div>
            )}
          </div>
        ) : (
          <div className={`viewer__empty${video.status === "error" ? " is-error" : ""}`}>
            {video.status === "preparing" ? (
              <>
                <span className="spinner" aria-hidden />
                <p className="num">{preparing.title}</p>
                {typeof video.progress === "number" && (
                  <span className="viewer__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(video.progress * 100)}>
                    <span style={{ width: `${video.progress * 100}%` }} />
                  </span>
                )}
                <small>{preparing.note}</small>
              </>
            ) : video.status === "error" ? (
              <>
                <p>The video could not be opened</p>
                <small>{video.message}</small>
                <button className="btn" onClick={onAttach}>
                  Choose another video
                </button>
              </>
            ) : (
              <>
                <FilmIcon size={22} />
                <p>No video attached</p>
                <small>Attach the film to see lines over the picture and read its audio waveform.</small>
                <button className="btn" onClick={onAttach} data-attach>
                  Attach video…
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {video.src && (
        <footer className="viewer__foot">
          <span className="viewer__name" title={videoName ?? ""}>
            {videoName}
          </span>
          {video.proxied && video.mode === "transcode" && (
            <span className="badge" title="Playing a lightweight preview copy made with ffmpeg">
              Preview copy
            </span>
          )}
          <label className="viewer__zoom" title="Video size">
            <span className="sr-only">Video size</span>
            <select className="control control--small num" value={String(zoom)} onChange={(e) => pickZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
              {ZOOMS.map((z) => (
                <option key={String(z)} value={String(z)}>
                  {z === "fit" ? `Fit${zoom === "fit" && shown ? ` (${shown}%)` : ""}` : `${z}%`}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--plain btn--small" onClick={onAttach}>
            Change video…
          </button>
        </footer>
      )}
    </section>
  );
}
