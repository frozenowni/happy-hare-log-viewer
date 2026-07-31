import {
  deriveGateUsage,
  deriveGateReliability,
  deriveSwapTimingSeries,
  deriveSlippageSeries,
  deriveErrorPauseCountsPerSession,
  deriveWearCounterSummary,
} from './metrics.js';

const SWAP_COLUMN_LABELS = ['Unload', 'Load', 'Load (post)', 'Complete'];
const SERIES_COLORS = ['#5b8def', '#2e7d32', '#e6a700', '#d32f2f', '#6a5acd'];

/** @type {any} */
// eslint-disable-next-line no-undef
const ChartJs = typeof globalThis !== 'undefined' ? /** @type {any} */ (globalThis).Chart : undefined;

/** @type {Map<string, any>} */
const chartInstances = new Map();

/**
 * @param {string} canvasId
 * @param {any} config
 */
function renderChart(canvasId, config) {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById(canvasId));
  if (!canvas || !ChartJs) return;
  const existing = chartInstances.get(canvasId);
  if (existing) existing.destroy();
  const chart = new ChartJs(canvas, config);
  chartInstances.set(canvasId, chart);
}

/**
 * Renders every dashboard chart from the currently-scoped Events/ParsedLog.
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {import('./parseLog.js').ParsedLog} parsedLog
 * @param {(eventIndex: number) => void} onJump
 */
export function renderAllCharts(events, parsedLog, onJump) {
  renderSwapTimingChart(events, onJump);
  renderGateReliabilityChart(events);
  renderSlippageChart(events, onJump);
  renderPauseFrequencyChart(parsedLog);
  renderWearCounterChart(events);
}

/**
 * @param {any} chart
 * @param {any[]} elements
 * @param {(index: number) => void} onIndexClick
 */
function onFirstPointClick(chart, elements, onIndexClick) {
  if (elements.length > 0) onIndexClick(elements[0].index);
}

/**
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {(eventIndex: number) => void} onJump
 */
function renderSwapTimingChart(events, onJump) {
  const series = deriveSwapTimingSeries(events);
  const columnCount = series.reduce((max, p) => Math.max(max, p.durationsSeconds.length), 0);
  renderChart('chart-swap-timing', {
    type: 'line',
    data: {
      labels: series.map((p) => p.timeRaw),
      datasets: Array.from({ length: columnCount }, (_, col) => ({
        label: SWAP_COLUMN_LABELS[col] ?? `Col ${col + 1}`,
        data: series.map((p) => p.durationsSeconds[col] ?? null),
        borderColor: SERIES_COLORS[col % SERIES_COLORS.length],
        spanGaps: true,
        tension: 0.2,
      })),
    },
    options: {
      responsive: true,
      scales: { y: { title: { display: true, text: 'seconds' } } },
      onClick: (/** @type {any} */ _evt, /** @type {any[]} */ elements, /** @type {any} */ chart) =>
        onFirstPointClick(chart, elements, (i) => onJump(series[i].eventIndex)),
    },
  });
}

/** @param {import('./parseLog.js').LogEvent[]} events */
function renderGateReliabilityChart(events) {
  const reliability = deriveGateReliability(events) ?? [];
  const usage = deriveGateUsage(events);
  const usageByGate = new Map(usage.map((u) => [u.gate, u.count]));

  renderChart('chart-gate-reliability', {
    type: 'bar',
    data: {
      labels: reliability.map((g) => `Gate ${g.gate}`),
      datasets: [
        {
          label: 'Reliability',
          data: reliability.map((g) => g.score),
          backgroundColor: '#5b8def',
          yAxisID: 'y',
        },
        {
          label: 'Swaps using this gate',
          data: reliability.map((g) => usageByGate.get(g.gate) ?? 0),
          backgroundColor: '#e6a700',
          yAxisID: 'y1',
          type: 'line',
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: { min: 0, max: 1, title: { display: true, text: 'reliability' } },
        y1: { position: 'right', title: { display: true, text: 'swap count' }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

/**
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {(eventIndex: number) => void} onJump
 */
function renderSlippageChart(events, onJump) {
  const series = deriveSlippageSeries(events);
  renderChart('chart-slippage', {
    type: 'line',
    data: {
      labels: series.map((p) => p.timeRaw),
      datasets: [
        { label: 'Commanded (mm)', data: series.map((p) => p.filamentMm), borderColor: SERIES_COLORS[0] },
        { label: 'Encoder-measured (mm)', data: series.map((p) => p.encoderMm), borderColor: SERIES_COLORS[3] },
      ],
    },
    options: {
      responsive: true,
      onClick: (/** @type {any} */ _evt, /** @type {any[]} */ elements, /** @type {any} */ chart) =>
        onFirstPointClick(chart, elements, (i) => onJump(series[i].eventIndex)),
    },
  });
}

/** @param {import('./parseLog.js').ParsedLog} parsedLog */
function renderPauseFrequencyChart(parsedLog) {
  const perSession = deriveErrorPauseCountsPerSession(parsedLog);
  renderChart('chart-pause-frequency', {
    type: 'bar',
    data: {
      labels: perSession.map((s) => s.sessionLabel),
      datasets: [{ label: 'Errors / Pauses', data: perSession.map((s) => s.count), backgroundColor: '#d32f2f' }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
}

/** @param {import('./parseLog.js').LogEvent[]} events */
function renderWearCounterChart(events) {
  const summary = deriveWearCounterSummary(events);
  renderChart('chart-wear-counters', {
    type: 'bar',
    data: {
      labels: summary.map((s) => s.counter),
      datasets: [
        { label: 'Count', data: summary.map((s) => s.count), backgroundColor: '#5b8def' },
        { label: 'Limit', data: summary.map((s) => s.limit), backgroundColor: '#d32f2f' },
      ],
    },
    options: { responsive: true },
  });
}
