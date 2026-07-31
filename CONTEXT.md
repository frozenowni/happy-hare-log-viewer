# Happy Hare Log Viewer

A static, client-side web app that loads a Happy Hare MMU `mmu.log` file and renders it as charts, diagrams, and a searchable raw view. Published for the Happy Hare / Voron community; no data ever leaves the user's browser.

## Log Structure

**Log Line**:
One physical line of `mmu.log`. Two kinds exist: a **Timestamped Entry** (`HH:MM:SS <message>`) or a **Continuation Line** (no timestamp, ~9-space indented, belongs to the Timestamped Entry immediately above it — e.g. a row of a Gate Map or MMU Statistics Report).
_Avoid_: "raw line" for the timestamped kind specifically — a Log Line is either kind.

**Event**:
Our tool's unit of analysis: one Timestamped Entry plus all of its trailing Continuation Lines, classified into a Category. Everything charted, diagrammed, or searched is derived from Events, never from individual Log Lines.

**Category**:
The classification assigned to an Event (e.g. Tool Change Request, Swap, Load Sequence, Unload Sequence, Warning, Job State Change, MMU Statistics Report, Gate Statistics, Slicer Tool Map). Drives which Predefined Search and chart an Event feeds.

**Uncategorized**:
The fallback Category for any Event whose message doesn't match a known pattern. Always retained and shown in the raw view and free-text search — never dropped, since Happy Hare's message wording varies across versions.
_Avoid_: "unknown", "unparsed" — use Uncategorized consistently.

**Command Echo**:
An Event whose message is Happy Hare verbatim-echoing a gcode command it just received (e.g. `> MMU_CHANGE_TOOL TOOL=3`). Nearly every MMU command produces one; a Command Echo is a record that a command ran, not a description of what happened as a result — the following Events describe the outcome.

## MMU Domain Concepts (from Happy Hare)

**Session** (aka Job):
One print job's worth of Events, bounded by Happy Hare's own Job State transitions (from an `INITIALIZED`/`STARTED` transition through a terminal state like `READY` or `CANCELLED`). A single `mmu.log` typically contains many Sessions accumulated over time.
_Avoid_: "print" as the noun for this — Session is the analysis-scope term; a Session may not correspond 1:1 to a print if a job is cancelled and restarted.

**Job State**:
Happy Hare's own state-machine field logged on each transition (e.g. `INITIALIZED`, `STARTED`, `PRINTING`, `PAUSED`, `PAUSE_LOCKED`, `CANCELLED`, `READY`). Session boundaries are derived from these.

**Tool Change Request**:
Any execution of `MMU_CHANGE_TOOL`. May be a no-op ("Tool T3 is already loaded") if the requested Tool is already active.

**Swap**:
A Tool Change Request that actually performs an Unload Sequence and/or Load Sequence. Matches Happy Hare's own "swaps" terminology in its MMU Statistics Report. Not every Tool Change Request is a Swap.
_Avoid_: "toolchange" as our canonical term (Happy Hare uses "toolchanges" and "swaps" interchangeably in its own output) — we say Swap for the thing that moves filament, Tool Change Request for the command that may or may not cause one.

**Gate**:
A physical filament channel/slot in the MMU (numbered from 0), each optionally holding a spool.

**Tool**:
The logical, slicer-facing extruder/color slot (T0, T1, ...), mapped to a Gate via the TTG Map.

**TTG Map** (Tool-to-Gate Map):
Happy Hare's current assignment of each Tool to a Gate, rendered in the log as the `Gate: / Tools: / Avail: / Selct:` ascii block. Our Gate Map diagram is a visual re-rendering of this at a given point in the log.

**Load Sequence / Unload Sequence**:
The multi-step filament move (bowden load/unload, extruder load/unload, nozzle/toolhead-sensor homing) shown as a series of progress-bar Continuation Lines under a single Event, ending in a `Load of Nmm filament successful` / `Unload of -Nmm filament successful` line.

**Encoder Slippage**:
Divergence between commanded gear-stepper movement and encoder-measured movement during a Load/Unload Sequence, surfaced by Happy Hare as a Warning.

**MMU Statistics Report**:
The periodic multi-line block (ascii timing table + Gate Statistics) Happy Hare emits after certain Swaps, containing All-time and This-job timing/reliability data.

**Gate Statistics**:
Happy Hare's own per-Gate reliability summary (emoji-coded) found inside an MMU Statistics Report.

**Wear Counter**:
A named `MMU_STATS` counter (e.g. `servo_down`, `cutter_blade`) Happy Hare tracks against an optional `LIMIT`, used to surface maintenance alerts.

## Our Tool's Concepts

**Predefined Search**:
One of the app's built-in one-click filters over Categories: Errors & Pauses, Warnings, Tool Changes, MMU Statistics Reports, Gate Statistics, Wear-Counter Alerts, Job State Changes, EndlessSpool/Gate Remaps, and Spoolman — as distinct from free-text/regex search.

**Gate Map** (diagram):
Our live, redrawn visualization of the TTG Map as it changes through a Session.

**Session Timeline** (diagram):
A horizontal timeline of a Session's Events (Swaps, Warnings, Pauses) as clickable markers that jump to the corresponding Event in the raw view.

**Job State Diagram**:
A visual state-machine diagram of Job State transitions and how many times each occurred, distinct from the Session Timeline (which is chronological, not structural).
