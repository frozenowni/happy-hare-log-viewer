# Happy Hare Log Viewer — v1 Spec

## Problem Statement

Klipper/Voron users running Happy Hare (the MMU driver) accumulate `mmu.log` files that are dense, timestamp-only, and hard to read by eye. When something goes wrong — a jam, excessive filament slippage, an unreliable gate — or when they simply want to understand how their MMU performs over time (swap durations, wear-counter trends, pause frequency), they have to manually scroll and grep through a plain text file with no visualization, no way to jump between related events, and no guidance on what's worth looking for. No existing tool turns `mmu.log` into an at-a-glance analysis.

## Solution

A free, publishable, static web app (`happy-hare-log-viewer`) the user opens in their browser and drags their `mmu.log` into. Entirely client-side — nothing is ever uploaded. It parses the log into structured Events and Sessions (print jobs), then presents: charts (swap timing trends, gate usage/reliability, encoder slippage, pause/error frequency, wear-counter tracking), diagrams (live Gate↔Tool map, session timeline, Job State machine), a raw log viewer (line-numbered, color-coded, virtualized for large files) cross-linked to every other view, and one-click predefined searches for the most important content categories, plus free-text/regex search. Users can scope all views to a single detected print job or the whole file.

## User Stories

1. As a Happy Hare user, I want to drag-and-drop my `mmu.log` file into the app, so that I can start analyzing it without any upload or installation step.
2. As a Happy Hare user, I want confidence that my log file never leaves my browser, so that I trust the tool with potentially sensitive machine data.
3. As a Happy Hare user, I want the app to work by simply opening `index.html` or a hosted URL, so that I don't need to install anything or run a build step.
4. As a community member evaluating the tool, I want the source hosted in a public GPLv3-licensed repo, so that I can fork, audit, or contribute to it.
5. As a Happy Hare user with a large accumulated `mmu.log`, I want the raw log view to stay smooth and responsive, so that I can scroll through months of history without the browser lagging.
6. As a Happy Hare user, I want the app to gracefully handle log lines it doesn't recognize (e.g. from a different Happy Hare version or verbosity level), so that the tool never crashes or silently drops content.
7. As a Happy Hare user, I want the app to detect individual print jobs/sessions within my log, so that I can focus my analysis on just one print instead of my whole history.
8. As a Happy Hare user, I want a session picker (or "whole file" option), so that I can switch between analyzing a single job and aggregate trends.
9. As a Happy Hare user, I want a chart of swap timing (unload/load/post/complete durations) over time, so that I can spot performance regressions or improvements.
10. As a Happy Hare user, I want gate usage and reliability data (the emoji quality ratings) charted, so that I can identify which gates are unreliable.
11. As a Happy Hare user, I want encoder-vs-gear slippage data charted, so that I can diagnose bowden tube or gear tension issues.
12. As a Happy Hare user, I want pause/error frequency charted over time, so that I can tell whether my MMU's reliability is improving or degrading.
13. As a Happy Hare user, I want wear-counter tracking (`servo_down`, `cutter_blade`, etc.) charted against their configured limits, so that I know when to inspect or replace parts.
14. As a Happy Hare user, I want a live Gate↔Tool map diagram, so that I can see at a glance which gate is assigned to which tool at any point in the log.
15. As a Happy Hare user, I want a session timeline showing tool changes, pauses, and errors as markers, so that I can quickly scan the shape of a print job.
16. As a Happy Hare user, I want to click a timeline marker and jump straight to the corresponding raw log lines, so that I can investigate an event in full context.
17. As a Happy Hare user, I want a Job State machine diagram showing state transitions and their counts, so that I can understand the print lifecycle Happy Hare tracked.
18. As a Happy Hare user, I want the raw log view to color-code lines by category, so that I can visually scan for patterns without reading every word.
19. As a Happy Hare user, I want multi-line blocks (MMU Statistics tables, Gate maps, ASCII visuals) kept intact in the raw view, so that they remain readable as Happy Hare intended.
20. As a Happy Hare user, I want a one-click predefined search for Errors & Pauses, so that I can immediately find what went wrong in a print.
21. As a Happy Hare user, I want a one-click predefined search for Warnings (e.g. slippage), so that I can catch early signs of mechanical issues.
22. As a Happy Hare user, I want a one-click predefined search for Tool Changes, so that I can review every swap in the log.
23. As a Happy Hare user, I want a one-click predefined search for MMU Statistics Reports, so that I can jump straight to Happy Hare's own performance summaries.
24. As a Happy Hare user, I want a one-click predefined search for Gate Statistics, so that I can review per-gate reliability ratings directly.
25. As a Happy Hare user, I want a one-click predefined search for Wear-Counter Alerts, so that I can find maintenance warnings quickly.
26. As a Happy Hare user, I want a one-click predefined search for Job State Changes, so that I can trace the print lifecycle without noise.
27. As a Happy Hare user, I want a one-click predefined search for EndlessSpool/Gate Remaps, so that I can review automatic gate reassignment events.
28. As a Happy Hare user with Spoolman integrated, I want a one-click predefined search for Spoolman events, so that I can find spool-tracking issues without digging through Errors.
29. As a Happy Hare user, I want predefined searches to highlight matches in place in the raw view rather than hiding everything else, so that I keep surrounding context.
30. As a Happy Hare user, I want free-text/regex search over the raw log, so that I can look for anything not covered by the predefined categories.
31. As a Happy Hare user, I want clicking a chart data point or diagram element to jump to the relevant raw log line(s), so that all views stay cross-referenced.
32. As a maintainer/contributor, I want zero build step, so that I can clone the repo and start editing `index.html`/JS/CSS directly.
33. As a maintainer/contributor, I want the parsing logic covered by tests against real and synthetic log fixtures, so that changes to message-pattern matching don't silently regress.
34. As a maintainer/contributor, I want the domain vocabulary (Event, Session, Category, Swap, Gate, TTG Map, etc.) used consistently in code and docs, so the codebase stays navigable as it grows.
35. As a Happy Hare user on an older or newer Happy Hare version with slightly different message wording, I want unrecognized lines to still appear (as Uncategorized) rather than disappear, so I never lose information from my log.
36. As a Happy Hare user, I want the app usable purely as a static site (e.g. via GitHub Pages), so I don't need to run a server myself.

## Implementation Decisions

- **Single test seam**: `parseLog(rawText: string) -> ParsedLog`. `ParsedLog` holds `Events` (each: source line range, timestamp with inferred day-rollover handling, Category, raw text including Continuation Lines, category-specific structured fields) and `Sessions` (derived from Job State transitions, referencing their start/end Events and the sequence of Job State transitions within).
- **Categories** (fixed vocabulary, see `CONTEXT.md`): Command Echo, Tool Change Request, Swap (Load Sequence / Unload Sequence), Gate/TTG Map Update, Job State Change, MMU Statistics Report, Gate Statistics, Wear Counter, Warning (including Encoder Slippage), Error/Pause, EndlessSpool/Gate Remap, Spoolman, Uncategorized. Sync/Servo/Cutter/LED/eSpooler events are parsed and categorized for completeness (so they're never mis-dropped into Uncategorized) but do not get dedicated Predefined Search buttons or feed any chart in v1 — no user story asks for that, and doing it speculatively would be scope creep.
- **Timestamp/day handling**: `mmu.log` timestamps are `HH:MM:SS` only, no date. The parser detects day rollovers (time value decreasing) and increments an internal day counter to keep chronological ordering and duration math correct across sessions spanning midnight.
- **Parser resilience**: no pattern match ever throws or drops a line; unmatched Timestamped Entries (with their Continuation Lines) become Uncategorized Events, preserving raw text verbatim.
- **Continuation-line association**: any Log Line not matching `^HH:MM:SS ` is appended to the preceding Event's raw block; it never starts a new Event.
- **Predefined Search behavior**: each of the 9 categories maps to one or more Category values; selecting one highlights matching lines in place in the raw view (dim non-matches, preserve scroll position) rather than removing non-matches.
- **Session detection**: a Session opens at any Job State transition landing on `STARTED` (regardless of its `from` state — e.g. `COMPLETE -> STARTED` on a restarted job still opens a new Session) and closes at the last Job State transition recorded for it before the next Session opens. A session picker scopes every chart/diagram/raw-highlight to one Session or "Whole file".
- **Cross-view linking**: every chart data point, diagram element, and timeline marker carries a reference to its originating Event(s); clicking it scrolls the raw viewer to that Event and highlights it.
- **Rendering**: Chart.js (via CDN) for timing/reliability/slippage/wear-counter/pause-frequency charts; hand-rolled SVG/HTML for the Gate↔Tool map, session timeline, and Job State diagram.
- **Large-file handling**: the raw log view uses virtualized/windowed rendering — only lines near the viewport are in the DOM.
- **No backend, ever** ([ADR 0001](../adr/0001-client-side-only.md)); **no build step/framework** ([ADR 0002](../adr/0002-no-framework.md)); single-file upload only for v1 (no rotated-log stitching, no Moonraker fetch).
- **License**: GPLv3.
- **Repo**: new standalone repo at `C:\Claude\happy-hare-log-viewer` (git-initialized locally; not yet pushed to a remote).

## Testing Decisions

- A good test here exercises `parseLog` purely on input text and asserts on the resulting `ParsedLog` structure (Events, Categories, Sessions) — never on DOM output or Chart.js internals. This is a pure-function seam, so tests are plain input/output assertions with no browser/DOM harness needed.
- **Fixtures**: the real 513-line sample `mmu.log` (covers tool changes, load/unload sequences, MMU Statistics Reports, Gate Statistics, a pause/error/slippage incident, slicer tool map) plus synthetic fixtures for: a log spanning a midnight day-rollover, TRACE/STEPPER-verbosity lines present, a log with no MMU_STATS block at all, a log containing only Uncategorized/unknown-format lines, a log with Spoolman events, a log with an EndlessSpool gate remap.
- The rendering layer (charts/diagrams/raw-view/search UI) gets at most light smoke-level checks (e.g. "given a `ParsedLog`, the timeline renders N markers") — not the focus of automated testing; visual/UX correctness is verified manually in-browser.
- No prior art exists yet in this repo (brand new) — this spec establishes the testing convention going forward.

## Out of Scope

- Server-side processing or persistent shareable result links ([ADR 0001](../adr/0001-client-side-only.md)).
- Any component framework or build tooling ([ADR 0002](../adr/0002-no-framework.md)).
- Loading/stitching multiple rotated log files (`mmu.log.1`, `mmu.log.2`, ...) in one session.
- Fetching `mmu.log` directly from a Moonraker URL/API.
- Predefined-search buttons dedicated to eSpooler, LED, or generic Sync/Servo/Cutter events (parsed and charted, but no standalone quick-filter button in v1).
- Editing/modifying the log or MMU configuration from within the app — this is a read-only analysis tool.
- Any authentication, accounts, or saved user state across sessions.

## Further Notes

- Grounded in a real 513-line `mmu.log` sample (`C:\Claude\Voron_2p4\mmu.log`) and a full source-level review of Happy Hare's logging code (`github.com/moggieuk/Happy-Hare`), covering the command-echo mechanism, every message template per category, the Gate Statistics emoji quality ladder, and the split between what reaches `mmu.log` vs `klippy.log`.
- Domain vocabulary lives in `CONTEXT.md` at the repo root; ADRs in `docs/adr/`. Both should be read before implementation and kept in sync as decisions evolve.
