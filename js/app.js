import { parseLog } from './parseLog.js';
import { PREDEFINED_SEARCHES } from './categories.js';
import { buildRawLineIndex, createRawView, compileSearchQuery } from './rawview.js';
import { renderAllCharts } from './charts.js';
import { renderGateMap, renderSessionTimeline, renderJobStateDiagram } from './diagrams.js';

const dropZone = /** @type {HTMLElement} */ (document.getElementById('drop-zone'));
const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const loadError = /** @type {HTMLElement} */ (document.getElementById('load-error'));
const viewer = /** @type {HTMLElement} */ (document.getElementById('viewer'));
const sessionPicker = /** @type {HTMLSelectElement} */ (document.getElementById('session-picker'));
const fileSummary = /** @type {HTMLElement} */ (document.getElementById('file-summary'));
const loadAnotherButton = /** @type {HTMLElement} */ (document.getElementById('load-another'));
const predefinedSearchesEl = /** @type {HTMLElement} */ (document.getElementById('predefined-searches'));
const freeTextSearchInput = /** @type {HTMLInputElement} */ (document.getElementById('free-text-search'));
const clearSearchButton = /** @type {HTMLElement} */ (document.getElementById('clear-search'));
const rawViewContainer = /** @type {HTMLElement} */ (document.getElementById('raw-view'));
const gateMapContainer = /** @type {HTMLElement} */ (document.getElementById('gate-map'));
const jobStateContainer = /** @type {HTMLElement} */ (document.getElementById('job-state-diagram'));
const timelineContainer = /** @type {HTMLElement} */ (document.getElementById('session-timeline'));

/** @type {import('./parseLog.js').ParsedLog | null} */
let parsedLog = null;
/** @type {string} */
let rawText = '';
/** @type {number | null} */
let currentSessionIndex = null;
/** @type {string | null} */
let activePredefinedSearchId = null;

const rawView = createRawView(rawViewContainer);

// --- File loading ------------------------------------------------------------

async function handleFile(/** @type {File} */ file) {
  loadError.hidden = true;
  try {
    rawText = await file.text();
    parsedLog = parseLog(rawText);
  } catch (err) {
    loadError.hidden = false;
    loadError.textContent = `Could not read that file: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }

  currentSessionIndex = null;
  activePredefinedSearchId = null;
  freeTextSearchInput.value = '';

  populateSessionPicker();
  fileSummary.textContent = `${file.name} — ${parsedLog.events.length} events, ${parsedLog.sessions.length} session(s) detected`;

  dropZone.hidden = true;
  viewer.hidden = false;

  renderScope();
}

function populateSessionPicker() {
  if (!parsedLog) return;
  sessionPicker.textContent = '';
  const wholeFileOption = document.createElement('option');
  wholeFileOption.value = '';
  wholeFileOption.textContent = 'Whole file';
  sessionPicker.appendChild(wholeFileOption);
  parsedLog.sessions.forEach((session, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = session.label;
    sessionPicker.appendChild(option);
  });
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

loadAnotherButton.addEventListener('click', () => {
  parsedLog = null;
  rawText = '';
  fileInput.value = '';
  viewer.hidden = true;
  dropZone.hidden = false;
});

// --- Scope (session picker) ---------------------------------------------------

sessionPicker.addEventListener('change', () => {
  currentSessionIndex = sessionPicker.value === '' ? null : Number(sessionPicker.value);
  renderScope();
});

/**
 * @returns {import('./parseLog.js').LogEvent[]}
 */
function scopedEvents() {
  if (!parsedLog) return [];
  if (currentSessionIndex === null) return parsedLog.events;
  return parsedLog.events.filter((e) => e.sessionIndex === currentSessionIndex);
}

function renderScope() {
  if (!parsedLog) return;
  const events = scopedEvents();

  renderAllCharts(events, parsedLog, jumpToEvent);
  renderGateMap(gateMapContainer, events, jumpToEvent);
  renderJobStateDiagram(jobStateContainer, events, jumpToEvent);
  renderSessionTimeline(timelineContainer, events, jumpToEvent);

  renderRawView();
}

// --- Raw view + search --------------------------------------------------------

function renderRawView() {
  if (!parsedLog) return;
  const allLines = buildRawLineIndex(rawText, parsedLog.events);
  const events = scopedEvents();
  const lines =
    currentSessionIndex === null
      ? allLines
      : allLines.filter((line) => events.some((e) => e.index === line.eventIndex));
  rawView.setLines(lines);
  applySearch();
}

function applySearch() {
  const log = parsedLog;
  if (activePredefinedSearchId && log) {
    const search = PREDEFINED_SEARCHES.find((s) => s.id === activePredefinedSearchId);
    if (search) {
      rawView.setMatchPredicate((line) => search.matches(log.events[line.eventIndex]));
      return;
    }
  }
  const predicate = compileSearchQuery(freeTextSearchInput.value);
  rawView.setMatchPredicate(predicate);
}

function renderPredefinedSearchButtons() {
  predefinedSearchesEl.textContent = '';
  for (const search of PREDEFINED_SEARCHES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = search.label;
    button.addEventListener('click', () => {
      activePredefinedSearchId = activePredefinedSearchId === search.id ? null : search.id;
      freeTextSearchInput.value = '';
      renderPredefinedSearchButtons();
      applySearch();
    });
    if (search.id === activePredefinedSearchId) button.classList.add('active');
    predefinedSearchesEl.appendChild(button);
  }
}
renderPredefinedSearchButtons();

freeTextSearchInput.addEventListener('input', () => {
  activePredefinedSearchId = null;
  renderPredefinedSearchButtons();
  applySearch();
});

clearSearchButton.addEventListener('click', () => {
  activePredefinedSearchId = null;
  freeTextSearchInput.value = '';
  renderPredefinedSearchButtons();
  applySearch();
});

// --- Cross-view jump -----------------------------------------------------------

/** @param {number} eventIndex */
function jumpToEvent(eventIndex) {
  if (!parsedLog) return;
  activateTab('raw');
  const event = parsedLog.events[eventIndex];
  rawView.jumpToLine(event.startLine);
}

// --- Tabs ------------------------------------------------------------------

/** @param {string} tabName */
function activateTab(tabName) {
  for (const tab of document.querySelectorAll('.tab')) {
    const isActive = tab.getAttribute('data-tab') === tabName;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.toggleAttribute('hidden', panel.id !== `tab-${tabName}`);
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => activateTab(/** @type {string} */ (tab.getAttribute('data-tab'))));
}
