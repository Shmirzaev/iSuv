---
name: iSuv Limnigraph Register
description: A hydrological yearbook and strip-chart recorder rendered as an operator console; the record is the interface.
colors:
  paper: "#f1f5f3"
  sheet: "#fafcfb"
  ledger-tint: "#e7eeeb"
  ink: "#12253f"
  ink-secondary: "#30455b"
  graphite: "#506573"
  rule: "#8a9e99"
  hairline: "#bbc9c3"
  mm-grid: "#8fbfb0"
  plan-blue: "#3a5a8c"
  plan-blue-deep: "#28436f"
  plan-blue-wash: "#e2e9f0"
  correction-red: "#b3261e"
  correction-wash: "#f8e8e5"
  stamp-brown: "#504c3f"
  stamp-wash: "#efeee7"
  record-green: "#304f49"
typography:
  title:
    fontFamily: "Bahnschrift, 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "normal"
  heading:
    fontFamily: "Bahnschrift, 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Bahnschrift, 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Bahnschrift, 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.035em"
  figures:
    fontFamily: "'Cascadia Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
rounded:
  none: "0"
  hairline: "2px"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.25rem"
  s6: "1.5rem"
  s8: "2rem"
components:
  ledger-head:
    backgroundColor: "{colors.ledger-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.375rem"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.45rem 0.85rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-secondary}"
    textColor: "{colors.sheet}"
  button-ghost:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.45rem 0.85rem"
    height: "2.25rem"
  button-ghost-hover:
    backgroundColor: "{colors.ledger-tint}"
    textColor: "{colors.ink}"
  input-search:
    backgroundColor: "{colors.ledger-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.hairline}"
    padding: "0.5rem 0.75rem"
  nav-item:
    backgroundColor: "{colors.ledger-tint}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0.65rem 0.85rem"
    height: "2.75rem"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet}"
  status-chip:
    backgroundColor: "{colors.ledger-tint}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.65rem"
  status-chip-critical:
    backgroundColor: "{colors.correction-wash}"
    textColor: "{colors.ink}"
  stamp-synthetic:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0.25rem 0.5rem"
---

# Design System: iSuv Limnigraph Register

## Overview

**Creative North Star: "The Limnigraph Register"**

The console is a hydrological yearbook crossed with a strip-chart recorder. The record itself is the interface: each station is a ruled ledger row, each reading a figure in a column whose head names its unit, and the time axis is a real millimetre grid on paper that runs to a pen-edge "now" line. There are no cards, no KPI tiles, no rounded panels. Sections are separated by rules (a heavy double rule for a sheet boundary, a hairline for a row), and the trust state of every reading is printed on it: a stamp box for synthetic or provenance text, a hatched band for paper where the pen recorded nothing.

The mood is calm, exact and unhurried, a survey office rather than a product demo. Density is ledger-tight (table cells at 0.25rem by 0.375rem; 11px uppercase column heads). Ink is a deep blue-black on cool chart-paper white; a second blue marks planned or reference values; a single correction red appears only for struck originals, over or alarm conditions and stamps. The system holds one deliberate refusal: no-data and unreliable evidence must never resemble a normal reading, so hatch is reserved for exactly those states.

The dark theme is the same instrument at night: a "night chart" of deep blue-black paper with the same pale teal millimetre grid. Status never relies on colour alone; every state carries text, an SVG icon and (when abnormal evidence) a pattern.

**Key Characteristics:**
- Ledger, not dashboard: double-ruled column heads, hairline row rules, figures in tabular monospace.
- Millimetre grid (`#8fbfb0`) belongs only to chart axes; it is never wallpaper.
- Hatch (45-degree diagonal line pattern) means NO DATA, UNRELIABLE, FAULT, STALE or UNASSESSABLE, and nothing else.
- Square corners (radius 0, at most 2px on text inputs), no shadows, no gradients in the chrome.
- Status = text label + 16px square-cap SVG icon + pattern where abnormal; never colour alone.
- Stamp boxes (3px double red rule) carry synthetic-data and provenance declarations.
- Units live in column heads and beside figures: stage (m), discharge (m3/s), volume (m3).

## Colors

A cool chart-paper palette with one ink, one reference blue and one correction red; every neutral is tinted toward the teal-green of the grid.

### Primary
- **Survey Ink** (#12253f): text, traces, figures, the active navigation fill, primary buttons, heavy double rules and the "now" pen line. The single dominant voice of the system.
- **Plan Blue** (#3a5a8c): the reference-value blue as built: links, the focus ring, the information tone, map topology trace edges and selected fills (the contract's planned-line use is not yet drawn in the strip chart). Deep variant Plan Blue Deep (#28436f) for link hover; wash (#e2e9f0) for selected or informational fills.

### Secondary
- **Correction Red** (#b3261e): struck originals in correction history, over/alarm conditions, the synthetic-data stamp rule and critical chips. Wash (#f8e8e5) behind critical chips only.

### Tertiary
- **Stamp Brown** (#504c3f) with wash (#efeee7): attention tone and legacy notice fills.
- **Record Green** (#304f49) with wash (#e7eeeb): the positive/"reported" tone, expressed as a dark slate-green text colour and border, never as a bright success green.

### Neutral
- **Chart Paper** (#f1f5f3): page canvas.
- **Sheet** (#fafcfb): table, strip-chart and topbar surface; text on filled ink controls.
- **Ledger Tint** (#e7eeeb): sidebar, table heads, inputs, hover rows, neutral chips.
- **Graphite** (#506573): muted captions, units and sub-labels; also strong borders.
- **Ink Secondary** (#30455b): secondary text and unreliable-value figures.
- **Rule** (#8a9e99): standard borders and row rules; **Hairline** (#bbc9c3): quiet dividers.
- **Millimetre Grid** (#8fbfb0): chart grid and hatch strokes (used at 35 to 45 percent opacity in hatches, 0.4 and 0.8 stroke widths in the strip chart).

### Night chart (dark theme)
Canvas #101c2a, surface #152638, raised #1d3040, text #e5efeb, secondary #c8dbd6, muted #aabeb8, border #6f8d85, hairline #425e58, accent #a5bfe7, danger #ff9c91. The grid stays #8fbfb0. Applied by `prefers-color-scheme: dark` and by `data-theme='dark'`.

### Named Rules
**The One Ink Rule.** Survey Ink carries traces, figures, the active state and every heavy rule. A new accent is a new pen colour; do not add one.
**The Correction-Only Red Rule.** Correction Red is for struck originals, over/alarm conditions and stamps. It is never a decorative accent and never a generic "error" wash across a surface.
**The Grid-Is-an-Axis Rule.** The teal millimetre grid appears only as a chart time axis (and as hatch strokes). It must never be used as background texture on a page, card or hero.

## Typography

**Display / UI Font:** Bahnschrift (with 'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', system-ui, sans-serif). A narrow DIN-style grotesque with Cyrillic and Latin-Uzbek coverage.
**Figures Font:** Cascadia Mono (with Consolas, 'Liberation Mono', monospace), tabular numerals, used for station codes, identifiers, quantities and axis values.

**Character:** A survey-office pairing: a compressed, engineered grotesque for labels and prose, a typewriter-slab monospace for every figure so columns of numbers align and read as entries in a record. Both are system stacks (no webfont is loaded); Bahnschrift exists on Windows only and other platforms fall back to the condensed or system sans in the stack.

### Hierarchy
- **Title** (600, 24px, 1.15): workspace `h1` only.
- **Heading** (600, 17px, 1.3, -0.01em): section `h2`, each opened by a 2px ink top rule with 0.5rem padding above the text.
- **Body** (400, 0.875rem / 14px, 1.5): table text and workspace prose; base document size is 1rem.
- **Label** (700, 11px, 0.035em, uppercase): table column heads and status chips (0.025em); stamps use the same uppercase treatment at 0.75rem.
- **Figures** (400, tabular-nums, mono): readings, codes, identifiers; an unreliable reading is set at weight 400 in Ink Secondary so it does not look confident.

### Named Rules
**The Unit-In-The-Head Rule.** A column or axis names its unit (m, m3/s, m3) in its head or label; a figure is never shown without its unit context. Stage, discharge and volume are never merged into one column or label.
**The Typewriter Figures Rule.** Every measured number, code and identifier is set in the figures face with tabular numerals.

## Layout

A two-column application shell: a 16.5rem sidebar rail (sticky, full height) and a fluid main column, with a sticky topbar above the main column. Main content is padded 1.25rem / 1.5rem / 2rem. Spacing follows a 4-step rem scale (0.25, 0.5, 0.75, 1, 1.25, 1.5, 2rem, tokens s1 to s8) and ledger cells pack tighter (0.25rem by 0.375rem).

Live Operations is the signature layout: a register of station rows with a sticky left station column (18rem, closed by a 3px double rule), separate ruled columns for stage, discharge and volume, and a status column. Selecting a row opens the inspector in a right pane (grid `minmax(0,1fr) minmax(30rem,43%)` from 80rem), containing the 460px-high strip chart, provenance stamp and correction ledger. Below 36rem the table collapses to one summary block per station.

Breakpoints as built: 36rem (phone), 52rem, 58rem, 70rem, 72rem and 80rem (wide register). Targets are at least 24px on desktop and 44px on phones (36rem and below). Reduced motion collapses all transitions and animations to 0.01ms.

## Elevation & Depth

Flat. There are no shadows: the `--shadow-sm`, `--shadow`, `--shadow-md` and `--shadow-lg` tokens exist only for compatibility and all resolve to `none`. Depth is conveyed by rules and tone: a 3px double ink rule divides sheets, a 1px rule divides rows, Ledger Tint lifts heads and hover rows, and a 3px double rule frames popovers and the columns menu. The only motion is a 140ms colour/background transition and a 140ms popover fade.

### Named Rules
**The Ruled-Not-Raised Rule.** Hierarchy is built with rules (double for a sheet or head, hairline for a row) and tonal tint, never with shadows, blur or gradients.

## Shapes

Square. Corners are 0 (`--r-sm`, `--r-lg`, `--r-xl`), with a single 2px exception (`--r`) on text inputs. Borders are 1px Rule for controls, 1px Hairline for quiet dividers, 2px ink for section tops and focus, 3px double for heads, sheet boundaries, stamps and popovers. Icons are 16px, 1.5 stroke, square caps and mitre joins, one pen weight, drawn from a single path table.

The hatch is the one recurring fill: a 45-degree diagonal line pattern in Millimetre Grid at 35 to 45 percent opacity (8px tile in chips and cells; a 7px tile at full ink-grey stroke inside the strip chart). It marks absent or untrustworthy evidence and only that.

### Named Rules
**The Hatch-Means-Abnormal-Evidence Rule.** Hatch is reserved for NO DATA, UNRELIABLE, FAULT, STALE and UNASSESSABLE. A chip is hatched only through an explicit `data-hatched` evidence flag; tone (attention or critical) alone never adds hatch. Normal or merely "not configured" states stay plain.
**The Stamp Rule.** Synthetic-data and provenance declarations are stamp boxes: 3px double Correction Red rule, Sheet fill, uppercase text, plus an SVG diamond icon.

## Components

### Buttons
- **Shape:** square (0 radius), 1px Rule border (Graphite border after the later overrides), 2.25rem minimum height, padding 0.45rem 0.85rem, 600 weight at 0.875rem.
- **Primary:** Survey Ink fill, Sheet text, ink border; hover lightens to Ink Secondary. Disabled primary drops to Ledger Tint with muted text.
- **Ghost / outline:** Sheet fill, ink text, Graphite border; hover tints to Ledger Tint and darkens the border to ink. Disabled uses a dashed border and muted text.
- **Focus:** a global 2px Plan Blue outline with 2px offset on every interactive element.

### Chips and stamps
- **Status chip:** inline flex, square, 11px 700 uppercase with 0.025em tracking, an icon (16px SVG), then the text label. Tones: neutral (Ledger Tint), information (blue wash, Plan Blue border), positive (green wash, Record Green border), attention (stamp wash, Stamp Brown border), critical (red wash, Correction Red border). Abnormal evidence adds the hatch via `data-hatched`.
- **In a ledger row,** normal "reported" chips are unboxed muted text; only abnormal chips keep a border and pattern.
- **Synthetic stamp:** Sheet fill, 3px double Correction Red border, uppercase label with diamond icon; appears in the running header as a badge and as an expandable notice, and inside the inspector as the provenance stamp.

### Inputs / Fields
- **Style:** Ledger Tint fill, 1px border, 2px radius, 0.5rem 0.75rem padding at 0.875rem. On the live filters a Graphite border.
- **Focus:** fill lifts to Sheet and border to Plan Blue, plus the global 2px Plan Blue outline.

### Navigation
A sidebar rail in Ledger Tint with a 1px bottom rule per item (no gaps, square). Items are 2.75rem tall, 600 weight at 0.875rem, each with a 16px SVG icon. Hover swaps to Sheet. The active item (`aria-current='page'`) is filled Survey Ink with Sheet text and an underlined label. The product mark sits above, with a 3px double rule beneath. On small screens the rail is reached through a menu button.

### Ledger table (signature)
Collapsed borders, Sheet rows; column heads in 11px uppercase on Ledger Tint with a 3px double rule above and below; 1px Rule dividers between columns; sticky head and sticky first column. The station column is closed by a 3px double rule. Figures are right-aligned in mono; hover and focus-within tint the row to Ledger Tint with a 1px ink outline on keyboard focus. NO DATA and UNRELIABLE cells carry the hatch behind a Sheet-backed figure.

### Strip chart (signature)
An SVG recorder chart on Sheet paper with a Graphite 1px frame: minor grid at 0.4 stroke and 50 percent opacity, major (hourly) grid at 0.8 stroke, track rules between quantities (stage, discharge, volume), a Survey Ink trace at 1.5px with filled points (the built strip draws no plan/reference line yet; the contract's secondary-blue plan line is not shipped in the chart), a 2px ink "now" line at the right edge labelled with the cutoff time, struck originals as red ticks (1.5px), frozen sensors as a dashed ink-grey flat line tagged in text. True gaps are hatched bands with a bracket and leader and a plated "NO DATA" label; where no 24-hour history was supplied at all, the track is plain paper with the note "No 24-hour history supplied" rather than hatch, so absence of history is never confused with a recorded gap. Every chart has a parallel ledger table with caption.

### Correction ledger
Revisions are entries separated by 3px double rules: the struck original in Correction Red with a 1.5px strike, the revised value inked above in bold ink, and a definition grid of who, when and why.

## Do's and Don'ts

### Do:
- **Do** build hierarchy with rules: a 3px double ink rule for a sheet or column head, a 1px Rule for a row, a 2px ink rule to open an `h2`.
- **Do** set every measured figure, station code and identifier in Cascadia Mono / Consolas with tabular numerals, right-aligned in its column.
- **Do** show status as text + 16px SVG icon (+ hatch for abnormal evidence); give every state a readable label.
- **Do** label synthetic or provenance information with a stamp box and keep the data cutoff in the running header.
- **Do** keep stage (m), discharge (m3/s) and volume (m3) in separate columns or tracks, each with its unit in the head.
- **Do** keep targets at least 24px on desktop and 44px at 36rem and below, with the 2px Plan Blue focus ring at 2px offset.
- **Do** distinguish plain paper ("No 24-hour history supplied") from hatched true gaps.

### Don't:
- **Don't** use shadows, gradients, glass or rounded panels in the chrome; radius stays 0 (2px only for text inputs). The source-map artwork in the Map workspace keeps its own lake gradient and is not part of this system.
- **Don't** use the blue-accent KPI-card dashboard template: no stat tiles, cards-in-cards, or side-stripe accents.
- **Don't** apply hatch to normal, positive, over, under or merely unconfigured states.
- **Don't** rely on colour alone to show a state, and never render a no-data or unreliable reading in normal ink weight.
- **Don't** use the teal grid as a page background or decoration.
- **Don't** introduce a new accent colour or a second display typeface; there is one ink, one reference blue and one correction red.
- **Don't** describe or present synthetic data as real government telemetry.

### Not canonized (defects and drift carried by the build)
- The three appended layers `finish.css`, `live-finish.css` and `workspace-finish.css` override `styles.css` and should be folded into it; several tokens (for example the hatch) are defined three times (`--ledger-hatch`, `--register-hatch`, `--finish-hatch`, `--map-register-hatch`) with slightly different opacity and stroke colours (`#6f8d85` in the chip/cell variant vs `#8fbfb0`).
- The Live Operations status column clips when the inspector pane is open (the status text is compressed to 10 to 11px with `keep-all` wrapping).
- Bahnschrift is Windows-only; fonts are system stacks and self-hosting font files is an open follow-up.
- The synthetic network geometry renders as crossing diamond lattices because of the data, not by design.
- Compatibility tokens (`--shadow*`, `--r*`) still exist and some base rules (hover `translateX`, `translateY`, `rgba(255,255,255,.05)` hover) survive in `styles.css` beneath the overrides; they are not part of the system.
