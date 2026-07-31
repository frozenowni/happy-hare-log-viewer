import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseLog } from '../js/parseLog.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name) {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

function findEvent(events, predicate) {
  const found = events.find(predicate);
  assert.ok(found, 'expected to find a matching event but found none');
  return found;
}

// --- Basic structure -------------------------------------------------------

test('parseLog returns events and sessions arrays', () => {
  const { events, sessions } = parseLog(loadFixture('no-stats-block.log'));
  assert.ok(Array.isArray(events));
  assert.ok(Array.isArray(sessions));
  assert.ok(events.length > 0);
});

test('never throws on unrecognized content and preserves it as Uncategorized', () => {
  const { events } = parseLog(loadFixture('all-uncategorized.log'));
  assert.equal(events.length, 5);
  for (const event of events) {
    assert.equal(event.category, 'uncategorized');
  }
  assert.match(events[0].message, /Zorbnak initialized the flibbertigibbet subsystem/);
});

test('does not drop lines with an unrecognized level tag', () => {
  const { events } = parseLog(loadFixture('all-uncategorized.log'));
  const withTag = findEvent(events, (e) => e.message.includes('FOOBAR'));
  assert.equal(withTag.category, 'uncategorized');
});

// --- Continuation-line association -----------------------------------------

test('groups continuation lines (gate map block) into the owning event, not separate events', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const gateMapEvents = events.filter((e) => /^Gate : \|/.test(e.message));
  assert.ok(gateMapEvents.length > 0);
  const first = gateMapEvents[0];
  assert.match(first.raw, /Tools:/);
  assert.match(first.raw, /Avail:/);
  assert.match(first.raw, /Selct:/);
  // The continuation rows must not appear as their own top-level events.
  assert.ok(!events.some((e) => /^Tools:/.test(e.message)));
});

test('groups MMU Statistics Report continuation block into one event', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const reportEvents = events.filter((e) => e.category === 'mmu-stats-report' && /^MMU Statistics:/.test(e.message));
  assert.equal(reportEvents.length, 3);
  for (const report of reportEvents) {
    assert.match(report.raw, /Gate Statistics:/);
    assert.match(report.raw, /spent paused/);
  }
});

test('assigns correct line ranges to a multi-line event', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const first = findEvent(events, (e) => /^Gate : \|/.test(e.message));
  assert.equal(first.startLine, 8);
  assert.equal(first.endLine, 12);
});

// --- Category classification -------------------------------------------------

test('classifies a bare command echo as command-echo', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const home = findEvent(events, (e) => e.message === '> MMU_HOME');
  assert.equal(home.category, 'command-echo');
});

test('classifies MMU_CHANGE_TOOL echo as tool-change-request', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const echo = findEvent(events, (e) => e.message.startsWith('> MMU_CHANGE_TOOL'));
  assert.equal(echo.category, 'tool-change-request');
});

test('classifies MMU_SELECT echo as gate-map-update', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const echo = findEvent(events, (e) => e.message.startsWith('> MMU_SELECT'));
  assert.equal(echo.category, 'gate-map-update');
});

test('classifies MMU_STATS COUNTER echo as wear-counter', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const echo = findEvent(events, (e) => e.message.startsWith('> MMU_STATS COUNTER=servo_down INCR=1'));
  assert.equal(echo.category, 'wear-counter');
  assert.equal(echo.fields.counter, 'servo_down');
});

test('classifies bare MMU_STATS echo as mmu-stats-report', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const echo = findEvent(events, (e) => e.message === '> MMU_STATS');
  assert.equal(echo.category, 'mmu-stats-report');
});

test('classifies PAUSE/RESUME/CLEAR_PAUSE/CANCEL_PRINT echoes as error-pause', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  for (const verb of ['> PAUSE', '> CLEAR_PAUSE', '> RESUME', '> CANCEL_PRINT']) {
    const echo = findEvent(events, (e) => e.message === verb);
    assert.equal(echo.category, 'error-pause', `expected ${verb} to be error-pause`);
  }
});

test('distinguishes a no-op Tool Change Request from a real Swap', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const noop = findEvent(events, (e) => e.message === 'Tool T3 is already loaded');
  assert.equal(noop.category, 'tool-change-request');

  const realSwap = findEvent(events, (e) => e.message.startsWith('Tool change requested: T3'));
  assert.equal(realSwap.category, 'swap');
});

test('parses Swap success lines with filament and encoder mm', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const load = findEvent(events, (e) => e.message.startsWith('Load of 810.4mm'));
  assert.equal(load.category, 'swap');
  assert.equal(load.fields.direction, 'load');
  assert.equal(load.fields.filamentMm, 810.4);
  assert.equal(load.fields.encoderMm, 799.6);

  const unload = findEvent(events, (e) => e.message.startsWith('Unload of -821.6mm'));
  assert.equal(unload.category, 'swap');
  assert.equal(unload.fields.direction, 'unload');
  assert.equal(unload.fields.filamentMm, -821.6);
  assert.equal(unload.fields.encoderMm, -847.5);
});

test('parses Job State transitions', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const transition = findEvent(events, (e) => e.message.includes('INITIALIZED -> STARTED') && e.startLine === 33);
  assert.equal(transition.category, 'job-state-change');
  assert.equal(transition.fields.from, 'INITIALIZED');
  assert.equal(transition.fields.to, 'STARTED');
});

test('parses a Warning with slippage measurements', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const warning = findEvent(events, (e) => e.message.startsWith('Warning: Excess slippage'));
  assert.equal(warning.category, 'warning');
  assert.equal(warning.fields.gearMm, 666.6);
  assert.equal(warning.fields.encoderMm, 552.5);
});

test('parses an Error/Pause event with its Reason continuation text', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const issue = findEvent(events, (e) => e.message.startsWith('MMU issue detected'));
  assert.equal(issue.category, 'error-pause');
  assert.match(issue.raw, /Reason: Load sequence failed/);
});

test('parses MMU Statistics Report fields including Gate Statistics', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  const report = findEvent(events, (e) => e.category === 'mmu-stats-report' && e.startLine === 108);
  assert.equal(report.fields.totalSwaps, 1519);
  assert.equal(report.fields.thisJobSwapNumber, 1);
  assert.ok(Array.isArray(report.fields.gateStatistics));
  assert.equal(report.fields.gateStatistics.length, 9);
  assert.deepEqual(report.fields.gateStatistics[0], { gate: 0, symbol: '😱' });
  assert.deepEqual(report.fields.gateStatistics[3], { gate: 3, symbol: '😎' });
});

// --- Spoolman fixture --------------------------------------------------------

test('classifies Spoolman-related events', () => {
  const { events } = parseLog(loadFixture('spoolman.log'));
  const assigned = findEvent(events, (e) => e.message.startsWith('Spool ID: 12'));
  assert.equal(assigned.category, 'spoolman');
  const echo = findEvent(events, (e) => e.message.startsWith('> MMU_SPOOLMAN'));
  assert.equal(echo.category, 'spoolman');
});

// --- EndlessSpool fixture ----------------------------------------------------

test('classifies EndlessSpool remap events and keeps its gate map block grouped', () => {
  const { events } = parseLog(loadFixture('endless-spool-remap.log'));
  const remap = findEvent(events, (e) => e.message.startsWith('Remapping T2 to gate 5'));
  assert.equal(remap.category, 'endless-spool-remap');
  const gateMap = findEvent(events, (e) => /^Gate : \|/.test(e.message));
  assert.equal(gateMap.category, 'gate-map-update');
  assert.match(gateMap.raw, /Selct:/);
});

// --- TRACE/STEPPER verbosity fixture -----------------------------------------

test('tolerates TRACE/STEPPER-tagged lines without losing surrounding events', () => {
  const { events } = parseLog(loadFixture('trace-stepper-verbosity.log'));
  assert.equal(events.length, 7);
  const enabled = findEvent(events, (e) => e.message === 'Tool T2 enabled');
  assert.equal(enabled.category, 'tool-change-request');
});

// --- Day-rollover handling ----------------------------------------------------

test('increments day offset only across a genuine midnight rollover', () => {
  const { events } = parseLog(loadFixture('day-rollover.log'));
  const beforeMidnight = findEvent(events, (e) => e.time.raw === '23:59:41');
  const afterMidnight = findEvent(events, (e) => e.time.raw === '00:00:05');
  assert.equal(beforeMidnight.time.dayOffset, 0);
  assert.equal(afterMidnight.time.dayOffset, 1);
  assert.ok(afterMidnight.time.absoluteSeconds > beforeMidnight.time.absoluteSeconds);
});

test('a non-midnight backward time jump does not shift the day offset', () => {
  // real-sample.log contains a genuine restart artifact: file order goes
  // ...11:49:06 then jumps back to 11:45:47 (an "MMU Startup" boot block)
  // before continuing forward again. This is NOT a midnight rollover and
  // must not push everything after it into "day 2".
  const { events } = parseLog(loadFixture('real-sample.log'));
  const beforeJump = findEvent(events, (e) => e.time.raw === '11:49:06' && e.startLine < 270);
  const bootLine = findEvent(events, (e) => e.time.raw === '11:45:47' && e.startLine > beforeJump.startLine);
  assert.equal(bootLine.time.dayOffset, 0);
  const lastEvent = events[events.length - 1];
  assert.equal(lastEvent.time.dayOffset, 0);
});

test('event array order always matches file order regardless of embedded clock anomalies', () => {
  const { events } = parseLog(loadFixture('real-sample.log'));
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].startLine > events[i - 1].startLine, `event ${i} out of file order`);
  }
});

// --- Session detection --------------------------------------------------------

test('detects sessions bounded by Job State transitions, ignoring pre-session setup', () => {
  const { events, sessions } = parseLog(loadFixture('real-sample.log'));
  assert.equal(sessions.length, 3);

  const session1 = sessions[0];
  assert.equal(events[session1.startEventIndex].time.raw, '11:33:04');
  assert.equal(events[session1.startEventIndex].fields.to, 'STARTED');

  const session3 = sessions[2];
  assert.equal(events[session3.endEventIndex].fields.to, 'COMPLETE');

  // Pre-session homing/setup events (MMU_HOME etc, before the first session)
  // are not attributed to any session.
  const homeEcho = findEvent(events, (e) => e.message === '> MMU_HOME');
  assert.equal(homeEcho.sessionIndex, null);
});

test('a session with no MMU_STATS block at all is still detected correctly', () => {
  const { sessions, events } = parseLog(loadFixture('no-stats-block.log'));
  assert.equal(sessions.length, 1);
  const session = sessions[0];
  assert.equal(events[session.startEventIndex].fields.to, 'STARTED');
  assert.equal(events[session.endEventIndex].fields.to, 'COMPLETE');
});

test('a session spanning a midnight rollover keeps correct chronological duration', () => {
  const { sessions, events } = parseLog(loadFixture('day-rollover.log'));
  assert.equal(sessions.length, 1);
  const session = sessions[0];
  const start = events[session.startEventIndex];
  const end = events[session.endEventIndex];
  assert.ok(end.time.absoluteSeconds > start.time.absoluteSeconds);
});
