import { deriveLatestGateMapSnapshot, deriveTimelineMarkers, deriveJobStateGraph } from './metrics.js';
import { CATEGORY_STYLE } from './categories.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @returns {SVGElement}
 */
function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * Renders the live Gate ↔ Tool map for the current scope (latest snapshot
 * seen so far, not a full time-scrubbing view -- see CONTEXT.md). Every gate
 * cell jumps to the raw line of the snapshot's source Event when clicked.
 * @param {HTMLElement} container
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {(eventIndex: number) => void} onJump
 */
export function renderGateMap(container, events, onJump) {
  container.textContent = '';
  const snapshot = deriveLatestGateMapSnapshot(events);
  if (!snapshot) {
    const empty = document.createElement('p');
    empty.textContent = 'No Gate/TTG map data in this scope yet.';
    container.appendChild(empty);
    return;
  }

  let sourceEventIndex = null;
  for (const event of events) {
    if (event.category === 'gate-map-update') sourceEventIndex = event.index;
  }

  const gateCount = snapshot.toolsByGate.length;
  const cellWidth = 64;
  const width = gateCount * cellWidth + 20;
  const height = 90;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'gate-map-svg', width: '100%', height });

  for (let gate = 0; gate < gateCount; gate++) {
    const x = 10 + gate * cellWidth;
    const tool = snapshot.toolsByGate[gate];
    const avail = snapshot.availByGate[gate];
    const isSelected = tool !== '' && tool === snapshot.selectedTool;

    const rect = el('rect', {
      x,
      y: 10,
      width: cellWidth - 8,
      height: 50,
      rx: 6,
      fill: isSelected ? '#5b8def' : 'none',
      stroke: '#8a8f98',
    });
    rect.style.cursor = 'pointer';
    if (sourceEventIndex !== null) {
      rect.addEventListener('click', () => onJump(/** @type {number} */ (sourceEventIndex)));
    }
    svg.appendChild(rect);

    const gateLabel = el('text', { x: x + (cellWidth - 8) / 2, y: 26, 'text-anchor': 'middle' });
    gateLabel.textContent = `Gate ${gate}`;
    gateLabel.setAttribute('fill', isSelected ? '#fff' : 'currentColor');
    svg.appendChild(gateLabel);

    const toolLabel = el('text', { x: x + (cellWidth - 8) / 2, y: 44, 'text-anchor': 'middle', 'font-weight': 'bold' });
    toolLabel.textContent = tool || '—';
    toolLabel.setAttribute('fill', isSelected ? '#fff' : 'currentColor');
    svg.appendChild(toolLabel);

    const availLabel = el('text', { x: x + (cellWidth - 8) / 2, y: 58, 'text-anchor': 'middle' });
    availLabel.textContent = avail || '';
    availLabel.setAttribute('fill', isSelected ? '#fff' : 'currentColor');
    svg.appendChild(availLabel);
  }

  container.appendChild(svg);
}

/**
 * Renders the Session Timeline: a horizontal strip of clickable markers for
 * Swaps, Warnings, Errors/Pauses, and Job State Changes.
 * @param {HTMLElement} container
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {(eventIndex: number) => void} onMarkerClick
 */
export function renderSessionTimeline(container, events, onMarkerClick) {
  container.textContent = '';
  const markers = deriveTimelineMarkers(events);
  if (markers.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No timeline events in this scope yet.';
    container.appendChild(empty);
    return;
  }

  const minTime = markers[0].absoluteSeconds;
  const maxTime = markers[markers.length - 1].absoluteSeconds;
  const span = Math.max(1, maxTime - minTime);
  const width = 900;
  const height = 70;
  const margin = 20;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'timeline-svg', width: '100%', height });
  svg.appendChild(el('line', { x1: margin, y1: 35, x2: width - margin, y2: 35, stroke: '#8a8f98' }));

  for (const marker of markers) {
    const x = margin + ((marker.absoluteSeconds - minTime) / span) * (width - margin * 2);
    const color = CATEGORY_STYLE[marker.category]?.color ?? '#9e9e9e';
    const circle = el('circle', { cx: x, cy: 35, r: 6, fill: color, class: 'marker' });
    circle.addEventListener('click', () => onMarkerClick(marker.eventIndex));
    const title = el('title', {});
    title.textContent = `${marker.timeRaw} — ${CATEGORY_STYLE[marker.category]?.label ?? marker.category}`;
    circle.appendChild(title);
    svg.appendChild(circle);
  }

  const startLabel = el('text', { x: margin, y: 60 });
  startLabel.textContent = markers[0].timeRaw;
  const endLabel = el('text', { x: width - margin, y: 60, 'text-anchor': 'end' });
  endLabel.textContent = markers[markers.length - 1].timeRaw;
  svg.append(startLabel, endLabel);

  container.appendChild(svg);
}

/**
 * Renders the Job State machine diagram: nodes for each observed state, with
 * labeled arrows for each observed transition and its occurrence count.
 * @param {HTMLElement} container
 * @param {import('./parseLog.js').LogEvent[]} events
 * @param {(eventIndex: number) => void} onJump
 */
export function renderJobStateDiagram(container, events, onJump) {
  container.textContent = '';
  const graph = deriveJobStateGraph(events);
  if (graph.states.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No Job State transitions in this scope yet.';
    container.appendChild(empty);
    return;
  }

  const width = 640;
  const nodeRadius = 42;
  const height = Math.ceil(graph.states.length / 3) * 110 + 60;
  const cols = Math.min(3, graph.states.length);

  /** @type {Map<string, { x: number, y: number }>} */
  const positions = new Map();
  graph.states.forEach((state, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    positions.set(state, { x: 100 + col * 220, y: 70 + row * 110 });
  });

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, class: 'job-state-svg', width: '100%', height });

  svg.appendChild(
    el('marker', {
      id: 'arrowhead',
      markerWidth: 8,
      markerHeight: 8,
      refX: 7,
      refY: 4,
      orient: 'auto',
    }),
  );
  const markerEl = svg.querySelector('marker');
  if (markerEl) markerEl.appendChild(el('path', { d: 'M0,0 L8,4 L0,8 Z', fill: '#8a8f98' }));

  for (const transition of graph.transitions) {
    const from = positions.get(transition.from);
    const to = positions.get(transition.to);
    if (!from || !to) continue;
    if (transition.from === transition.to) continue; // self-loops not drawn in v1
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const x1 = from.x + (dx / dist) * nodeRadius;
    const y1 = from.y + (dy / dist) * nodeRadius;
    const x2 = to.x - (dx / dist) * nodeRadius;
    const y2 = to.y - (dy / dist) * nodeRadius;
    const line = el('line', { x1, y1, x2, y2, stroke: '#8a8f98', 'marker-end': 'url(#arrowhead)' });
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => {
      let lastMatch = null;
      for (const event of events) {
        if (event.category === 'job-state-change' && event.fields.from === transition.from && event.fields.to === transition.to) {
          lastMatch = event.index;
        }
      }
      if (lastMatch !== null) onJump(lastMatch);
    });
    svg.appendChild(line);
    const label = el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, 'text-anchor': 'middle', class: 'transition-count' });
    label.textContent = `×${transition.count}`;
    svg.appendChild(label);
  }

  for (const state of graph.states) {
    const pos = positions.get(state);
    if (!pos) continue;
    svg.appendChild(el('circle', { cx: pos.x, cy: pos.y, r: nodeRadius, fill: 'none', stroke: '#5b8def', 'stroke-width': 2 }));
    const label = el('text', { x: pos.x, y: pos.y + 4, 'text-anchor': 'middle' });
    label.textContent = state;
    svg.appendChild(label);
  }

  container.appendChild(svg);
}
