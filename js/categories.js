/**
 * The fixed Category vocabulary for Events, per CONTEXT.md.
 * @typedef {'command-echo'|'tool-change-request'|'swap'|'gate-map-update'|'job-state-change'
 *   |'mmu-stats-report'|'wear-counter'|'warning'|'error-pause'|'endless-spool-remap'|'spoolman'
 *   |'sync'|'servo'|'espooler'|'uncategorized'} Category
 */

/** @type {Category[]} */
export const CATEGORIES = [
  'command-echo',
  'tool-change-request',
  'swap',
  'gate-map-update',
  'job-state-change',
  'mmu-stats-report',
  'wear-counter',
  'warning',
  'error-pause',
  'endless-spool-remap',
  'spoolman',
  'sync',
  'servo',
  'espooler',
  'uncategorized',
];

/**
 * Display label + color per Category, shared by the raw viewer, charts, and
 * diagrams so a category reads the same way everywhere in the app.
 * @type {Record<Category, { label: string, color: string }>}
 */
export const CATEGORY_STYLE = {
  'command-echo': { label: 'Command Echo', color: '#8a8f98' },
  'tool-change-request': { label: 'Tool Change Request', color: '#5b8def' },
  swap: { label: 'Swap', color: '#2e7d32' },
  'gate-map-update': { label: 'Gate/TTG Map', color: '#00897b' },
  'job-state-change': { label: 'Job State Change', color: '#6a5acd' },
  'mmu-stats-report': { label: 'MMU Statistics Report', color: '#8e6a00' },
  'wear-counter': { label: 'Wear Counter', color: '#b8860b' },
  warning: { label: 'Warning', color: '#e6a700' },
  'error-pause': { label: 'Error / Pause', color: '#d32f2f' },
  'endless-spool-remap': { label: 'EndlessSpool / Remap', color: '#0288d1' },
  spoolman: { label: 'Spoolman', color: '#ad1457' },
  sync: { label: 'Sync', color: '#607d8b' },
  servo: { label: 'Servo', color: '#607d8b' },
  espooler: { label: 'eSpooler', color: '#607d8b' },
  uncategorized: { label: 'Uncategorized', color: '#9e9e9e' },
};

/**
 * One-click Predefined Searches, per CONTEXT.md and the spec. Each maps to a
 * predicate over an Event rather than a 1:1 Category, since some searches
 * (e.g. Gate Statistics) pick out a facet of a Category shared with another
 * search (e.g. MMU Statistics Reports) rather than a disjoint Category.
 * @type {{id: string, label: string, matches: (event: import('./parseLog.js').LogEvent) => boolean}[]}
 */
export const PREDEFINED_SEARCHES = [
  {
    id: 'errors-pauses',
    label: 'Errors & Pauses',
    matches: (event) => event.category === 'error-pause',
  },
  {
    id: 'warnings',
    label: 'Warnings',
    matches: (event) => event.category === 'warning',
  },
  {
    id: 'tool-changes',
    label: 'Tool Changes',
    matches: (event) => event.category === 'tool-change-request' || event.category === 'swap',
  },
  {
    id: 'mmu-stats-reports',
    label: 'MMU Statistics Reports',
    matches: (event) => event.category === 'mmu-stats-report',
  },
  {
    id: 'gate-statistics',
    label: 'Gate Statistics',
    matches: (event) => event.category === 'mmu-stats-report' && event.fields.gateStatistics != null,
  },
  {
    id: 'wear-counter-alerts',
    label: 'Wear-Counter Alerts',
    matches: (event) => event.category === 'wear-counter',
  },
  {
    id: 'job-state-changes',
    label: 'Job State Changes',
    matches: (event) => event.category === 'job-state-change',
  },
  {
    id: 'endless-spool-remaps',
    label: 'EndlessSpool/Gate Remaps',
    matches: (event) => event.category === 'endless-spool-remap',
  },
  {
    id: 'spoolman',
    label: 'Spoolman',
    matches: (event) => event.category === 'spoolman',
  },
];
