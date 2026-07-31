import { CATEGORY_STYLE } from './categories.js';

/**
 * @typedef {Object} RawLineInfo
 * @property {number} lineNumber - 1-based.
 * @property {string} text
 * @property {number} eventIndex
 * @property {import('./categories.js').Category} category
 */

const ROW_HEIGHT = 20; // px; must match the fixed row height used below.

/**
 * Builds a per-physical-line index across the whole file, tagging every line
 * (including Continuation Lines) with the Category of its owning Event, so
 * the raw viewer can color-code and search without re-parsing.
 * @param {string} rawText
 * @param {import('./parseLog.js').LogEvent[]} events
 * @returns {RawLineInfo[]}
 */
export function buildRawLineIndex(rawText, events) {
  const allLines = rawText.split(/\r\n|\n/);
  /** @type {RawLineInfo[]} */
  const lines = [];
  for (const event of events) {
    for (let lineNumber = event.startLine; lineNumber <= event.endLine; lineNumber++) {
      const text = allLines[lineNumber - 1] ?? '';
      lines.push({ lineNumber, text, eventIndex: event.index, category: event.category });
    }
  }
  lines.sort((a, b) => a.lineNumber - b.lineNumber);
  return lines;
}

/**
 * Creates a virtualized (windowed) raw-log viewer inside `container`. Only
 * rows near the current scroll position are ever in the DOM, so even a very
 * large log stays smooth to scroll.
 * @param {HTMLElement} container
 */
export function createRawView(container) {
  /** @type {RawLineInfo[]} */
  let lines = [];
  /** @type {((line: RawLineInfo) => boolean) | null} */
  let matchPredicate = null;
  /** @type {number | null} */
  let jumpTargetLine = null;

  container.innerHTML = '';
  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  const content = document.createElement('div');
  content.style.position = 'absolute';
  content.style.left = '0';
  content.style.right = '0';
  content.style.top = '0';
  spacer.appendChild(content);
  container.appendChild(spacer);

  function render() {
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight || 600;
    const total = lines.length;
    spacer.style.height = `${total * ROW_HEIGHT}px`;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 15);
    const last = Math.min(total, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + 15);
    content.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    content.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const line = lines[i];
      const row = document.createElement('div');
      row.className = 'raw-line';
      row.style.height = `${ROW_HEIGHT}px`;
      row.style.borderLeftColor = CATEGORY_STYLE[line.category]?.color ?? '#9e9e9e';
      row.dataset.eventIndex = String(line.eventIndex);
      if (matchPredicate) {
        row.classList.add(matchPredicate(line) ? 'match' : 'dim');
      }
      if (jumpTargetLine === line.lineNumber) {
        row.classList.add('jump-target');
      }
      const ln = document.createElement('span');
      ln.className = 'ln';
      ln.textContent = String(line.lineNumber);
      const txt = document.createElement('span');
      txt.textContent = line.text;
      row.append(ln, txt);
      frag.appendChild(row);
    }
    content.appendChild(frag);
  }

  container.addEventListener('scroll', render);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(render).observe(container);
  }

  return {
    /** @param {RawLineInfo[]} newLines */
    setLines(newLines) {
      lines = newLines;
      jumpTargetLine = null;
      container.scrollTop = 0;
      render();
    },
    /** @param {((line: RawLineInfo) => boolean) | null} predicate */
    setMatchPredicate(predicate) {
      matchPredicate = predicate;
      render();
    },
    /** @param {number} lineNumber */
    jumpToLine(lineNumber) {
      const idx = lines.findIndex((l) => l.lineNumber === lineNumber);
      if (idx === -1) return;
      jumpTargetLine = lineNumber;
      container.scrollTop = Math.max(0, idx * ROW_HEIGHT - container.clientHeight / 2);
      render();
    },
  };
}

/**
 * Parses the free-text search box's value into a match predicate. A value
 * wrapped in `/…/` (optionally with flags, e.g. `/foo/i`) is treated as a
 * regex; anything else is a case-insensitive plain-text substring match. An
 * invalid regex falls back to plain-text matching on the literal input
 * rather than throwing, since this is user-typed input, not a bug report.
 * @param {string} query
 * @returns {((line: RawLineInfo) => boolean) | null}
 */
export function compileSearchQuery(query) {
  const trimmed = query.trim();
  if (trimmed === '') return null;

  const regexForm = trimmed.match(/^\/(.*)\/([a-z]*)$/);
  if (regexForm) {
    try {
      const re = new RegExp(regexForm[1], regexForm[2].includes('i') ? regexForm[2] : `${regexForm[2]}i`);
      return (line) => re.test(line.text);
    } catch {
      // fall through to plain-text match on the literal input
    }
  }

  const needle = trimmed.toLowerCase();
  return (line) => line.text.toLowerCase().includes(needle);
}
