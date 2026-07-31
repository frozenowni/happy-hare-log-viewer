/**
 * Pure data-derivation functions that turn a ParsedLog's Events into the
 * shapes each chart needs. Kept separate from js/charts.js (the Chart.js
 * rendering glue) so this logic stays unit-testable without a DOM.
 */

/** @typedef {import('./parseLog.js').LogEvent} LogEvent */
/** @typedef {import('./parseLog.js').ParsedLog} ParsedLog */
/** @typedef {import('./categories.js').Category} Category */

/**
 * Emoji quality ladder, best (lowest risk) to worst, per Happy Hare's own
 * Gate Statistics rating. "—" means "not enough data yet" (n/a), not "bad".
 */
const GATE_QUALITY_ORDER = ['😎', '😃', '😊', '😐', '😟', '😢', '😱'];

/**
 * Returns the last element of `array` satisfying `predicate`, or null. Used
 * throughout this module (and by js/diagrams.js) wherever "the most recent
 * Event of some kind so far" is needed -- later occurrences supersede
 * earlier ones as the current picture of state.
 * @template T
 * @param {T[]} array
 * @param {(item: T) => boolean} predicate
 * @returns {T | null}
 */
export function findLast(array, predicate) {
  let result = null;
  for (const item of array) {
    if (predicate(item)) result = item;
  }
  return result;
}

/**
 * @param {string} symbol
 * @returns {number | null} 1.0 (best) down to ~0 (worst), or null for n/a.
 */
export function gateQualityScore(symbol) {
  const rank = GATE_QUALITY_ORDER.indexOf(symbol);
  if (rank === -1) return null;
  return 1 - rank / (GATE_QUALITY_ORDER.length - 1);
}

/**
 * Walks gate-map-update Events to build a timeline of gate->tool mappings,
 * so a later Swap's Tool can be resolved back to a physical Gate.
 * @param {LogEvent[]} events
 * @returns {{ eventIndex: number, toolsByGate: string[] }[]}
 */
export function deriveGateToolMapTimeline(events) {
  /** @type {{ eventIndex: number, toolsByGate: string[] }[]} */
  const timeline = [];
  for (const event of events) {
    if (event.category !== 'gate-map-update') continue;
    const parsed = parseGateMapBlock(event.raw);
    if (parsed) timeline.push({ eventIndex: event.index, toolsByGate: parsed.toolsByGate });
  }
  return timeline;
}

/**
 * Counts how many Swaps used each physical Gate, by resolving each Swap's
 * Tool against the most recent gate-map-update Event before it. Also tracks
 * the last such Swap's Event index per Gate, so a "gate usage" chart bar can
 * jump somewhere concrete when clicked.
 * @param {LogEvent[]} events
 * @returns {{ gate: number, count: number, lastEventIndex: number }[]}
 */
export function deriveGateUsage(events) {
  const timeline = deriveGateToolMapTimeline(events);
  /** @type {Map<number, { count: number, lastEventIndex: number }>} */
  const usage = new Map();

  for (const event of events) {
    if (event.category !== 'swap' || !event.fields.toTool) continue;
    const mapping = findLast(timeline, (entry) => entry.eventIndex < event.index);
    if (!mapping) continue;
    const gate = mapping.toolsByGate.indexOf(event.fields.toTool);
    if (gate === -1) continue;
    const entry = usage.get(gate) ?? { count: 0, lastEventIndex: event.index };
    entry.count += 1;
    entry.lastEventIndex = event.index;
    usage.set(gate, entry);
  }

  return [...usage.entries()].map(([gate, v]) => ({ gate, ...v })).sort((a, b) => a.gate - b.gate);
}

/**
 * The most recent Gate Statistics snapshot in the log (later reports
 * supersede earlier ones as the picture of gate reliability).
 * @param {LogEvent[]} events
 * @returns {{ gate: number, symbol: string, score: number | null }[] | null}
 */
export function deriveGateReliability(events) {
  const latestEvent = findLast(events, (e) => e.category === 'mmu-stats-report' && e.fields.gateStatistics != null);
  if (!latestEvent) return null;
  return latestEvent.fields.gateStatistics.map((/** @type {{gate: number, symbol: string}} */ g) => ({
    ...g,
    score: gateQualityScore(g.symbol),
  }));
}

/**
 * Swap timing trend: one point per MMU Statistics Report, with that report's
 * "last" swap duration columns (positionally -- Happy Hare's column layout is
 * commonly [unload, load, load-post, complete] but this doesn't assume an
 * exact count so a differently-shaped table still degrades gracefully).
 * @param {LogEvent[]} events
 * @returns {{ eventIndex: number, timeRaw: string, durationsSeconds: (number|null)[] }[]}
 */
export function deriveSwapTimingSeries(events) {
  return events
    .filter((e) => e.category === 'mmu-stats-report' && e.fields.lastSwapDurationsSeconds)
    .map((e) => ({ eventIndex: e.index, timeRaw: e.time.raw, durationsSeconds: e.fields.lastSwapDurationsSeconds }));
}

/**
 * Commanded (gear/filament) vs encoder-measured movement for every Swap that
 * reports both, so slippage trends are visible even without an explicit
 * Warning being raised.
 * @param {LogEvent[]} events
 * @returns {{ eventIndex: number, timeRaw: string, direction: string, filamentMm: number, encoderMm: number, deltaMm: number }[]}
 */
export function deriveSlippageSeries(events) {
  return events
    .filter((e) => e.category === 'swap' && e.fields.filamentMm != null && e.fields.encoderMm != null)
    .map((e) => ({
      eventIndex: e.index,
      timeRaw: e.time.raw,
      direction: e.fields.direction,
      filamentMm: e.fields.filamentMm,
      encoderMm: e.fields.encoderMm,
      deltaMm: e.fields.filamentMm - e.fields.encoderMm,
    }));
}

/**
 * Error/Pause event counts per detected Session (pre/post-session events are
 * not attributed to any session and are not counted here). Also reports the
 * first such Event's index per Session, so a "pause frequency" chart bar can
 * jump somewhere concrete when clicked.
 * @param {ParsedLog} parsedLog
 * @returns {{ sessionLabel: string, count: number, firstEventIndex: number | null }[]}
 */
export function deriveErrorPauseCountsPerSession(parsedLog) {
  return parsedLog.sessions.map((session) => {
    let count = 0;
    /** @type {number | null} */
    let firstEventIndex = null;
    for (let i = session.startEventIndex; i <= session.endEventIndex; i++) {
      if (parsedLog.events[i].category === 'error-pause') {
        count++;
        if (firstEventIndex === null) firstEventIndex = i;
      }
    }
    return { sessionLabel: session.label, count, firstEventIndex };
  });
}

/**
 * Parses a full gate-map-update Event's raw block (the `Gate :`/`Tools:`/
 * `Avail:`/`Selct:` ascii art) into structured per-gate data.
 * @param {string} raw
 * @returns {{ toolsByGate: string[], availByGate: string[], selectedTool: string | null } | null}
 */
export function parseGateMapBlock(raw) {
  const toolsMatch = raw.match(/Tools:\s*(\|.*\|)/);
  if (!toolsMatch) return null;
  const toolsByGate = toolsMatch[1].split('|').slice(1, -1).map((c) => c.trim());

  const availMatch = raw.match(/Avail:\s*(\|.*\|)/);
  const availByGate = availMatch
    ? availMatch[1].split('|').slice(1, -1).map((c) => c.trim())
    : toolsByGate.map(() => '');

  const selctLine = raw.split('\n').find((line) => line.includes('Selct:'));
  const toolMatches = selctLine?.match(/T\d+/g);
  const selectedTool = toolMatches && toolMatches.length > 0 ? toolMatches[toolMatches.length - 1] : null;

  return { toolsByGate, availByGate, selectedTool };
}

/**
 * The most recent Gate/TTG map snapshot in scope. "Live" here means it
 * always reflects the latest state seen so far in the current scope (whole
 * file or a selected Session) -- not a full time-scrubbing view.
 * @param {LogEvent[]} events
 * @returns {{ toolsByGate: string[], availByGate: string[], selectedTool: string | null } | null}
 */
export function deriveLatestGateMapSnapshot(events) {
  const latestEvent = findLast(events, (e) => e.category === 'gate-map-update' && parseGateMapBlock(e.raw) != null);
  return latestEvent ? parseGateMapBlock(latestEvent.raw) : null;
}

/**
 * Marker-worthy Events for the Session Timeline: Swaps (excluding the noisy
 * per-tick progress-bar Events, keeping only their request/success Events),
 * Warnings, Errors/Pauses, and Job State Changes.
 * @param {LogEvent[]} events
 * @returns {{ eventIndex: number, timeRaw: string, absoluteSeconds: number, category: Category }[]}
 */
export function deriveTimelineMarkers(events) {
  return events
    .filter((e) => {
      if (e.category === 'warning' || e.category === 'error-pause' || e.category === 'job-state-change') return true;
      if (e.category === 'swap') return e.fields.filamentMm != null || e.fields.toTool != null;
      return false;
    })
    .map((e) => ({
      eventIndex: e.index,
      timeRaw: e.time.raw,
      absoluteSeconds: e.time.absoluteSeconds,
      category: e.category,
    }));
}

/**
 * Distinct Job States seen and how many times each transition occurred, for
 * the Job State Diagram.
 * @param {LogEvent[]} events
 * @returns {{ states: string[], transitions: { from: string, to: string, count: number }[] }}
 */
export function deriveJobStateGraph(events) {
  /** @type {Set<string>} */
  const states = new Set();
  /** @type {Map<string, number>} */
  const transitionCounts = new Map();

  for (const event of events) {
    if (event.category !== 'job-state-change') continue;
    states.add(event.fields.from);
    states.add(event.fields.to);
    const key = `${event.fields.from}->${event.fields.to}`;
    transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
  }

  const transitions = [...transitionCounts.entries()].map(([key, count]) => {
    const [from, to] = key.split('->');
    return { from, to, count };
  });

  return { states: [...states], transitions };
}

/**
 * Cumulative count and configured limit (if seen) per named wear counter.
 * Also tracks the last Event index per counter, so a "wear counter" chart
 * bar can jump somewhere concrete when clicked.
 * @param {LogEvent[]} events
 * @returns {{ counter: string, count: number, limit: number | null, lastEventIndex: number }[]}
 */
export function deriveWearCounterSummary(events) {
  /** @type {Map<string, { count: number, limit: number | null, lastEventIndex: number }>} */
  const byCounter = new Map();

  for (const event of events) {
    if (event.category !== 'wear-counter' || !event.fields.counter) continue;
    const entry = byCounter.get(event.fields.counter) ?? { count: 0, limit: null, lastEventIndex: event.index };
    const argsParsed = event.fields.argsParsed ?? {};
    if ('INCR' in argsParsed) {
      entry.count += Number(argsParsed.INCR) || 0;
    }
    if ('LIMIT' in argsParsed) {
      entry.limit = Number(argsParsed.LIMIT);
    }
    entry.lastEventIndex = event.index;
    byCounter.set(event.fields.counter, entry);
  }

  return [...byCounter.entries()].map(([counter, v]) => ({ counter, ...v }));
}
