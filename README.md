<div align="center">

<img src="brand/hongsasub-icon-1024.png" alt="HongsaSub logo: a hand-drawn golden Hongsa on a red sun, floating on two subtitle lines" width="220">

# HongsaSub

**The subtitle editor that remembers your Mon.**

---

Translate film subtitles from English into Mon (ဘာသာမန်) beside the playing video.
Every line you confirm goes into a translation memory, so the same or a similar line is never translated twice, in this film or the next one.

[![Rust + TypeScript](https://img.shields.io/badge/Rust_%2B_TypeScript-Tauri_2-b7410e?style=flat-square&logo=rust&logoColor=white)](https://tauri.app)
[![Platforms](https://img.shields.io/badge/macOS_·_Windows_·_Linux-native-2f6fde?style=flat-square)](#install)
[![License](https://img.shields.io/badge/license-MIT_%2F_Apache--2.0-555?style=flat-square)](#license)
[![Status](https://img.shields.io/badge/status-early_alpha-e8a317?style=flat-square)](#status)
[![Language](https://img.shields.io/badge/made_for-Mon_language-c8323a?style=flat-square)](https://en.wikipedia.org/wiki/Mon_language)

[Get started](#get-started) · [Features](#features) · [Keyboard](#keyboard) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

## Why HongsaSub

Subtitle editors like Aegisub know about video, waveforms and timing, but forget every line once the file is closed. Translation tools remember everything, but have no video, no timeline and no idea what a subtitle is. HongsaSub joins the two for one job: **turning English subtitles into well-timed Mon subtitles, faster with every film.**

## Features

### Translate with memory
- **Translation memory.** Every confirmed line is stored with its neighbours and film. Matches come back with a score, a word-by-word diff, and "same scene" or "this film" hints. Press `⌘1`–`⌘9` to use one.
- **Fill from memory.** Fill every untranslated line that memory already knows as a draft. You choose how close a match must be (exact, 95%+ or 85%+), and one undo removes them all.
- **Teach memory from finished work.** Pair an English subtitle with your finished Mon one by timing, review doubtful pairs (merged lines, numbers that differ, lines left untranslated) and add them to memory.
- **Glossary and dictionary.** Keep agreed terms for names and places. Look up any Mon or English word in the built-in [MonDict](https://github.com/Barnista/MonDictDB) dictionary of 26,000 words (`⌘D`).

### Check before you ship
- **Quality checks.** Reading speed, line length, rows per line, too short or too long on screen, overlaps, small gaps, broken tags, stray spaces, numbers that differ from the English, and glossary terms translated inconsistently. Most problems have a one-click fix.
- **Mon spell-check.** Mon text is split into syllables and matched against the dictionary, so typos such as a doubled final consonant are underlined as you type. Words you use often in your memory are learned automatically.
- **Session pace.** See lines per hour and an estimate of the time left.

### Time it to the picture
- **Video preview** with styled captions, and zoom from 25% to 200%. MKV and HEVC films are repackaged or converted once with ffmpeg, then cached.
- **Waveform timeline.** Drag lines and their edges. They snap to other lines, the playhead, and where speech starts and stops.
- **Shift timings** for subtitles timed to a different release, plus **split** and **merge** lines.

### Edit like a pro
- Bold, italic, underline, strikeout, font and colour, written as ASS tags or SRT HTML tags.
- A **Styles manager** with a reusable style library.
- **Find and replace** that never touches tags or line breaks.
- Undo and redo for every text, timing and style change.
- **Paper and Dark themes.** Warm cream Paper takes its colours from the logo, and graphite Dark is for night work. The app follows macOS, or you can pick one from the toolbar.
- Resizable panes, and a **Focus** layout for long translation sessions.
- Opens `.srt`, `.ass` and `.ssa`. Saves `.hongsa` projects and exports ASS or SRT.

## Get started

### Requirements
- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)
- [ffmpeg](https://ffmpeg.org) (includes ffprobe) for video playback and waveforms. Without it you can still translate and export.
- The [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your system

### Run from source

```bash
git clone https://github.com/TaoMonLae/hongsasub.git
cd hongsasub
pnpm install
pnpm tauri dev
```

### Build the app

```bash
pnpm tauri build
```

The installer is written to `target/release/bundle/`.

### Run the tests

```bash
cargo test --workspace
```

## Keyboard

| Keys | Action |
| --- | --- |
| `⌘ Enter` | Confirm the line and go to the next |
| `⌘1` – `⌘9` | Use a memory match |
| `⌥↑` `⌥↓` | Move between lines |
| `⌥P` | Play the current line |
| `Space` | Play or pause |
| `⌘Z` `⌘⇧Z` | Undo and redo |
| `⌘B` `⌘I` `⌘U` | Bold, italic, underline |
| `⌘D` | Look up the selected word |
| `⌘G` | Add the selection to the glossary |
| `⌘F` | Search the memory |
| `⌘⇧H` | Find and replace |
| `⌘⇧F` | Switch between the Focus and Timing layouts |
| `⌘S` `⌘O` `⌘E` | Save, open, export |

On Windows and Linux, use `Ctrl` for `⌘` and `Alt` for `⌥`.

## How it is built

```
hongsasub/
├── crates/hongsasub-core   Rust: SRT/ASS parsing and writing, projects, translation memory (SQLite),
│                           pairing, dictionary, Mon spell-check
├── src-tauri               Rust: Tauri app, commands, ffmpeg media pipeline, local media server
├── src                     React + TypeScript interface
└── brand                   Logo artwork
```

Your translation memory, glossary, style library and personal word list stay on your computer, in the app's data folder. Nothing is sent anywhere.

## Status

HongsaSub is in **early alpha**. It is used for real film work, but file formats and features may still change. Keep backups of your `.hongsa` projects.

## Contributing

Bug reports, Mon language corrections and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- The Mon dictionary comes from [MonDictDB](https://github.com/Barnista/MonDictDB) by Barnista, MIT License.
- Built with [Tauri](https://tauri.app), [React](https://react.dev) and [SQLite](https://sqlite.org).

## License

HongsaSub is licensed under either of

- [Apache License, Version 2.0](LICENSE-APACHE)
- [MIT License](LICENSE-MIT)

at your option.

Unless you explicitly state otherwise, any contribution you intentionally submit for inclusion in this work, as defined in the Apache-2.0 license, shall be dual-licensed as above, without any additional terms or conditions.
