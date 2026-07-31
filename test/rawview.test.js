import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseLog } from '../js/parseLog.js';
import { buildRawLineIndex, compileSearchQuery } from '../js/rawview.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const rawText = readFileSync(path.join(fixturesDir, 'real-sample.log'), 'utf8');

test('buildRawLineIndex covers every physical line exactly once, in order', () => {
  const { events } = parseLog(rawText);
  const totalLines = rawText.split(/\r\n|\n/).length;
  const lines = buildRawLineIndex(rawText, events);
  assert.equal(lines.length, totalLines);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(lines[i].lineNumber, i + 1);
  }
});

test('buildRawLineIndex tags continuation lines with the owning event category', () => {
  const { events } = parseLog(rawText);
  const lines = buildRawLineIndex(rawText, events);
  const toolsRow = lines.find((l) => l.text.trim().startsWith('Tools:'));
  assert.ok(toolsRow);
  assert.equal(toolsRow.category, 'gate-map-update');
});

test('compileSearchQuery does plain-text case-insensitive matching by default', () => {
  const predicate = compileSearchQuery('SERVO_DOWN');
  assert.ok(predicate);
  assert.equal(predicate({ text: '> MMU_STATS COUNTER=servo_down INCR=1' }), true);
  assert.equal(predicate({ text: 'no match here' }), false);
});

test('compileSearchQuery treats /…/ as a regex', () => {
  const predicate = compileSearchQuery('/Load of \\d+/');
  assert.ok(predicate);
  assert.equal(predicate({ text: 'Load of 810.4mm filament successful' }), true);
  assert.equal(predicate({ text: 'Unload of -821.6mm filament successful' }), false);
});

test('compileSearchQuery falls back to plain-text on an invalid regex rather than throwing', () => {
  const predicate = compileSearchQuery('/(unclosed/');
  assert.ok(predicate);
  assert.doesNotThrow(() => predicate({ text: '(unclosed' }));
});

test('compileSearchQuery returns null for an empty query', () => {
  assert.equal(compileSearchQuery('   '), null);
});
