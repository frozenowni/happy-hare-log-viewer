import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseLog } from '../js/parseLog.js';
import {
  gateQualityScore,
  deriveGateToolMapTimeline,
  deriveGateUsage,
  deriveGateReliability,
  deriveSwapTimingSeries,
  deriveSlippageSeries,
  deriveErrorPauseCountsPerSession,
  deriveWearCounterSummary,
  parseGateMapBlock,
  deriveLatestGateMapSnapshot,
  deriveTimelineMarkers,
  deriveJobStateGraph,
} from '../js/metrics.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
function loadFixture(name) {
  return readFileSync(path.join(fixturesDir, name), 'utf8');
}

const realSample = parseLog(loadFixture('real-sample.log'));

test('gateQualityScore ranks best emoji above worst, and n/a as null', () => {
  assert.equal(gateQualityScore('😎'), 1);
  assert.ok(gateQualityScore('😢') < gateQualityScore('😎'));
  assert.equal(gateQualityScore('—'), null);
});

test('deriveGateToolMapTimeline parses the Tools row into a gate-indexed array', () => {
  const timeline = deriveGateToolMapTimeline(realSample.events);
  assert.ok(timeline.length > 0);
  assert.deepEqual(timeline[0].toolsByGate.slice(0, 4), ['T0', 'T1', 'T2', 'T3']);
});

test('deriveGateUsage resolves the first Swap (toTool T3) to gate 3 via the preceding TTG map', () => {
  const usage = deriveGateUsage(realSample.events);
  const gate3 = usage.find((u) => u.gate === 3);
  assert.ok(gate3, 'expected gate 3 to have recorded usage');
  assert.ok(gate3.count >= 1);
  for (const u of usage) {
    assert.ok(u.gate >= 0 && u.gate <= 8);
    assert.ok(u.count > 0);
    assert.equal(realSample.events[u.lastEventIndex].category, 'swap');
  }
});

test('deriveGateReliability returns the LAST Gate Statistics snapshot, not the first', () => {
  const reliability = deriveGateReliability(realSample.events);
  assert.ok(reliability);
  assert.equal(reliability.length, 9);
  // The final MMU Statistics block in real-sample.log shows gate 1 as 😱
  // (worse than the 😎 it showed in the first two reports).
  const gate1 = reliability.find((g) => g.gate === 1);
  assert.equal(gate1.symbol, '😱');
});

test('deriveSwapTimingSeries pulls the "last" row durations from each MMU Statistics Report', () => {
  const series = deriveSwapTimingSeries(realSample.events);
  assert.equal(series.length, 3);
  assert.deepEqual(series[0].durationsSeconds, [null, 68, 40.9, 68]);
});

test('deriveSlippageSeries computes delta between commanded and encoder-measured mm', () => {
  const series = deriveSlippageSeries(realSample.events);
  assert.ok(series.length >= 5);
  const firstLoad = series.find((s) => s.timeRaw === '11:37:50');
  assert.ok(firstLoad);
  assert.equal(firstLoad.filamentMm, 810.4);
  assert.equal(firstLoad.encoderMm, 799.6);
  assert.ok(Math.abs(firstLoad.deltaMm - 10.8) < 1e-9);
});

test('deriveErrorPauseCountsPerSession accounts for every session-attributed error-pause event exactly once', () => {
  const perSession = deriveErrorPauseCountsPerSession(realSample);
  assert.equal(perSession.length, 3);
  const totalAttributed = realSample.events.filter(
    (e) => e.category === 'error-pause' && e.sessionIndex !== null,
  ).length;
  const totalCounted = perSession.reduce((sum, s) => sum + s.count, 0);
  assert.equal(totalCounted, totalAttributed);
  // Session 2 contains the real pause/error incident in the fixture.
  assert.ok(perSession[1].count > 0);
  assert.equal(realSample.events[perSession[1].firstEventIndex].category, 'error-pause');
  for (const s of perSession) {
    assert.equal(s.count === 0, s.firstEventIndex === null);
  }
});

test('parseGateMapBlock extracts tools, availability, and the selected tool', () => {
  const gateMapEvent = realSample.events.find((e) => /^Gate : \|/.test(e.message));
  const parsed = parseGateMapBlock(gateMapEvent.raw);
  assert.ok(parsed);
  assert.equal(parsed.toolsByGate[1], 'T1');
  assert.equal(parsed.availByGate[0], 'B');
  assert.equal(parsed.selectedTool, 'T1');
});

test('deriveLatestGateMapSnapshot reflects the LAST gate map seen, not the first', () => {
  const endlessSpool = parseLog(loadFixture('endless-spool-remap.log'));
  const snapshot = deriveLatestGateMapSnapshot(endlessSpool.events);
  assert.ok(snapshot);
  // After the remap, gate 2 is vacated and gate 5 now holds T2.
  assert.equal(snapshot.toolsByGate[2], '');
  assert.equal(snapshot.toolsByGate[5], 'T2');
  assert.equal(snapshot.selectedTool, 'T2');
});

test('deriveTimelineMarkers excludes noisy per-tick progress-bar events but keeps swap requests/successes', () => {
  const markers = deriveTimelineMarkers(realSample.events);
  assert.ok(markers.every((m) => m.category !== 'command-echo'));
  const hasLoadSuccess = markers.some((m) => realSample.events[m.eventIndex].message.startsWith('Load of 810.4mm'));
  assert.ok(hasLoadSuccess);
  const progressTicks = markers.filter((m) => /^\[T\d+\]/.test(realSample.events[m.eventIndex].message));
  assert.equal(progressTicks.length, 0);
});

test('deriveJobStateGraph counts every observed transition, including COMPLETE -> STARTED reprints', () => {
  const graph = deriveJobStateGraph(realSample.events);
  assert.ok(graph.states.includes('PRINTING'));
  assert.ok(graph.states.includes('CANCELLED'));
  const completeToStarted = graph.transitions.find((t) => t.from === 'COMPLETE' && t.to === 'STARTED');
  assert.ok(completeToStarted);
  assert.equal(completeToStarted.count, 1);
});

test('deriveWearCounterSummary accumulates INCR counts and captures the LIMIT', () => {
  const summary = deriveWearCounterSummary(realSample.events);
  const servoDown = summary.find((s) => s.counter === 'servo_down');
  const cutterBlade = summary.find((s) => s.counter === 'cutter_blade');
  assert.equal(servoDown.count, 11);
  assert.equal(servoDown.limit, 5000);
  assert.equal(cutterBlade.count, 3);
  assert.equal(cutterBlade.limit, 3000);
  assert.equal(realSample.events[servoDown.lastEventIndex].fields.counter, 'servo_down');
});
