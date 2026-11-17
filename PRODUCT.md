# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One translator for now: Tao, who subtitles films from English into Mon in his own time, often at night, sitting beside the playing video. The app has to support long sessions of hundreds of lines per film.

## Product Purpose

HongsaSub is a desktop subtitle editor (Tauri + React, Rust core) for translating films into Mon. It replaces Aegisub for this job. Success is a finished, well-timed Mon subtitle file per film, and a growing translation memory that means the same or similar line is never translated twice.

## Positioning

A subtitle editor built around a Mon translation memory. Every confirmed line and glossary term is remembered and offered back, with fuzzy match scores, context ("same scene", "this film") and word-level diffs, in this film or the next one. Generic subtitle editors have no memory; generic CAT tools have no video, waveform or timing.

## Operating Context

- Opens English .srt/.ass/.ssa in "translate" mode (English becomes the source) or "edit" mode (fix an existing Mon file); saves .hongsa projects; exports ASS or SRT.
- Works with an attached video (MKV/HEVC proxied through ffmpeg), audio waveform, draggable timing clips, a virtualized line grid with CPS warnings.
- Keyboard-led: Ctrl+Enter confirm and next, Ctrl+1–9 apply a memory match, Alt+↑/↓ move, Alt+P play line, Space play/pause, Ctrl+G glossary, Ctrl+F memory search, Ctrl+S/O/E.
- "Teach memory" imports pairs from finished English + Mon subtitles aligned by timing.
- Used on a MacBook Air screen and on an external monitor, switching between them often; the layout must hold at both.

## Capabilities and Constraints

- Translation memory stored locally; online storage/sync is planned, not built.
- Mon script needs a Mon-capable font (Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Padauk fallbacks) and generous line height for stacked diacritics.
- CPS limit currently 17 characters per second, counting Mon base characters only.
- Source code carries no comments by project rule.

## Brand Commitments

- Name: HongsaSub. Logo: a hand-drawn golden Hongsa on a Mon-red sun over two subtitle strokes, on cream paper (2026-11-18). The Paper theme takes its colours from it.
- Visual standard: the category standard for professional video editors, played straight and dark. Craft bar: Final Cut Pro (Mac-native, calm, refined). Chosen over invented worlds on 2026-11-16.

## Evidence on Hand

- A real finished Mon subtitle: `Your.Name.2017.BDRip.XviD.AC3-TML - Mon.srt` (1,135 cues).
- No users, testimonials or public claims exist; none may be invented.

## Product Principles

1. The translator's hands never leave the keyboard for routine work.
2. Memory is the product: matches, terms and diffs are always in view, never behind a click.
3. Mon text is the hero of every surface it appears in, set large and readable.
4. Night work beside a playing film: the interface stays quiet so the picture and the words carry the light. Dark at night, warm Paper by day.

## Accessibility & Inclusion

- Two themes: Paper (warm cream, from the logo) and Dark (graphite). The app follows macOS by default, and the translator can pick one. No stark white surfaces.
- Mon text must never shrink below its current size.
