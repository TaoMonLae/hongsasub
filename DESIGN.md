---
name: HongsaSub
description: A Mon subtitle editor and translation memory, dressed as a Mac pro video editor.
colors:
  window: "#1c1c1e"
  pane: "#232325"
  pane-raised: "#2a2a2d"
  well: "#141415"
  control: "#3a3a3d"
  control-hover: "#47474b"
  control-press: "#545458"
  field: "#1a1a1c"
  separator: "#0c0c0d"
  hairline: "rgba(255, 255, 255, 0.075)"
  hairline-strong: "rgba(255, 255, 255, 0.13)"
  text: "#f2f2f4"
  text-secondary: "#b4b4ba"
  text-tertiary: "#9a9aa1"
  system-blue: "#0a84ff"
  blue-fill: "#0864d6"
  blue-fill-hover: "#1872e4"
  blue-press: "#0757ba"
  blue-text: "#6cb4ff"
  row-selection: "#1d3a5f"
  clip-selection-yellow: "#ffd60a"
  confirmed-green: "#32d74b"
  green-clip: "#1d4a2b"
  green-edge: "#2f7a46"
  draft-amber: "#ffb340"
  draft-clip: "#2c2c30"
  warning-red: "#ff6961"
  source-clip: "#27364a"
  source-edge: "#3d5574"
  source-text: "#c6d5e8"
  waveform-blue: "#4a90b8"
  untranslated-grey: "#4a4a50"
  sheet: "#2b2b2e"
  toast: "#3a3a3e"
  draft-clip-fill: "#4f3d14"
  draft-clip-edge: "#8c6a22"
  raised-hover: "#333336"
  on-green: "#0d2a12"
  error-toast: "#4a2523"
  checker: "#222225"
  untranslated-ring: "#7c7c83"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  timecode:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 400
    letterSpacing: "0.02em"
    fontFeature: "tnum"
  mon-editor:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "22px"
    lineHeight: 1.65
  mon-match:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "18px"
    lineHeight: 1.6
  mon-list:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "16px"
    lineHeight: 1.7
  mon-clip:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "16px"
    lineHeight: 1.3
  mon-grid:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  mon-chip:
    fontFamily: "Mon3 Anonta 1, Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk, sans-serif"
    fontSize: "15px"
    lineHeight: 1.7
rounded:
  key: "3px"
  small: "4px"
  field: "5px"
  control: "6px"
  segmented: "7px"
  card: "8px"
  panel: "10px"
  sheet: "12px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  pane: "14px"
  section: "16px"
  sheet: "20px"
components:
  button:
    backgroundColor: "{colors.control}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "26px"
  button-hover:
    backgroundColor: "{colors.control-hover}"
  button-active:
    backgroundColor: "{colors.control-press}"
  button-primary:
    backgroundColor: "{colors.blue-fill}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "26px"
  button-primary-hover:
    backgroundColor: "{colors.blue-fill-hover}"
  button-primary-active:
    backgroundColor: "{colors.blue-press}"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    height: "26px"
  button-small:
    typography: "{typography.body-small}"
    padding: "0 7px"
    height: "22px"
  button-large:
    rounded: "{rounded.card}"
    padding: "0 16px"
    height: "34px"
  icon-button:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    width: "28px"
    height: "26px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "28px"
  field-mon:
    typography: "{typography.mon-list}"
    height: "36px"
  segmented-control:
    rounded: "{rounded.segmented}"
    padding: "2px"
  segmented-control-selected:
    backgroundColor: "{colors.control-hover}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    height: "22px"
  status-confirmed:
    textColor: "{colors.confirmed-green}"
    rounded: "{rounded.panel}"
    height: "20px"
  status-draft:
    textColor: "{colors.draft-amber}"
    rounded: "{rounded.panel}"
    height: "20px"
  memory-match:
    backgroundColor: "{colors.pane-raised}"
    rounded: "{rounded.card}"
    padding: "8px 10px 9px"
  term-chip:
    backgroundColor: "{colors.pane-raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "3px 9px"
  timeline-clip-confirmed:
    backgroundColor: "{colors.green-clip}"
    rounded: "{rounded.small}"
  timeline-clip-source:
    backgroundColor: "{colors.source-clip}"
    textColor: "{colors.source-text}"
    rounded: "{rounded.small}"
  grid-row-selected:
    backgroundColor: "{colors.row-selection}"
    textColor: "{colors.text}"
  timecode-display:
    backgroundColor: "{colors.well}"
    typography: "{typography.timecode}"
    rounded: "{rounded.control}"
    padding: "3px 10px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.sheet}"
    padding: "20px"
    width: "480px"
---

# Design System: HongsaSub

## Overview

**Creative North Star: "The Night Edit Bay"**

HongsaSub is a subtitle translator that looks and behaves like a Mac pro video editor, with Final Cut Pro as the bar for finish. The category standard is played straight: graphite panes separated by hairlines, macOS system blue for action, focus and selection, a yellow border on the selected timeline clip, and a green / amber / grey status language for confirmed, draft and untranslated lines. Nothing in the chrome is decorative; the film picture and the Mon text carry the light.

The workspace is dense and fixed: a 44px toolbar, then viewer, line editor and memory inspector across the top, a full-width transport row, a three-track timeline and a virtualized line grid. Every region is a flat pane on a near-black separator field, so the layout reads as one instrument rather than a stack of cards. Interface text sits at 13px system weight; Mon is the only text that is ever large.

This world replaced the earlier warm-black-and-gold look on 2026-11-16 by the user's choice. Gold accents, warm blacks and invented costume worlds are rejected.

**Key Characteristics:**
- Four graphite steps (well, window, pane, raised pane) divided by a 1px near-black separator and a 7.5% white hairline.
- One accent family, macOS system blue, for the primary action, focus rings, text selection and grid row selection.
- Status is colour-coded and consistent everywhere it appears: green confirmed, amber draft, grey untranslated.
- System UI text at 13px, SF Mono tabular figures for timecodes, Mon set larger than any Latin text beside it.
- Drawn 16px line icons on one 1.4 stroke weight; keyboard hints shown as quiet key caps.

## Colors

A neutral graphite ramp with macOS system colours used strictly as signals.

### Primary
- **System Blue** (`system-blue`): focus rings (3px at 55% / 35% alpha), caret, text selection at 45%, slider accent. The one colour that means "you are here" or "this acts".
- **Pressed Blue** (`blue-fill`, `blue-fill-hover`, `blue-press`): the fill of the single primary button per surface (Export, Confirm and next, Open subtitle). White text.
- **Link Blue** (`blue-text`): glossary term marks in the English source, high-score match badges, context tags ("Same scene", "This film").
- **Selection Navy** (`row-selection`): the selected row in the line grid.

### Secondary
- **Clip Selection Yellow** (`clip-selection-yellow`): the 2px border and trim handles of the selected timeline clip, and the selected-line tick on the overview strip. Used nowhere else.

### Tertiary (status)
- **Confirmed Green** (`confirmed-green`, `green-clip`, `green-edge`): confirmed lines, the progress fill, exact memory matches, inserted words in diffs.
- **Draft Amber** (`draft-amber`, `draft-clip`): draft lines and the "Edited" document state.
- **Warning Red** (`warning-red`): CPS over limit, bad timing, deleted words in diffs, error toasts.
- **Source Slate** (`source-clip`, `source-edge`, `source-text`): English source clips on the timeline.
- **Waveform Blue** (`waveform-blue`): the audio track.
- **Untranslated Grey** (`untranslated-grey`): untranslated segments on the overview strip and legend; untranslated clips are a hatched outline instead of a fill.

### Neutral
- **Well** (`well`): video surround, timeline track area, timecode display, overview strip.
- **Window** (`window`): toolbar and welcome screen.
- **Pane** (`pane`): editor, memory inspector, transport, grid, track headers.
- **Raised Pane** (`pane-raised`): source line block, match cards, term chips, grid header.
- **Field** (`field`): text inputs and the Mon textarea.
- **Control / Hover / Press** (`control`, `control-hover`, `control-press`): default button fills.
- **Separator** (`separator`): the 1px gaps between panes.
- **Hairline / Strong Hairline** (`hairline`, `hairline-strong`): inset strokes on cards, fields and segmented controls.
- **Text / Secondary / Tertiary** (`text`, `text-secondary`, `text-tertiary`): primary copy, supporting copy, labels and metadata.
- **Sheet / Toast** (`sheet`, `toast`): modal cards and transient notices.

### Named Rules
**The Signal Colour Rule.** Blue, yellow, green, amber and red each carry one meaning across the whole app. A colour never appears as decoration, and a meaning never borrows a second colour.

**The One Blue Button Rule.** Each surface has at most one filled blue button: Export in the toolbar, Confirm and next in the editor, Open on the welcome screen. Everything else is a graphite control or a plain button.

## Typography

**UI Font:** SF Pro Text via `-apple-system` (with Helvetica Neue, Segoe UI, system-ui)
**Mono Font:** SF Mono via `ui-monospace` (with Menlo, Consolas)
**Mon Font:** Mon3 Anonta 1 (with Pyidaungsu, Noto Sans Myanmar, Myanmar Text, Padauk)

**Character:** Native Mac system text, quiet and small, so the Mon script set beside it reads as the subject of every surface.

### Hierarchy
- **Display** (600, 26px, -0.01em): the welcome screen title only.
- **Headline** (600, 15px): the editor's "Line 73" title and modal titles. The English source line and the welcome lead also sit at 15px regular.
- **Title** (600, 13px): pane titles such as Memory and Lines.
- **Body** (400, 13px, 1.4): default UI text, buttons, search fields.
- **Body Small** (400, 12px): grid rows, match source text, metadata, small buttons and segmented labels.
- **Label** (600, 11px): field labels (English, Mon, Start, End), grid headers, badges, key caps, legend.
- **Timecode** (SF Mono, 15px, 0.02em, tabular): the transport timecode; the same mono face at 11–12px for grid times and timing fields.

The type scale is 11 / 12 / 13 / 15 / 16 / 18 / 22 / 26px. No half-pixel sizes.

### Named Rules
**The Mon Floor Rule.** Mon text is never smaller than its pre-redesign sizes: line editor 22px, memory match 18px, glossary and search results 16px, timeline clip 16px, line grid 15px, term chip 15px. Within each element, Mon is set at or above the Latin text of that same element (grid 15 over 12, match 18 over 12, clip 16 over 11, term 15 over 12).

**The Stacked Diacritic Rule.** Mon runs at line-height 1.5 to 1.7 wherever it can wrap (1.65 in the editor, 1.6 in matches, 1.7 by default). The single-line timeline clip is the only place it drops to 1.3.

**The Tabular Time Rule.** Every timecode, duration and CPS figure uses tabular numerals so columns and the running clock never shift width. Counts in prose (line totals, memory stats) use tabular figures in the UI face, not mono.

## Layout

A fixed desktop workspace with no page scroll. The app is a two-row grid: 44px toolbar over the workspace. The workspace is a CSS grid with 1px gaps over the separator colour:

- Columns: viewer `minmax(300px, 0.95fr)`, editor `minmax(380px, 1.1fr)`, memory inspector `clamp(300px, 24vw, 380px)`.
- Rows: work row `minmax(250px, 1.2fr)`, transport 44px, timeline `clamp(132px, 19vh, 196px)`, grid `minmax(140px, 1fr)`.
- The memory inspector runs the full height on the right; transport, timeline and grid span the two left columns.

Spacing follows a 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20px rhythm. Panes pad 10–14px; controls sit 6px apart in groups; sheets pad 20px.

Responsive behaviour targets the two screens the translator switches between (MacBook Air, external monitor):
- Below 1520px wide the overview legend hides.
- Below 1320px the film-field text label hides (the film icon stays as the cue), the document title shortens to 16ch and the toolbar progress track hides.
- Below 1180px the columns tighten to `minmax(260px, 0.85fr) minmax(340px, 1.15fr) 290px` and secondary toolbar buttons narrow.
- Below 760px tall the rows compress to `minmax(236px, 1.25fr) 40px 128px minmax(120px, 1fr)`.

Two layouts share this grid, switched from the toolbar's Focus / Timing control or with Mod+Shift+F, and remembered between sessions:
- **Timing** (default): the full grid above.
- **Focus**: for drafting. Timeline and line grid are hidden; the work row takes all height above the transport, and the Mon textarea rises to 26px. Mod+1–9 stays reserved for applying memory matches.

The timeline has a 92px track-header column (Mon, English, Audio) and a scrolling track area with a canvas ruler and waveform. The grid uses fixed columns `26px 44px 96px 96px 42px 1fr 1fr` (status, number, start, end, CPS, English, Mon).

## Elevation & Depth

Flat, tonal layering. Panes are separated by the 1px separator gap and a hairline, never by shadows. Depth inside a pane comes from stepping the graphite (well below pane, raised pane above it) and from 1px inset hairline strokes. Shadows appear on only three things: the raised bevel of graphite buttons and the selected segment, and the pop shadow of floating sheets and toasts.

### Shadow Vocabulary
- **Button bevel** (`inset 0 0.5px 0 rgba(255,255,255,0.12), 0 1px 1.5px rgba(0,0,0,0.35)`): graphite and blue buttons.
- **Selected segment** (`0 1px 2px rgba(0,0,0,0.4), inset 0 0.5px 0 rgba(255,255,255,0.14)`): the active segment of a segmented control.
- **Pop** (`0 12px 32px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)`): modal sheets and toasts, always paired with a strong inset hairline.
- **Focus ring** (`inset 0 0 0 1px #0a84ff, 0 0 0 3px rgba(10,132,255,0.35)`): fields; other focusable elements use a 3px blue outline at 55%.

### Named Rules
**The Hairline Not Shadow Rule.** A surface that stays in the layout is separated by a hairline or a graphite step. Only things that float above the workspace (sheets, toasts) cast a shadow.

## Shapes

Gently rounded, Mac-native corners that grow with the size of the surface: key caps 3px, badges, clips and timing fields 4px, inputs 5px, buttons and chips 6px, segmented controls 7px, match cards and large buttons 8px, the shortcut panel 10px, sheets 12px. Status pills are full capsules (10px on a 20px height). Strokes are 1px insets, never outer borders, except the 2px yellow ring on a selected clip. The playhead is a 1px white line with a small pentagon cap.

## Components

### Buttons
Calm graphite controls with a hairline bevel, in the manner of macOS toolbar buttons.
- **Shape:** gently rounded (6px); 26px tall, 10px horizontal padding, 13px medium text, 6px gap to an optional 16px icon.
- **Default:** control graphite fill, primary text. Hover lifts to control-hover; press to control-press. 120ms background transition.
- **Primary:** pressed-blue fill, white text, key-cap hint at 18% white. One per surface.
- **Plain:** transparent, secondary text; hover adds 7% white and full-strength text. Used for Play line, Copy to Mon, Preview copy.
- **Small / Large:** 22px at 12px text; 34px at 15px text with 8px corners (welcome actions).
- **Icon button:** 28 x 26px, secondary text colour, 8% white hover. Transport play is 34 x 30px.
- **Disabled:** 40% opacity.

### Segmented Control
The Matches / Search / Glossary switch and the grid's All / Not confirmed filter.
- **Track:** 2px padding, 30% black fill, half-pixel inset hairline, 7px corners.
- **Segment:** 22px, 12px medium text, secondary colour; the selected segment takes control-hover fill, primary text and the selected-segment shadow. Counts sit inside in 11px tertiary tabular figures.

### Chips and Badges
- **Status pill:** 20px capsule, 11px medium text, 6px dot in currentColor; green on 16% green, amber on 16% amber, grey on 8% white.
- **Score badge:** 18px, 4px corners, 11px semibold. Exact is dark text on solid green, high is link blue on 18% blue, low is secondary text on 9% white.
- **Context tag:** link blue on 14% blue, 18px tall.
- **Term chip:** raised pane, inset hairline, 6px corners; English at 12px secondary, Mon at 15px primary.

### Inputs / Fields
- **Style:** field fill, 1px strong inset hairline, 5px corners; 28px at 13px text, compact controls 24px at 12px. A Mon field is 36px at 16px.
- **Mon textarea:** 22px Mon at 1.65 line height on the field fill, 6px corners, flexes to fill the editor.
- **Focus:** 1px blue inset plus a 3px blue halo at 30–35%.
- **Error:** 1px red inset plus a 3px red halo (bad timing).

### Memory Match Card (signature)
The memory inspector's core unit: everything the translator needs to accept a match without leaving the keyboard.
- Raised pane, 8px corners, inset hairline; exact matches swap the hairline for 45% green.
- Top row: score badge, context tags, and the Ctrl+N hint at right.
- Mon target at 18px, then English source at 12px secondary with word-level diff (insertions green on soft green, deletions red struck through), then 11px tertiary provenance ("Your Name · used 3 times").
- Hover lightens the card and reveals a small forget button at top right.

### Timeline (signature)
- Three tracks with headers and colour swatches: Mon captions, English source, audio waveform.
- Clips are 4px rounded blocks with a 1px inset edge: confirmed green, draft graphite with amber edge, untranslated hatched outline, source slate. Mon clip labels at 16px, English at 11px.
- The selected clip gets a 2px yellow ring and yellow trim handles; the 7px handle zones resize timing.
- White 1px playhead with a pentagon cap.

### Transport and Overview Strip
- Overview strip: a 14px well that draws every line of the film by status, with a yellow tick for the selected line and a white playhead line; legend keys at 11px (comments labelled in text, no swatch).
- Centred transport controls, then the timecode display: 15px SF Mono current time over 11px total, on a well-coloured 6px block.
- Zoom slider with minus and plus icon buttons at the right.

### Line Grid
- 24px header on raised pane at 11px medium tertiary; virtualized rows at 12px secondary with mono 11px times.
- Status dots: solid green, solid amber, grey outline ring for untranslated, a short grey dash for comments.
- Hover adds 4% white; selection fills selection navy with primary text. CPS over limit turns red.

### Toolbar
44px on the window colour with a separator bottom edge. Left: brand mark and name, a hairline divider, document title, Edited state in amber, the film field led by a film icon. Right: progress text and green track, then Teach memory, Open, Save as graphite buttons and Export as the one blue button.

### Sheets and Toasts
- **Sheet:** 480px, 12px corners, 20px padding, sheet fill, pop shadow, 12vh from the top over a 45% black scrim; fades in 140ms and rises 6px over 180ms.
- **Choice tiles:** raised pane, 8px corners, strong hairline; hover or focus turns the hairline blue.
- **Toast:** centred 22px from the bottom, 8px corners, pop shadow; error toasts on a dark red fill with a red hairline.

### Deferred
Not yet built, and not part of the system until they ship: a recent-projects list on the welcome screen, a two-tone waveform, and a viewer title bar. Record them here when they land in code.

## Do's and Don'ts

### Do:
- **Do** keep Mon at or above the Mon Floor sizes (22 / 18 / 16 / 16 / 15 / 15px) and above the Latin text in the same element.
- **Do** use only the 11 / 12 / 13 / 15 / 16 / 18 / 22 / 26px scale for interface and Mon text.
- **Do** separate panes with the 1px separator gap and hairlines, and step the graphite for depth.
- **Do** keep one meaning per signal colour: blue for action, focus and selection; yellow for the selected clip; green, amber, grey for line status; red for errors and limits.
- **Do** show keyboard shortcuts as quiet key caps beside the action they trigger, using the platform's modifier glyphs on Mac.
- **Do** draw icons as 16px line icons on the shared 1.4 stroke, filled only for play-type glyphs.
- **Do** use 120–240ms transitions on the shared `cubic-bezier(0.22, 1, 0.36, 1)` ease, and collapse them under reduced motion.

### Don't:
- **Don't** bring back the warm-black-and-gold look or any invented costume world; this app is the pro video editor category played straight.
- **Don't** add a light theme; the interface stays dark for night work beside the film.
- **Don't** shrink Mon to make a layout fit; hide secondary Latin labels first.
- **Don't** use purple, decorative gradients or glows in the chrome. The hatched untranslated clip, the loading shimmer and the brand mark's tile are the only gradient fills; the caption text shadow exists for legibility over the picture.
- **Don't** put more than one filled blue button on a surface.
- **Don't** add shadows to panes, cards or rows that stay in the layout.
- **Don't** add uppercase eyebrow or kicker labels above pane content; labels are plain 11px semibold sentence case.

## Brand mark

Two marks share one graphite app-icon tile (vertical #3c3c41 to #1e1e21, 14% white rim) and one blue subtitle line (#0a84ff) along the bottom.

- **Hongsa icon** (`HongsaIcon`, `brand/hongsasub-icon.svg`): the hongsa of Hongsawatoi, with a crest and an upswept curled tail. The bird's body is the first subtitle line, in white, and the blue line below it is the Mon line. It is used at 64px and above: the app and Dock icon (`src-tauri/icons`, made from `brand/hongsasub-icon-1024.png`) and the welcome screen.
- **Ha mark** (`HongsaMark`, `brand/hongsasub-mark.svg`): the Mon letter ဟ, the first letter of ဟံသာ, set on the blue subtitle line. It is used below 64px, where the bird blurs: the toolbar (22px), the favicon (`public/hongsa.svg`) and the 30, 32 and 44px Tauri icons. The glyph outline comes from Noto Sans Myanmar Bold (SIL Open Font License).
- **Don't** put the bird below 64px, recolour the tile, or move the blue line above the white shape.
