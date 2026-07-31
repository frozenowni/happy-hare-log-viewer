/**
 * Parses a Happy Hare `mmu.log` file into a structured ParsedLog.
 *
 * This is the app's single test seam (see docs/adr and CONTEXT.md): a pure
 * function from raw text to a plain-data structure, with no DOM/browser
 * dependency, so it can be exercised directly in tests.
 */

/** @typedef {import('./categories.js').Category} Category */

/**
 * @typedef {Object} EventTime
 * @property {string} raw - "HH:MM:SS" as it appeared in the source.
 * @property {number} dayOffset - inferred day index (0-based), see day-rollover handling below.
 * @property {number} secondsOfDay
 * @property {number} absoluteSeconds - dayOffset * 86400 + secondsOfDay.
 */

/**
 * @typedef {Object} LogEvent
 * @property {number} index - position within the events array.
 * @property {number} startLine - 1-based source line number of the Timestamped Entry.
 * @property {number} endLine - 1-based source line number of the last Continuation Line (== startLine if none).
 * @property {EventTime} time
 * @property {Category} category
 * @property {string} message - the Timestamped Entry's message text (after "HH:MM:SS ").
 * @property {string} raw - full raw text of the event (Timestamped Entry + Continuation Lines).
 * @property {Record<string, any>} fields - category-specific structured fields.
 * @property {number | null} sessionIndex - index into ParsedLog.sessions, or null if unassigned.
 */

/**
 * @typedef {Object} JobStateTransition
 * @property {number} eventIndex
 * @property {string} from
 * @property {string} to
 */

/**
 * @typedef {Object} Session
 * @property {number} index
 * @property {number} startEventIndex
 * @property {number} endEventIndex
 * @property {JobStateTransition[]} jobStateTransitions
 * @property {string} label
 */

/**
 * @typedef {Object} ParsedLog
 * @property {LogEvent[]} events
 * @property {Session[]} sessions
 */

const TIMESTAMP_RE = /^(\d{2}):(\d{2}):(\d{2}) (.*)$/;

// mmu_logger.py tags DEBUG/TRACE/STEPPER lines with a (possibly non-breaking)
// space + level name + ": " prefix. Content matching must be level-agnostic,
// since the same fact (e.g. a Job State transition) can be logged at any level.
const LEVEL_TAG_RE = /^[\s ]*(?:DEBUG|TRACE|STEPPER):\s*/;

/**
 * @param {string} message
 * @returns {string}
 */
function stripLevelTag(message) {
  return message.replace(LEVEL_TAG_RE, '');
}

/**
 * Parses "HH:MM:SS" into seconds since midnight.
 * @param {string} h
 * @param {string} m
 * @param {string} s
 * @returns {number}
 */
function toSecondsOfDay(h, m, s) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// Only treat a backward time jump as a midnight rollover when it looks like
// one (previous time late in the day, new time early in the day). Real
// mmu.log files can also jump backward for unrelated reasons -- e.g. a
// printer restart flushing a startup banner slightly out of order relative
// to the previous session's tail -- and those must NOT shift every
// subsequent event onto a fictitious "day 2".
const LATE_DAY_THRESHOLD_SECONDS = 22 * 3600; // 22:00:00
const EARLY_DAY_THRESHOLD_SECONDS = 2 * 3600; // 02:00:00

/**
 * @param {string} message
 * @returns {{ verb: string, args: string } | null}
 */
function matchCommandEcho(message) {
  if (!message.startsWith('> ')) return null;
  const rest = message.slice(2);
  const spaceIndex = rest.indexOf(' ');
  const verb = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : rest.slice(spaceIndex + 1);
  return { verb, args };
}

/**
 * Best-effort parse of KEY=VALUE gcode-style arguments into an object.
 * @param {string} args
 * @returns {Record<string, string>}
 */
function parseArgs(args) {
  /** @type {Record<string, string>} */
  const result = {};
  const re = /(\w+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g;
  let match;
  while ((match = re.exec(args)) !== null) {
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

const PAUSE_RESUME_VERBS = new Set(['PAUSE', 'RESUME', 'CLEAR_PAUSE', 'CANCEL_PRINT', 'MMU_PAUSE', 'MMU_UNLOCK']);
const GATE_MAP_VERBS = new Set(['MMU_SELECT', 'MMU_TTG_MAP', 'MMU_GATE_MAP']);

/**
 * Classifies a command-echo message (`> VERB ARGS`).
 * @param {string} verb
 * @param {string} args
 * @returns {{ category: Category, fields: Record<string, any> }}
 */
function classifyCommandEcho(verb, args) {
  const argsParsed = parseArgs(args);
  if (verb === 'MMU_CHANGE_TOOL') {
    return { category: 'tool-change-request', fields: { verb, argsParsed } };
  }
  if (GATE_MAP_VERBS.has(verb)) {
    return { category: 'gate-map-update', fields: { verb, argsParsed } };
  }
  if (verb === 'MMU_ENDLESS_SPOOL') {
    return { category: 'endless-spool-remap', fields: { verb, argsParsed } };
  }
  if (PAUSE_RESUME_VERBS.has(verb)) {
    return { category: 'error-pause', fields: { verb, argsParsed } };
  }
  if (verb === 'MMU_STATS') {
    if ('COUNTER' in argsParsed) {
      return { category: 'wear-counter', fields: { verb, counter: argsParsed.COUNTER, argsParsed } };
    }
    return { category: 'mmu-stats-report', fields: { verb, argsParsed } };
  }
  if (verb === 'MMU_SPOOLMAN') {
    return { category: 'spoolman', fields: { verb, argsParsed } };
  }
  return { category: 'command-echo', fields: { verb, argsParsed } };
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseNumber(text) {
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** @type {{ category: Category, re: RegExp, extract?: (m: RegExpMatchArray) => Record<string, any> }[]} */
const CONTENT_RULES = [
  {
    category: 'job-state-change',
    re: /^Job State: (\S+) -> (\S+) \((.*)\)$/,
    extract: (m) => ({ from: m[1], to: m[2], detail: m[3] }),
  },
  {
    category: 'mmu-stats-report',
    re: /^MMU Statistics:/,
    extract: () => ({}), // filled in by parseMmuStatsReport() after continuation lines are attached
  },
  {
    category: 'swap',
    re: /^Load of (-?[\d.]+)mm filament successful(?: \(adjusted encoder: (-?[\d.]+)mm\))?/,
    extract: (m) => ({ direction: 'load', filamentMm: parseNumber(m[1]), encoderMm: m[2] ? parseNumber(m[2]) : null }),
  },
  {
    category: 'swap',
    re: /^Unload of (-?[\d.]+)mm filament successful(?: \(adjusted encoder: (-?[\d.]+)mm\))?/,
    extract: (m) => ({
      direction: 'unload',
      filamentMm: parseNumber(m[1]),
      encoderMm: m[2] ? parseNumber(m[2]) : null,
    }),
  },
  {
    category: 'warning',
    re: /^Warning: Excess slippage.*?Gear moved (-?[\d.]+)mm, Encoder measured (-?[\d.]+)mm/,
    extract: (m) => ({
      direction: /unload/i.test(m[0]) ? 'unload' : 'load',
      gearMm: parseNumber(m[1]),
      encoderMm: parseNumber(m[2]),
    }),
  },
  { category: 'warning', re: /^Warning: /, extract: () => ({}) },
  {
    category: 'error-pause',
    re: /^MMU issue detected\.? ?(.*)$/,
    extract: (m) => ({ context: m[1] || null }),
  },
  { category: 'error-pause', re: /^MMU issue: (.*)$/, extract: (m) => ({ reason: m[1] }) },
  { category: 'error-pause', re: /^After fixing, call RESUME/, extract: () => ({}) },
  {
    category: 'tool-change-request',
    re: /^Tool T\d+ is already loaded/,
    extract: () => ({}),
  },
  {
    category: 'tool-change-request',
    re: /^Tool (T\d+) enabled/,
    extract: (m) => ({ tool: m[1] }),
  },
  {
    category: 'swap',
    re: /^Tool change requested, from (T\d+) to (T\d+)/,
    extract: (m) => ({ fromTool: m[1], toTool: m[2] }),
  },
  {
    category: 'swap',
    re: /^Tool change requested: (T\d+)/,
    extract: (m) => ({ fromTool: null, toTool: m[1] }),
  },
  { category: 'swap', re: /^Loading initial tool T\d+\.\.\./, extract: () => ({}) },
  { category: 'swap', re: /^Loading filament\.\.\./, extract: () => ({}) },
  { category: 'swap', re: /^Unloading filament\.\.\./, extract: () => ({}) },
  {
    category: 'swap',
    re: /^\[T\d+\] ([<>]) En /,
    extract: (m) => ({ direction: m[1] === '>' ? 'load' : 'unload' }),
  },
  {
    category: 'gate-map-update',
    re: /^Gate : \|/,
    extract: () => ({}),
  },
  { category: 'gate-map-update', re: /^Resetting (?:tool selected|TTG map|Endless Spool mapping|gate map)/, extract: () => ({}) },
  { category: 'gate-map-update', re: /^Received gate map update/, extract: () => ({}) },
  {
    category: 'endless-spool-remap',
    re: /^EndlessSpool is (enabled|disabled)/,
    extract: (m) => ({ enabled: m[1] === 'enabled' }),
  },
  { category: 'endless-spool-remap', re: /^A runout has been detected/, extract: () => ({}) },
  {
    category: 'endless-spool-remap',
    re: /^Remapping T(\d+) to gate (\d+)/,
    extract: (m) => ({ tool: Number(m[1]), gate: Number(m[2]) }),
  },
  { category: 'endless-spool-remap', re: /^Ejecting filament remains to designated waste gate (\d+)/, extract: (m) => ({ gate: Number(m[1]) }) },
  {
    category: 'spoolman',
    re: /^Spool ID: (\d+) automatically assigned to gate (\d+)/,
    extract: (m) => ({ spoolId: Number(m[1]), gate: Number(m[2]) }),
  },
  { category: 'spoolman', re: /^Error while .*spool/i, extract: () => ({}) },
  { category: 'spoolman', re: /spoolman/i, extract: () => ({}) },
  {
    category: 'sync',
    re: /^MmuSyncFeedbackManager: (Synced|Unsynced) MMU (?:to|from) extruder/,
    extract: (m) => ({ synced: m[1] === 'Synced' }),
  },
  { category: 'sync', re: /^MMU gear stepper will be (synced|unsynced)/, extract: (m) => ({ synced: m[1] === 'synced' }) },
  { category: 'servo', re: /^Setting servo to/, extract: () => ({}) },
  { category: 'servo', re: /^Current servo angle/, extract: () => ({}) },
  { category: 'cutter', re: /^Measuring blade cutter pos/i, extract: () => ({}) },
  { category: 'cutter', re: /blade_pos/, extract: () => ({}) },
  { category: 'led', re: /^No LEDs configured/, extract: () => ({}) },
  { category: 'led', re: /^Error updating leds/i, extract: () => ({}) },
  { category: 'espooler', re: /^ESPOOLER:/, extract: () => ({}) },
];

/**
 * @param {string} message
 * @returns {{ category: Category, fields: Record<string, any> }}
 */
function classifyMessage(message) {
  const stripped = stripLevelTag(message);

  const echo = matchCommandEcho(stripped);
  if (echo) {
    return classifyCommandEcho(echo.verb, echo.args);
  }

  for (const rule of CONTENT_RULES) {
    const match = stripped.match(rule.re);
    if (match) {
      return { category: rule.category, fields: rule.extract ? rule.extract(match) : {} };
    }
  }

  return { category: 'uncategorized', fields: {} };
}

const GATE_STATISTICS_RE = /(\d+):([^\s,]+)/g;

/**
 * @param {string} raw
 * @returns {{ gate: number, symbol: string }[] | null}
 */
function parseGateStatistics(raw) {
  const lineMatch = raw.match(/Gate Statistics:\s*\n?\s*(.+)/);
  if (!lineMatch) return null;
  /** @type {{ gate: number, symbol: string }[]} */
  const result = [];
  let match;
  const re = new RegExp(GATE_STATISTICS_RE);
  while ((match = re.exec(lineMatch[1])) !== null) {
    result.push({ gate: Number(match[1]), symbol: match[2].replace(/,$/, '') });
  }
  return result.length > 0 ? result : null;
}

/**
 * Converts a duration cell from an MMU Statistics table ("28.1", "1:08",
 * "11:51:00", "-") into seconds.
 * @param {string} text
 * @returns {number | null}
 */
function parseDurationToSeconds(text) {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const parts = trimmed.split(':');
  if (parts.length === 1) return parseNumber(parts[0]);
  let seconds = 0;
  for (const part of parts) {
    const n = parseNumber(part);
    if (n === null) return null;
    seconds = seconds * 60 + n;
  }
  return seconds;
}

/**
 * Fills in the structured fields for an `MMU Statistics:` report event, once
 * its full raw text (including continuation lines) is known.
 * @param {string} raw
 * @returns {Record<string, any>}
 */
function parseMmuStatsReport(raw) {
  /** @type {Record<string, any>} */
  const fields = {};

  const counterMatch = raw.match(/\|\s*(\d+)(?:\((\d+)\))?\s*\|/);
  if (counterMatch) {
    fields.totalSwaps = Number(counterMatch[1]);
    fields.thisJobSwapNumber = counterMatch[2] !== undefined ? Number(counterMatch[2]) : null;
  }

  const lastRowMatch = raw.match(/\|\s*last\s*\|(.+)\|\s*$/m);
  if (lastRowMatch) {
    fields.lastSwapDurationsSeconds = lastRowMatch[1]
      .split('|')
      .map((cell) => parseDurationToSeconds(cell));
  }

  const pausedAllTimeMatch = raw.match(/([\d:]+) spent paused over (\d+) pauses \(All time\)/);
  if (pausedAllTimeMatch) {
    fields.pausedAllTimeSeconds = parseDurationToSeconds(pausedAllTimeMatch[1]);
    fields.pausesAllTime = Number(pausedAllTimeMatch[2]);
  }

  const pausedThisJobMatch = raw.match(/([\d:.]+) spent paused over (\d+) pauses \(This job\)/);
  if (pausedThisJobMatch) {
    fields.pausedThisJobSeconds = parseDurationToSeconds(pausedThisJobMatch[1]);
    fields.pausesThisJob = Number(pausedThisJobMatch[2]);
  }

  const toolchangesMatch = raw.match(/(\d+)\s*(?:\/\s*(\d+))?\s*toolchanges/);
  if (toolchangesMatch) {
    fields.toolchangesThisJob = Number(toolchangesMatch[1]);
    fields.toolchangesTotal = toolchangesMatch[2] !== undefined ? Number(toolchangesMatch[2]) : null;
  }

  const incidentMatch = raw.match(/Number of swaps since last incident: (\d+) \(Record: (\d+)\)/);
  if (incidentMatch) {
    fields.swapsSinceIncident = Number(incidentMatch[1]);
    fields.swapsSinceIncidentRecord = Number(incidentMatch[2]);
  }

  fields.gateStatistics = parseGateStatistics(raw);

  return fields;
}

/**
 * @param {string} rawText
 * @returns {ParsedLog}
 */
export function parseLog(rawText) {
  const lines = rawText.split(/\r\n|\n/);

  /** @type {LogEvent[]} */
  const events = [];

  let dayOffset = 0;
  /** @type {number | null} */
  let prevSecondsOfDay = null;

  /** @type {{ startLine: number, timeRaw: string, secondsOfDay: number, message: string, rawLines: string[] } | null} */
  let current = null;

  function flush() {
    if (!current) return;
    if (prevSecondsOfDay !== null && current.secondsOfDay < prevSecondsOfDay) {
      if (prevSecondsOfDay >= LATE_DAY_THRESHOLD_SECONDS && current.secondsOfDay <= EARLY_DAY_THRESHOLD_SECONDS) {
        dayOffset += 1;
      }
    }
    prevSecondsOfDay = current.secondsOfDay;

    const raw = current.rawLines.join('\n');
    const { category, fields } = classifyMessage(current.message);
    if (category === 'mmu-stats-report' && /^MMU Statistics:/.test(current.message)) {
      Object.assign(fields, parseMmuStatsReport(raw));
    }

    events.push({
      index: events.length,
      startLine: current.startLine,
      endLine: current.startLine + current.rawLines.length - 1,
      time: {
        raw: current.timeRaw,
        dayOffset,
        secondsOfDay: current.secondsOfDay,
        absoluteSeconds: dayOffset * 86400 + current.secondsOfDay,
      },
      category,
      message: current.message,
      raw,
      fields,
      sessionIndex: null,
    });
    current = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TIMESTAMP_RE);
    if (match) {
      flush();
      const [, h, m, s, message] = match;
      current = {
        startLine: i + 1,
        timeRaw: `${h}:${m}:${s}`,
        secondsOfDay: toSecondsOfDay(h, m, s),
        message,
        rawLines: [line],
      };
    } else if (current) {
      current.rawLines.push(line);
    }
    // Lines before the first Timestamped Entry (shouldn't happen in a real
    // mmu.log, but tolerate it) are silently dropped rather than crashing.
  }
  flush();

  const sessions = detectSessions(events);

  return { events, sessions };
}

/**
 * Sessions are bounded by Job State transitions: a session starts at any
 * transition landing on STARTED (regardless of its `from` state -- e.g. a
 * cancelled print restarting goes COMPLETE -> STARTED, not just
 * INITIALIZED -> STARTED), and ends at the last Job State transition
 * recorded for it before the next session starts. Events before the first
 * session, and any gap between one session's last transition and the next
 * session's start, are left unassigned (sessionIndex stays null) rather than
 * guessed at.
 * @param {LogEvent[]} events
 * @returns {Session[]}
 */
function detectSessions(events) {
  /** @type {Session[]} */
  const sessions = [];
  /** @type {Session | null} */
  let current = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.category !== 'job-state-change') continue;

    if (event.fields.to === 'STARTED') {
      current = {
        index: sessions.length,
        startEventIndex: i,
        endEventIndex: i,
        jobStateTransitions: [],
        label: `Job @ ${event.time.raw}`,
      };
      sessions.push(current);
    }

    if (current) {
      current.jobStateTransitions.push({ eventIndex: i, from: event.fields.from, to: event.fields.to });
      current.endEventIndex = i;
    }
  }

  for (const session of sessions) {
    for (let i = session.startEventIndex; i <= session.endEventIndex; i++) {
      events[i].sessionIndex = session.index;
    }
  }

  return sessions;
}
