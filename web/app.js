// MTSU Degree Planner: the web page.
// Four views (Graph, Plan, Next term, What-if) share one saved state. The planning engine lives in
// ./engine and has no page dependencies. All browser storage access is wrapped so the page still
// works when storage is blocked.

import * as T from './engine/terms.js';
import * as P from './engine/prereqs.js';
import * as V from './engine/validate.js';
import { planTerms, reasonText } from './engine/planner.js';
import * as TT from './engine/timetable.js';
import * as W from './engine/whatif.js';

// ---------------------------------------------------------------- settings

const CATALOG_YEARS = ['2026-27', '2018-19'];
const DATA_BASES = ['../data/', 'data/'];
const STORAGE_KEY = 'mtsu-degree-planner-state-v1';
const THEME_KEY = 'mtsu-degree-planner-theme';
const FIRST_START_TERM = '2026FA';
const START_TERM_COUNT = 12;
const VIEWS = [
  ['graph', 'Graph'],
  ['plan', 'Plan'],
  ['next', 'Next term'],
  ['whatif', 'What-if'],
];
const WEEK_DAYS = [['M', 'Mon'], ['T', 'Tue'], ['W', 'Wed'], ['R', 'Thu'], ['F', 'Fri'], ['S', 'Sat']];
const YEAR_NAMES = ['Freshman year', 'Sophomore year', 'Junior year', 'Senior year'];

// ------------------------------------------------------------------ helpers

const $ = (selector, root = document) => root.querySelector(selector);

/** Build a DOM node. Strings become text, so nothing from data is ever read as HTML. */
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  let deferredValue;
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') deferredValue = value;
    else if (key === 'for') node.htmlFor = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') node[key] = !!value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const add = (kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  if (deferredValue !== undefined) node.value = deferredValue;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const classes = (n) => plural(n, 'class', 'classes');
const termName = (t) => (t ? T.termLabel(t) : 'none');

function deltaNode(delta, { unit = 'term' } = {}) {
  if (delta === null || delta === undefined) return null;
  if (delta === 0) return el('span', { class: 'muted', text: 'same as baseline' });
  return el('span', {
    class: delta > 0 ? 'delta-up' : 'delta-down',
    text: `${plural(Math.abs(delta), unit)} ${delta > 0 ? 'later' : 'earlier'} than baseline`,
  });
}

function tag(text, kind = '') {
  return el('span', { class: `tag ${kind}`.trim(), text });
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

function meetingText(m) {
  return `${m.days} ${formatTime(m.start)} to ${formatTime(m.end)}`;
}

// ------------------------------------------------------------ safe storage

function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch { return false; }
}
function storageRemove(key) {
  try { window.localStorage.removeItem(key); } catch { /* storage is unavailable */ }
}

// -------------------------------------------------------------------- state

function defaultState(catalogYear) {
  return {
    catalog_year: catalogYear,
    start_term: FIRST_START_TERM,
    completed: [],
    in_progress: [],
    choices: {},
    options: { summer_allowed: false, max_credits: 18, summer_max_credits: 8, include_occasional: false, target_term: null },
    edits: [],
  };
}

/** Accept a saved or imported state, keep the parts that make sense, and fill in the rest. */
function sanitizeState(raw, fallbackYear) {
  const base = defaultState(fallbackYear);
  if (!raw || typeof raw !== 'object') return base;
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const out = { ...base };
  if (typeof raw.catalog_year === 'string') out.catalog_year = raw.catalog_year;
  if (typeof raw.start_term === 'string' && T.isTerm(raw.start_term)) out.start_term = raw.start_term;
  out.completed = list(raw.completed);
  out.in_progress = list(raw.in_progress).filter((c) => !out.completed.includes(c));
  if (raw.choices && typeof raw.choices === 'object') {
    for (const [id, picks] of Object.entries(raw.choices)) out.choices[id] = list(picks);
  }
  if (raw.options && typeof raw.options === 'object') {
    const o = raw.options;
    out.options = {
      summer_allowed: false, // Summer terms are out of scope for the proof of concept.
      max_credits: Number.isFinite(o.max_credits) && o.max_credits > 0 ? o.max_credits : base.options.max_credits,
      summer_max_credits: Number.isFinite(o.summer_max_credits) && o.summer_max_credits >= 0 ? o.summer_max_credits : base.options.summer_max_credits,
      include_occasional: !!o.include_occasional,
      target_term: typeof o.target_term === 'string' && T.isTerm(o.target_term) ? o.target_term : null,
    };
  }
  if (Array.isArray(raw.edits)) out.edits = raw.edits.filter((e) => e && typeof e === 'object' && W.EDIT_TYPES.includes(e.type));
  return out;
}

let data = { catalogs: {}, offerings: null, schedules: {} };
let state = defaultState(CATALOG_YEARS[0]);
let view = 'graph';

const ui = {
  graph: { milestone: '', onlyCritical: false, hideDone: false, selected: null },
  next: { term: null, pick: 0 },
  compare: { a: null, b: null },
  whatif: { draft: { type: 'set_seasons', course: null }, meetings: [{ days: 'MWF', start: '09:00', end: '09:50' }], error: '' },
};

function saveState() {
  storageSet(STORAGE_KEY, JSON.stringify(state));
}

function loadSavedState(fallbackYear) {
  const text = storageGet(STORAGE_KEY);
  if (!text) return defaultState(fallbackYear);
  try {
    return sanitizeState(JSON.parse(text), fallbackYear);
  } catch {
    return defaultState(fallbackYear);
  }
}

function update(change) {
  change(state);
  saveState();
  render();
}

// ------------------------------------------------------------------ loading

async function loadJson(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function readEmbedded() {
  const node = document.getElementById('planner-data');
  if (!node) return null;
  try { return JSON.parse(node.textContent); } catch { return null; }
}

async function loadData() {
  const embedded = readEmbedded();
  if (embedded) {
    return {
      catalogs: embedded.catalogs ?? {},
      offerings: embedded.offerings ?? null,
      schedules: embedded.schedules ?? {},
    };
  }
  let base = DATA_BASES[0];
  let catalogs = {};
  for (const candidate of DATA_BASES) {
    const loaded = await Promise.all(CATALOG_YEARS.map((y) => loadJson(`${candidate}catalogs/${y}.json`)));
    const found = Object.fromEntries(CATALOG_YEARS.map((y, i) => [y, loaded[i]]).filter(([, c]) => c));
    if (Object.keys(found).length) { base = candidate; catalogs = found; break; }
  }
  const offerings = await loadJson(`${base}offerings.json`);
  let termIds = (await loadJson(`${base}schedule/index.json`))?.terms?.map((t) => t.term);
  if (!termIds) {
    // No index file: try the terms a plan is likely to need.
    termIds = T.termRange(FIRST_START_TERM, T.termFromIndex(T.termIndex(FIRST_START_TERM) + 8));
  }
  const schedules = {};
  const loaded = await Promise.all(termIds.map((t) => loadJson(`${base}schedule/${t}.json`)));
  termIds.forEach((t, i) => { if (loaded[i]) schedules[t] = loaded[i]; });
  return { catalogs, offerings, schedules };
}

// ------------------------------------------------------------------ compute

let cache = null;

function engineStudent() {
  return {
    start_term: state.start_term,
    completed: state.completed,
    in_progress: state.in_progress,
    choices: state.choices,
    options: { ...state.options },
  };
}

/** Run the baseline and the changed scenario. Returns null when there is no catalog. */
function compute() {
  const catalog = data.catalogs[state.catalog_year];
  if (!catalog) return null;
  const key = JSON.stringify([state.catalog_year, state.start_term, state.completed, state.in_progress, state.choices, state.options, state.edits]);
  if (cache && cache.key === key) return cache.value;
  let value;
  try {
    value = {
      ...W.compareScenario({
        catalog, offerings: data.offerings, schedules: data.schedules, student: engineStudent(), edits: state.edits,
      }),
      error: null,
    };
  } catch (error) {
    value = { error: error.message };
  }
  cache = { key, value };
  return value;
}

function startTerms() {
  return T.termRange(FIRST_START_TERM, T.termFromIndex(T.termIndex(FIRST_START_TERM) + START_TERM_COUNT - 1));
}

// ------------------------------------------------------------------- notices

function renderNotices(result) {
  const box = clear($('#notices'));
  const catalog = data.catalogs[state.catalog_year];
  if (!catalog) {
    box.append(el('div', { class: 'notice bad' },
      el('p', { text: 'No catalog data loaded.' }),
      el('p', { text: `The page looks for data/catalogs/${CATALOG_YEARS.join('.json and data/catalogs/')}.json. Serve the repository root with a local web server, or open dist/planner.html, which carries its data inside the file.` })));
    return;
  }
  const problems = V.validateCatalog(catalog).errors;
  if (problems.length) {
    box.append(el('div', { class: 'notice bad' },
      el('p', { text: `The ${catalog.catalog_year} catalog file has ${plural(problems.length, 'problem')}. Results may be wrong until the file is fixed.` }),
      el('ul', {}, problems.slice(0, 5).map((p) => el('li', { text: p.message })))));
  }
  if (!data.offerings) {
    box.append(el('div', { class: 'notice warn' },
      el('p', { text: 'Offering data is missing, so the planner assumes every course runs every year in its suggested season (the season on the academic map). Real offerings may differ.' })));
  }
  if (Object.keys(data.schedules).length === 0) {
    box.append(el('div', { class: 'notice warn' },
      el('p', { text: 'Schedule data is missing, so the Next term view cannot show section times. Run the schedule importer (see the README) to add it.' })));
  }
  if (result && result.error) {
    box.append(el('div', { class: 'notice bad' }, el('p', { text: `The planner stopped: ${result.error}` })));
  }
  if (result && !result.error && state.edits.length) {
    box.append(el('div', { class: 'notice info' },
      el('p', {},
        `${plural(state.edits.length, 'what-if edit')} applied. Results on every tab compare with the unchanged baseline. `,
        el('a', { href: '#whatif', text: 'Open What-if' }), '.')));
  }
}

function renderFooterNote() {
  const note = $('#data-note');
  const terms = Object.keys(data.schedules).sort((a, b) => T.compareTerms(a, b));
  const parts = [];
  parts.push(data.offerings ? `Offering patterns cover ${data.offerings.terms_covered?.map(termName).join(' to ') ?? 'imported terms'}.` : 'No offering patterns loaded.');
  parts.push(terms.length ? `Schedule data for ${plural(terms.length, 'term')} (${termName(terms[0])} to ${termName(terms[terms.length - 1])}).` : 'No schedule data loaded.');
  note.textContent = parts.join(' ');
}

// -------------------------------------------------------------- shared bits

function legend(items) {
  return el('div', { class: 'legend' }, items);
}

function explainSlack() {
  return el('p', { class: 'small muted' },
    'Slack is the number of terms a course can start later than its earliest term without delaying graduation. ',
    'Courses with zero slack are on the critical path: a delay in any of them delays graduation.');
}

/** Describe the edit-vs-baseline difference in a short banner for the top of a view. */
function diffBanner(result) {
  if (!result || result.error || state.edits.length === 0) return null;
  const lines = W.summarizeDiff(result.diff);
  return el('div', { class: 'notice info' },
    el('p', {}, el('b', { text: 'Compared with the unchanged baseline' })),
    el('ul', {}, lines.map((l) => el('li', { text: l }))));
}

function courseLabel(catalog, id) {
  const def = catalog.courses[id];
  return def ? `${id}  ${def.title}` : id;
}

// -------------------------------------------------------------------- graph

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name) => css.getPropertyValue(name).trim() || '#888';
  return {
    bg: read('--surface'), surface2: read('--surface-2'), text: read('--text'), muted: read('--muted'),
    border: read('--border'), accent: read('--accent'), accentSoft: read('--accent-soft'),
    crit: read('--crit'), critSoft: read('--crit-soft'),
  };
}

function slackFor(analysis, id, milestone) {
  if (milestone) {
    const m = analysis.milestones[milestone];
    return m && id in m.slack ? m.slack[id] : null;
  }
  return analysis.courses[id]?.slack ?? null;
}

function isCritical(analysis, id, milestone) {
  if (milestone) return !!analysis.milestones[milestone]?.critical.includes(id);
  return !!analysis.courses[id]?.critical;
}

function renderGraph(root, result) {
  const { scenario, baseline } = result;
  const catalog = scenario.catalog;
  const analysis = scenario.plan.analysis;
  const baseAnalysis = baseline.plan.analysis;
  const g = ui.graph;
  if (g.milestone && !analysis.milestones[g.milestone]) g.milestone = '';

  const banner = diffBanner(result);
  if (banner) root.append(banner);

  const milestoneSelect = el('select', {
    id: 'g-milestone', value: g.milestone,
    onchange: (e) => { g.milestone = e.target.value; render(); },
  }, el('option', { value: '', text: 'Graduation' }),
  Object.entries(analysis.milestones).map(([id, m]) => el('option', { value: id, text: m.label })));

  const targetSelect = el('select', {
    id: 'g-target', value: state.options.target_term ?? '',
    onchange: (e) => update((s) => { s.options.target_term = e.target.value || null; }),
  }, el('option', { value: '', text: `Earliest possible (${termName(analysis.finish_term)})` }),
  analysis.terms.slice(0, 16).map((t) => el('option', { value: t, text: termName(t) })));

  root.append(el('section', { class: 'panel' },
    el('h2', { text: 'Course graph' }),
    el('p', { class: 'small muted' },
      'Courses sit in columns by the term the academic map suggests. Arrows point from a prerequisite to the course that needs it. ',
      'A dashed arrow means the prerequisite may be taken at the same time.'),
    explainSlack(),
    el('div', { class: 'row' },
      el('label', { class: 'field-inline', for: 'g-milestone' }, 'Measure slack toward', milestoneSelect),
      el('label', { class: 'field-inline', for: 'g-target' }, 'Graduation target', targetSelect),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: g.onlyCritical, onchange: (e) => { g.onlyCritical = e.target.checked; render(); } }),
        'Show only the critical path'),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: g.hideDone, onchange: (e) => { g.hideDone = e.target.checked; render(); } }),
        'Hide completed courses'))));

  // Which courses to show
  const ids = Object.keys(catalog.courses).filter((id) => {
    const status = analysis.courses[id].status;
    if (g.hideDone && status === 'completed') return false;
    if (g.onlyCritical && !isCritical(analysis, id, g.milestone)) return false;
    return true;
  });
  const shown = new Set(ids);

  const detail = el('section', { class: 'panel', 'aria-live': 'polite' });
  const showDetail = (id) => {
    g.selected = id;
    clear(detail).append(...courseDetail(result, id));
  };

  if (typeof window.cytoscape === 'undefined') {
    root.append(graphFallback(result, ids, showDetail));
    root.append(detail);
    if (g.selected && shown.has(g.selected)) showDetail(g.selected);
    return;
  }

  root.append(legend([
    el('span', {}, el('span', { class: 'swatch crit' }), 'Critical path (no slack)'),
    el('span', {}, el('span', { class: 'swatch' }), 'Prerequisite'),
    el('span', {}, el('span', { class: 'swatch dashed' }), 'May be taken at the same time'),
    el('span', {}, el('span', { class: 'swatch any' }), 'One of several choices'),
  ]));
  const container = el('div', { id: 'cy', role: 'img', 'aria-label': 'Prerequisite graph of the courses. A text list of the same information appears under the graph.' });
  root.append(el('div', { class: 'graph-wrap' }, container), detail);
  drawGraph(container, result, ids, showDetail);
  root.append(el('details', { class: 'panel' },
    el('summary', { text: 'Show the same information as a list' }),
    graphTable(result, ids, showDetail)));
  if (g.selected && shown.has(g.selected)) showDetail(g.selected);
  else showDetail(null);
}

function slackWords(analysis, baseAnalysis, id, milestone) {
  const info = analysis.courses[id];
  if (info.status === 'completed') return 'done';
  if (info.status === 'in_progress') return 'in progress';
  if (info.status === 'optional') return 'not selected';
  if (info.blocked) return 'blocked';
  const now = slackFor(analysis, id, milestone);
  if (now === null) return 'no link to target';
  const before = slackFor(baseAnalysis, id, milestone);
  const text = `slack ${now}`;
  return state.edits.length && before !== now ? `${text} (was ${before ?? 'none'})` : text;
}

function drawGraph(container, result, ids, showDetail) {
  const { scenario, baseline } = result;
  const catalog = scenario.catalog;
  const analysis = scenario.plan.analysis;
  const baseAnalysis = baseline.plan.analysis;
  const m = ui.graph.milestone;
  const colors = themeColors();

  const shown = new Set(ids);
  const positions = [...new Set(ids.map((id) => P.suggestedPositionOf(catalog, id)))]
    .sort((a, b) => (a ?? 99) - (b ?? 99));
  const columnOf = (id) => positions.indexOf(P.suggestedPositionOf(catalog, id));

  const elements = [];
  positions.forEach((pos, col) => {
    elements.push({
      data: { id: `col:${col}`, label: pos === null ? 'No suggested term' : T.suggestedLabel(T.suggestedFromPosition(pos)) },
      classes: 'colhead', selectable: false, grabbable: false,
    });
  });
  for (const id of ids) {
    const info = analysis.courses[id];
    const classes = [];
    if (isCritical(analysis, id, m) && info.status === 'todo') classes.push('critical');
    if (info.status === 'completed') classes.push('done');
    if (info.status === 'in_progress') classes.push('progress');
    if (info.status === 'optional') classes.push('optional');
    elements.push({
      data: { id, label: `${id}\n${slackWords(analysis, baseAnalysis, id, m)}`, col: columnOf(id) },
      classes: classes.join(' '),
    });
  }
  for (const id of ids) {
    for (const leaf of P.prereqLeaves(catalog.courses[id].prereqs)) {
      if (!shown.has(leaf.course)) continue;
      const classes = [];
      if (leaf.concurrent_ok) classes.push('concurrent');
      if (leaf.group === 'any') classes.push('anyof');
      if (isCritical(analysis, id, m) && isCritical(analysis, leaf.course, m)) classes.push('critical');
      elements.push({ data: { id: `${leaf.course}->${id}`, source: leaf.course, target: id }, classes: classes.join(' ') });
    }
  }

  const style = [
    { selector: 'node', style: {
      shape: 'round-rectangle', width: 118, height: 46, label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 108,
      'text-valign': 'center', 'text-halign': 'center', 'font-size': 11, color: colors.text,
      'background-color': colors.surface2, 'border-width': 1.5, 'border-color': colors.border,
    } },
    { selector: 'node.critical', style: { 'border-color': colors.crit, 'border-width': 3, 'background-color': colors.critSoft } },
    { selector: 'node.progress', style: { 'border-color': colors.accent, 'border-width': 3, 'background-color': colors.accentSoft } },
    { selector: 'node.done', style: { opacity: 0.5 } },
    { selector: 'node.optional', style: { 'border-style': 'dashed' } },
    { selector: 'node:selected', style: { 'overlay-color': colors.accent, 'overlay-opacity': 0.2, 'overlay-padding': 6 } },
    { selector: 'node.colhead', style: {
      shape: 'rectangle', 'background-opacity': 0, 'border-width': 0, color: colors.muted, 'font-weight': 'bold', 'font-size': 12,
      events: 'no', width: 118, height: 24,
    } },
    { selector: 'edge', style: {
      width: 1.5, 'line-color': colors.muted, 'target-arrow-color': colors.muted, 'target-arrow-shape': 'triangle',
      'curve-style': 'bezier', 'arrow-scale': 0.9,
    } },
    { selector: 'edge.concurrent', style: { 'line-style': 'dashed' } },
    { selector: 'edge.anyof', style: { 'line-color': colors.accent, 'target-arrow-color': colors.accent } },
    { selector: 'edge.critical', style: { 'line-color': colors.crit, 'target-arrow-color': colors.crit, width: 2.5 } },
  ];

  const cy = window.cytoscape({
    container, elements, style, layout: { name: 'preset' }, wheelSensitivity: 0.3, minZoom: 0.15, maxZoom: 2.5,
    boxSelectionEnabled: false,
  });

  const snap = () => {
    const columns = positions.map(() => []);
    cy.nodes().not('.colhead').forEach((n) => columns[n.data('col')].push(n));
    const rowGap = 64;
    const colGap = 150;
    const tallest = Math.max(1, ...columns.map((c) => c.length));
    columns.forEach((nodes, col) => {
      nodes.sort((a, b) => a.position('y') - b.position('y') || a.id().localeCompare(b.id()));
      const offset = ((tallest - nodes.length) * rowGap) / 2;
      nodes.forEach((n, i) => n.position({ x: col * colGap, y: offset + i * rowGap }));
      cy.getElementById(`col:${col}`).position({ x: col * colGap, y: -rowGap * 0.8 });
    });
    cy.fit(undefined, 24);
    if (cy.zoom() > 1) { cy.zoom(1); cy.center(); }
    if (cy.zoom() < 0.6) { cy.zoom({ level: 0.6, renderedPosition: { x: 24, y: cy.height() / 2 } }); cy.pan({ x: 24 - cy.nodes().not('.colhead').boundingBox().x1 * 0.6, y: cy.pan().y }); }
  };

  let usedDagre = false;
  try {
    if (typeof window.cytoscapeDagre === 'function' && typeof window.dagre !== 'undefined') {
      try { window.cytoscape.use(window.cytoscapeDagre); } catch { /* already registered */ }
    }
    if (typeof window.dagre !== 'undefined') {
      cy.nodes().not('.colhead').layout({
        name: 'dagre', rankDir: 'LR', nodeSep: 14, rankSep: 70, animate: false, fit: false, stop: snap,
      }).run();
      usedDagre = true;
    }
  } catch {
    usedDagre = false;
  }
  if (!usedDagre) {
    // Without dagre, order each column by course number.
    cy.nodes().not('.colhead').forEach((n, i) => n.position({ x: 0, y: i }));
    snap();
  }

  cy.on('tap', 'node', (event) => {
    if (event.target.hasClass('colhead')) return;
    showDetail(event.target.id());
  });
  cy.on('tap', (event) => { if (event.target === cy) showDetail(null); });
  if (ui.graph.selected && shown.has(ui.graph.selected)) cy.getElementById(ui.graph.selected).select();
}

function graphTable(result, ids, showDetail) {
  const { scenario, baseline } = result;
  const catalog = scenario.catalog;
  const analysis = scenario.plan.analysis;
  const m = ui.graph.milestone;
  const rows = [...ids].sort((a, b) => (P.suggestedPositionOf(catalog, a) ?? 99) - (P.suggestedPositionOf(catalog, b) ?? 99) || a.localeCompare(b));
  return el('div', { class: 'table-scroll' }, el('table', {},
    el('thead', {}, el('tr', {}, ['Course', 'Suggested term', 'Earliest', 'Latest', 'Slack'].map((h) => el('th', { text: h })))),
    el('tbody', {}, rows.map((id) => {
      const info = analysis.courses[id];
      const slack = slackWords(analysis, baseline.plan.analysis, id, m);
      return el('tr', {},
        el('td', {}, el('button', { class: 'small-btn', type: 'button', text: id, onclick: () => showDetail(id) }),
          isCritical(analysis, id, m) && info.status === 'todo' ? [' ', tag('critical', 'crit')] : null),
        el('td', { text: catalog.courses[id].suggested_term ? T.suggestedLabel(catalog.courses[id].suggested_term) : '' }),
        el('td', { text: info.earliest_term ? termName(info.earliest_term) : '' }),
        el('td', { text: info.latest_term ? termName(info.latest_term) : '' }),
        el('td', { text: slack }));
    }))));
}

function graphFallback(result, ids, showDetail) {
  return el('section', { class: 'panel graph-fallback' },
    el('div', { class: 'notice warn' }, el('p', { text: 'The graph library did not load (it comes from cdnjs.cloudflare.com), so this page shows the same information as a list.' })),
    graphTable(result, ids, showDetail));
}

function courseDetail(result, id) {
  if (!id) return [el('p', { class: 'muted', text: 'Select a course in the graph to see its prerequisites, offered seasons, and slack.' })];
  const { scenario, baseline } = result;
  const catalog = scenario.catalog;
  const def = catalog.courses[id];
  const info = scenario.plan.analysis.courses[id];
  const baseInfo = baseline.plan.analysis.courses[id];
  const rows = [
    ['Credit hours', String(def.credits)],
    ['Parts that need a section', def.components.join(', ')],
    ['Prerequisites', P.describePrereqs(def.prereqs)],
    ['Class standing needed', def.standing ? `${def.standing} (${catalog.standing_hours[def.standing]} hours)` : 'None'],
    ['Academic map term', def.suggested_term ? T.suggestedLabel(def.suggested_term) : 'Not on the map'],
    ['Offered', offeredText(info)],
    ['Status', { completed: 'Completed', in_progress: 'Taking now', todo: 'Still to take', optional: 'Not selected in this plan' }[info.status] + (info.added ? ' (added because another course needs it)' : '')],
  ];
  if (info.status === 'todo') {
    rows.push(['Earliest term', info.earliest_term ? termName(info.earliest_term) : 'Cannot be scheduled']);
    rows.push(['Latest term without delaying graduation', info.latest_term ? termName(info.latest_term) : 'None']);
    rows.push(['Slack', info.slack === null ? 'None' : `${plural(info.slack, 'term')}${state.edits.length && baseInfo && baseInfo.slack !== info.slack ? ` (baseline: ${baseInfo.slack})` : ''}`]);
  }
  const nodes = [
    el('h3', { text: `${id}  ${def.title}` }),
    el('table', {}, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { text: k }), el('td', { text: v }))))),
  ];
  if (def.notes) {
    nodes.push(el('p', { class: `small ${def.notes.startsWith('CHECK:') ? '' : 'muted'}` },
      def.notes.startsWith('CHECK:') ? tag('Needs a human check', 'warn') : null, ' ', def.notes));
  }
  return nodes;
}

function offeredText(info) {
  const seasons = info.seasons.length ? info.seasons.join(' and ') : 'no season';
  const source = { data: 'from the imported schedule', assumed: 'assumed from the academic map', edit: 'set by a what-if edit' }[info.season_source];
  return `${seasons} (${source})`;
}

// --------------------------------------------------------------------- plan

function groupCourses(catalog) {
  const groups = new Map();
  for (const [id, def] of Object.entries(catalog.courses)) {
    const pos = P.suggestedPositionOf(catalog, id);
    const key = pos === null ? 99 : Math.floor(pos / 3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, list]) => [
    key === 99 ? 'Other courses' : YEAR_NAMES[key] ?? `Year ${key + 1}`,
    list.sort((a, b) => (P.suggestedPositionOf(catalog, a) ?? 99) - (P.suggestedPositionOf(catalog, b) ?? 99) || a.localeCompare(b)),
  ]);
}

function setStatus(id, status) {
  update((s) => {
    s.completed = s.completed.filter((c) => c !== id);
    s.in_progress = s.in_progress.filter((c) => c !== id);
    if (status === 'done') s.completed.push(id);
    if (status === 'now') s.in_progress.push(id);
  });
}

function planFor(catalog, completed) {
  return planTerms({
    catalog, offerings: data.offerings,
    student: { ...engineStudent(), completed, in_progress: [], choices: state.choices },
  });
}

function renderPlan(root, result) {
  const { scenario, baseline, diff } = result;
  const catalog = scenario.catalog;
  const plan = scenario.plan;
  const banner = diffBanner(result);
  if (banner) root.append(banner);

  const left = el('div', {});
  const right = el('div', {});
  root.append(el('div', { class: 'split two' }, left, right));

  // ---- inputs
  const startSelect = el('select', {
    id: 'start-term', value: state.start_term,
    onchange: (e) => update((s) => { s.start_term = e.target.value; s.options.target_term = null; }),
  }, startTerms().map((t) => el('option', { value: t, text: termName(t) })));

  left.append(el('section', { class: 'panel' },
    el('h2', { text: 'Your plan settings' }),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'start-term', text: 'First term to plan' }), startSelect),
    el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', { for: 'max-credits', class: 'label', text: 'Credit hour limit, fall and spring' }),
        el('input', { id: 'max-credits', type: 'number', min: 1, max: 30, value: state.options.max_credits,
          onchange: (e) => update((s) => { s.options.max_credits = Math.max(1, Number(e.target.value) || 18); }) })),
    ),
    data.offerings
      ? el('div', { class: 'field' }, el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: state.options.include_occasional, onchange: (e) => update((s) => { s.options.include_occasional = e.target.checked; }) }),
        'Also use seasons when a course runs only some years'),
      el('span', { class: 'hint', text: 'A course runs regularly if it ran in at least 3 of the last 4 years.' }))
      : null));

  left.append(startFromPanel(catalog));

  // choose requirements
  const chooseBlocks = plan.choices.map((c) => el('div', { class: 'field' },
    el('span', { class: 'label', text: `Choose ${c.count}: ${c.id}` }),
    c.options.map((opt, i) => el('label', { class: 'check' },
      el('input', {
        type: c.count === 1 ? 'radio' : 'checkbox', name: `choice-${c.id}`, checked: c.selected.includes(opt),
        onchange: (e) => update((s) => {
          const current = s.choices[c.id] ?? c.selected;
          if (c.count === 1) s.choices[c.id] = [opt];
          else s.choices[c.id] = e.target.checked ? [...new Set([...current, opt])].slice(-c.count) : current.filter((x) => x !== opt);
        }),
      }), courseLabel(catalog, opt)))));
  if (chooseBlocks.length) left.append(el('section', { class: 'panel' }, el('h2', { text: 'Elective choices' }), chooseBlocks));

  // placeholders
  const placeholders = (catalog.requirements ?? []).filter((r) => r.type === 'placeholder');
  if (placeholders.length) {
    left.append(el('section', { class: 'panel' },
      el('h2', { text: 'General education' }),
      el('p', { class: 'small muted', text: 'The planner reserves these hours in their preferred terms. It does not schedule their sections. Check the ones you finished.' }),
      placeholders.map((p) => el('label', { class: 'check', style: 'display:flex' },
        el('input', {
          type: 'checkbox', checked: state.completed.includes(p.id),
          onchange: (e) => update((s) => { s.completed = e.target.checked ? [...s.completed, p.id] : s.completed.filter((c) => c !== p.id); }),
        }), `${p.label} (${p.hours} hours)`))));
  }

  // course checklist
  left.append(el('section', { class: 'panel' },
    el('h2', { text: 'Courses you have finished' }),
    el('p', { class: 'small muted', text: 'Check each course you have completed. Check "Taking now" for courses you are enrolled in during the first planned term.' }),
    el('div', { class: 'row tight' },
      el('button', { type: 'button', class: 'small-btn', text: 'Clear all', onclick: () => update((s) => { s.completed = []; s.in_progress = []; }) })),
    groupCourses(catalog).map(([name, list]) => el('div', { class: 'course-group' },
      el('h4', { text: name }),
      list.map((id) => {
        const done = state.completed.includes(id);
        const now = state.in_progress.includes(id);
        return el('div', { class: 'course-row' },
          el('input', { type: 'checkbox', checked: done, 'aria-label': `${id} completed`, onchange: (e) => setStatus(id, e.target.checked ? 'done' : 'todo') }),
          el('div', { class: 'name' }, el('b', { text: id }), el('span', { text: `${catalog.courses[id].title}, ${catalog.courses[id].credits} hr` })),
          done ? null : el('label', { class: 'now' },
            el('input', { type: 'checkbox', checked: now, 'aria-label': `${id} taking now`, onchange: (e) => setStatus(id, e.target.checked ? 'now' : 'todo') }), ' Taking now'));
      })))));

  // ---- results
  right.append(planSummary(result));
  if (plan.warnings.length || plan.assumptions.length) {
    right.append(el('div', { class: 'notice warn' },
      el('ul', {}, [...plan.warnings, ...plan.assumptions].map((w) => el('li', { text: w })))));
  }
  right.append(driverPanel(plan, catalog));
  right.append(el('section', { class: 'panel' },
    el('h2', { text: 'Term by term' }),
    el('div', { class: 'terms' }, plan.terms.map((t) => termCard(t, plan, baseline.plan)))));
  right.append(comparePanel(result));
}

function startFromPanel(catalog) {
  const ids = Object.keys(catalog.courses);
  const select = el('select', { id: 'start-from' }, ids.map((id) => el('option', { value: id, text: courseLabel(catalog, id) })));
  return el('section', { class: 'panel' },
    el('h2', { text: 'Quick start' }),
    el('p', { class: 'small muted', text: 'Pick the first course you take. The planner marks the courses before it as done.' }),
    el('div', { class: 'field' }, el('label', { for: 'start-from', class: 'label', text: 'I start with' }), select),
    el('button', { type: 'button', text: 'Mark earlier courses done', onclick: () => {
      const id = select.value;
      update((s) => { s.completed = [...P.ancestorsOf(catalog, id)]; s.in_progress = []; });
    } }));
}

function planSummary(result) {
  const { scenario, baseline, diff } = result;
  const plan = scenario.plan;
  const edited = state.edits.length > 0;
  const stats = [];
  stats.push(el('div', { class: 'stat' },
    el('div', { class: 'k', text: 'Projected graduation' }),
    el('div', { class: 'v', text: plan.graduation_term ? termName(plan.graduation_term) : 'Not reachable' }),
    el('div', { class: 'd' }, plan.graduation_term ? `${plural(plan.terms.length, 'term')} from ${termName(plan.start_term)}` : 'See the notes below', edited ? [' ', deltaNode(diff.graduation.delta_terms)] : null)));
  plan.milestones.forEach((m, i) => {
    const d = diff.milestones[i];
    stats.push(el('div', { class: 'stat' },
      el('div', { class: 'k', text: `${m.label} starts` }),
      el('div', { class: 'v', text: m.start_term ? termName(m.start_term) : m.status === 'done' ? 'Done' : 'Not planned' }),
      el('div', { class: 'd' }, m.courses.join(', '), edited && d ? [' ', deltaNode(d.delta_terms)] : null)));
  });
  stats.push(el('div', { class: 'stat' },
    el('div', { class: 'k', text: 'Credit hours left' }),
    el('div', { class: 'v', text: String(plan.remaining_hours) }),
    el('div', { class: 'd', text: 'including reserved general education' })));
  return el('div', { class: 'stat-row' }, stats);
}

function driverPanel(plan, catalog) {
  const nodes = [];
  const chainView = (title, chain) => (chain.length
    ? el('div', {}, el('h3', { text: title }),
      el('ol', { class: 'chain' }, chain.map((step) => el('li', {},
        el('b', { text: step.course }), ' ', termName(step.term),
        el('span', { class: 'why', text: reasonText(step.reason) })))))
    : null);
  for (const m of plan.milestones) {
    nodes.push(chainView(`Courses that set the ${m.label.toLowerCase()} start`, plan.drivers.milestones[m.id] ?? []));
  }
  if (plan.drivers.graduation.set_by === 'courses') nodes.push(chainView('Courses that set the graduation term', plan.drivers.graduation.chain));
  else if (plan.graduation_term) nodes.push(el('p', { text: `General education hours in ${termName(plan.graduation_term)} set the graduation term.` }));
  return el('section', { class: 'panel' }, el('h2', { text: 'What sets the dates' }), nodes);
}

function termCard(t, plan, basePlan) {
  const startsMilestone = plan.milestones.filter((m) => m.start_term === t.term);
  const full = t.credits >= t.capacity && t.capacity > 0;
  return el('article', { class: `term-card${startsMilestone.length ? ' milestone' : ''}` },
    el('header', {},
      el('h3', { text: t.label }),
      el('span', { class: `load${full ? ' full' : ''}`, text: `${t.credits} of ${t.capacity} hours` })),
    startsMilestone.map((m) => el('p', {}, tag(`${m.label} starts`, 'info'))),
    t.courses.map((c) => {
      const moved = basePlan.placements[c.course] && basePlan.placements[c.course] !== t.term;
      const meta = [];
      if (c.critical) meta.push('Critical: no room to slip.');
      else if (c.slack !== null && c.slack !== undefined) meta.push(`Can start up to ${plural(c.slack, 'term')} later.`);
      if (c.reason !== 'prerequisite' && c.reason !== 'in progress') meta.push(reasonText(c.reason));
      if (c.added) meta.push('Added because another course needs it.');
      if (moved) meta.push(`Baseline: ${termName(basePlan.placements[c.course])}.`);
      return el('div', { class: `chip${c.critical ? ' crit' : ''}` },
        el('span', { class: 't' }, c.course, el('span', { class: 'title', text: c.title })),
        el('span', { class: 'muted small', text: `${c.credits} hr` }),
        meta.length ? el('span', { class: 'm', text: meta.join(' ') }) : null);
    }),
    t.placeholders.map((p) => el('div', { class: 'chip reserve' },
      el('span', { class: 't', text: p.label }), el('span', { class: 'small', text: `${p.hours} hr` }),
      el('span', { class: 'm', text: 'Reserved general education hours' }))));
}

function comparePanel(result) {
  const catalog = result.scenario.catalog;
  const ids = Object.keys(catalog.courses);
  const guess = (wanted, fallback) => (ids.includes(wanted) ? wanted : fallback);
  if (!ui.compare.a || !ids.includes(ui.compare.a)) ui.compare.a = guess('MATH 1730', ids[0]);
  if (!ui.compare.b || !ids.includes(ui.compare.b)) ui.compare.b = guess('MATH 1910', ids[Math.min(1, ids.length - 1)]);

  const select = (key, id) => el('select', {
    id, value: ui.compare[key], onchange: (e) => { ui.compare[key] = e.target.value; render(); },
  }, ids.map((c) => el('option', { value: c, text: courseLabel(catalog, c) })));

  const sc = result.scenario.catalog;
  const planA = planFor(sc, [...P.ancestorsOf(sc, ui.compare.a)]);
  const planB = planFor(sc, [...P.ancestorsOf(sc, ui.compare.b)]);
  const diff = W.diffPlans(planA, planB);
  const milestone = planA.milestones[0];
  const row = (label, plan, other) => {
    const m = plan.milestones[0];
    return el('tr', {},
      el('th', { text: label }),
      el('td', { text: m?.start_term ? termName(m.start_term) : 'Not planned' }),
      el('td', { text: plan.graduation_term ? termName(plan.graduation_term) : 'Not reachable' }));
  };
  const lines = W.summarizeDiff(diff, { baseName: `Starting with ${ui.compare.a}`, altName: `starting with ${ui.compare.b}` })
    .filter((l) => !/critical path/.test(l));
  const responsible = milestone ? diff.responsible[milestone.id] ?? [] : [];
  const gradResp = diff.responsible.graduation ?? [];
  const named = [...new Map([...responsible, ...gradResp].map((r) => [r.course, r])).values()];

  return el('section', { class: 'panel' },
    el('h2', { text: 'Compare two starting points' }),
    el('p', { class: 'small muted', text: 'Each plan starts in the first planned term. It assumes you finished the courses before your starting course and nothing else.' }),
    el('div', { class: 'row' },
      el('label', { class: 'field-inline', for: 'cmp-a' }, 'Student A starts with', select('a', 'cmp-a')),
      el('label', { class: 'field-inline', for: 'cmp-b' }, 'Student B starts with', select('b', 'cmp-b'))),
    el('div', { class: 'table-scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, [el('th', { text: 'Student' }), el('th', { text: `${milestone?.label ?? 'Milestone'} starts` }), el('th', { text: 'Graduation' })])),
      el('tbody', {}, row(`A: ${ui.compare.a}`, planA), row(`B: ${ui.compare.b}`, planB)))),
    el('ul', {}, lines.map((l) => el('li', { text: l }))),
    named.length
      ? el('div', {}, el('h3', { text: 'Courses responsible for the difference' }),
        el('ul', {}, named.map((r) => el('li', {},
          el('b', { text: r.course }),
          ` sits in ${termName(r.term)} in the ${r.in_plan === 'changed plan' ? 'plan for student B' : 'plan for student A'}`,
          r.other_term ? ` and in ${termName(r.other_term)} in the other plan.` : ' and does not appear in the other plan.',
          ` ${reasonText(r.reason)}`))))
      : null);
}

// ---------------------------------------------------------------- next term

function renderNext(root, result) {
  const { scenario, baseline } = result;
  const catalog = scenario.catalog;
  const plan = scenario.plan;
  const banner = diffBanner(result);
  if (banner) root.append(banner);

  if (plan.terms.length === 0) {
    root.append(el('p', { text: 'The plan has no terms yet. Check that you still have courses to take.' }));
    return;
  }
  const withData = plan.terms.filter((t) => scenario.schedules[t.term]);
  if (!ui.next.term || !plan.terms.some((t) => t.term === ui.next.term)) {
    ui.next.term = (withData[0] ?? plan.terms[0]).term;
    ui.next.pick = 0;
  }
  const term = ui.next.term;
  const schedule = scenario.schedules[term] ?? null;
  const planned = plan.terms.find((t) => t.term === term);

  root.append(el('section', { class: 'panel' },
    el('h2', { text: 'Section combinations for one term' }),
    el('p', { class: 'small muted', text: 'The planner tries every combination of sections for the courses planned in this term. It keeps combinations with no time overlaps and ranks them by fewest days on campus, then fewest classes that start before 9:00 a.m.' }),
    el('div', { class: 'row' },
      el('label', { class: 'field-inline', for: 'next-term' }, 'Term',
        el('select', { id: 'next-term', value: term, onchange: (e) => { ui.next.term = e.target.value; ui.next.pick = 0; render(); } },
          plan.terms.slice(0, 10).map((t) => el('option', { value: t.term, text: `${t.label}${scenario.schedules[t.term] ? '' : ' (no schedule data)'}` })))),
      el('span', { class: 'muted small', text: `Courses planned: ${planned.courses.map((c) => c.course).join(', ') || 'none'}` }))));

  if (!schedule) {
    root.append(el('div', { class: 'notice warn' },
      el('p', { text: `There is no schedule data for ${termName(term)}.` }),
      el('p', { text: 'MTSU posts sections only for terms open for registration. Pick a term marked with data, or run the importer after the new term appears. Without section times the planner cannot check for overlaps.' })));
    return;
  }
  if (planned.courses.length === 0) {
    root.append(el('p', { text: 'No courses are planned in this term.' }));
    return;
  }

  const t = W.termTimetable({ plan, catalog, schedule, term, limit: 12 });
  const pairs = TT.incompatiblePairs({ courses: t.courses, catalog, schedule });
  const colorOf = Object.fromEntries(t.courses.map((c, i) => [c, i % 8 + 1]));

  if (t.no_sections.length) {
    root.append(el('div', { class: 'notice warn' },
      el('p', { text: 'These planned courses have no sections in the schedule for this term:' }),
      el('ul', {}, t.no_sections.map((n) => el('li', { text: `${n.course}: no sections for ${n.missing.join(', ')}` }))),
      el('p', { text: 'They are left out of the combinations below.' })));
  }

  if (t.options.length) {
    if (ui.next.pick >= t.options.length) ui.next.pick = 0;
    const chosen = t.options[ui.next.pick];
    root.append(el('section', { class: 'panel' },
      el('h3', { text: ui.next.pick === 0 ? 'Best combination' : `Combination ${ui.next.pick + 1}` }),
      el('p', {},
        tag(`${plural(chosen.campus_days, 'day')} on campus`, 'info'), ' ',
        tag(`${classes(chosen.early_classes)} before 9:00 a.m.`, chosen.early_classes ? 'warn' : 'ok'), ' ',
        t.truncated ? tag('search stopped early', 'warn') : tag(`${t.total} fit${t.total === 1 ? 's' : ''} without overlaps`, '')),
      weekGrid(chosen, colorOf),
      sectionTable(chosen, colorOf)));
    if (t.options.length > 1) {
      root.append(el('section', { class: 'panel' },
        el('h3', { text: 'Other combinations' }),
        el('div', { class: 'option-list' }, t.options.map((o, i) => el('label', { class: i === ui.next.pick ? 'selected' : '' },
          el('input', { type: 'radio', name: 'pick', checked: i === ui.next.pick, onchange: () => { ui.next.pick = i; render(); } }),
          el('span', {}, el('b', { text: `${i === 0 ? 'Best: ' : ''}${plural(o.campus_days, 'day')} on campus, ${o.early_classes} before 9:00 a.m.` }),
            el('br'),
            el('span', { class: 'small muted', text: o.choices.map((c) => `${c.component} ${c.section}`).join(', ') })))))));
    }
  }

  if (t.conflicts.length) {
    root.append(el('section', { class: 'panel' },
      el('h3', { text: 'No combination fits' }),
      t.conflicts.map((c) => conflictBlock(c, catalog, term))));
  }

  if (pairs.length) {
    root.append(el('section', { class: 'panel' },
      el('h3', { text: 'Course pairs that can never fit together this term' }),
      el('p', { class: 'small muted', text: 'Every section of the first course overlaps every section of the second.' }),
      el('ul', {}, pairs.map(([a, b]) => el('li', { text: `${a} and ${b}` })))));
  } else if (t.options.length) {
    root.append(el('p', { class: 'muted small', text: 'Every pair of planned courses has at least one section pairing without an overlap.' }));
  }

  if (state.edits.length) {
    const base = W.termTimetable({ plan: baseline.plan, catalog: baseline.catalog, schedule: baseline.schedules[term] ?? null, term, limit: 12 });
    root.append(timetableDiffPanel(term, base, t));
  }
}

function timetableDiffPanel(term, base, alt) {
  if (!base.available) return null;
  const d = W.diffTimetables(base, alt);
  const best = (b) => (b ? `${plural(b.campus_days, 'day')} on campus, ${classes(b.early_classes)} before 9:00 a.m.` : 'no combination fits');
  return el('section', { class: 'panel' },
    el('h3', { text: `Compared with the baseline for ${termName(term)}` }),
    el('table', {}, el('tbody', {},
      el('tr', {}, el('th', { text: 'Combinations without overlaps' }), el('td', { text: `Baseline ${d.total.base}` }), el('td', { text: `Changed ${d.total.alt}` })),
      el('tr', {}, el('th', { text: 'Best combination' }), el('td', { text: `Baseline: ${best(d.best.base)}` }), el('td', { text: `Changed: ${best(d.best.alt)}` })),
      el('tr', {}, el('th', { text: 'Course pairs that conflict' }), el('td', { text: d.base_conflicts.map((c) => c.join(' + ')).join('; ') || 'None' }), el('td', { text: d.alt_conflicts.map((c) => c.join(' + ')).join('; ') || 'None' })))));
}

function conflictBlock(conflict, catalog, term) {
  return el('div', { class: 'notice bad' },
    el('p', {}, el('b', { text: conflict.courses.join(' and ') }), ': ', conflict.reason),
    conflict.examples.length
      ? el('ul', {}, conflict.examples.map((e) => el('li', {},
        `${e.a.component} section ${e.a.section} (${e.a.meetings.map(meetingText).join('; ')}) overlaps ${e.b.component} section ${e.b.section} (${e.b.meetings.map(meetingText).join('; ')}).`)))
      : null,
    el('p', {}, el('b', { text: 'What could move' })),
    el('ul', {}, conflict.resolutions.map((r) => el('li', {},
      el('b', { text: r.course }),
      r.can_move
        ? ` can move to ${termName(r.move_to)} without delaying graduation.`
        : ' cannot move without delaying graduation.',
      r.fits_without ? ' Everything else then fits.' : ' The remaining courses still conflict.'))));
}

function weekGrid(option, colorOf) {
  const meetings = option.choices.flatMap((c) => c.meetings.map((m) => ({ ...m, choice: c })));
  const hasSat = meetings.some((m) => m.days.includes('S'));
  const days = hasSat ? WEEK_DAYS : WEEK_DAYS.slice(0, 5);
  const startHour = meetings.length ? Math.min(8, Math.floor(Math.min(...meetings.map((m) => T0(m.start))) / 60)) : 8;
  const endHour = meetings.length ? Math.max(17, Math.ceil(Math.max(...meetings.map((m) => T0(m.end))) / 60)) : 17;
  const hours = endHour - startHour;
  const hourHeight = 40;
  const grid = el('div', { class: 'week-inner', style: `--days:${days.length};--hours:${hours};--hour-h:${hourHeight}px` });
  grid.append(el('div', { class: 'week-head' }), ...days.map(([, name]) => el('div', { class: 'week-head', text: name })));
  const times = el('div', { class: 'week-times' });
  for (let h = startHour; h <= endHour; h += 1) {
    if (h === endHour) break;
    times.append(el('span', { style: `top:${(h - startHour) * hourHeight}px`, text: formatTime(`${String(h).padStart(2, '0')}:00`).replace(':00', '') }));
  }
  grid.append(times);
  for (const [letter] of days) {
    const col = el('div', { class: 'week-col' });
    for (const m of meetings.filter((x) => x.days.includes(letter))) {
      const top = ((T0(m.start) - startHour * 60) / 60) * hourHeight;
      const height = Math.max(18, ((T0(m.end) - T0(m.start)) / 60) * hourHeight - 2);
      col.append(el('div', { class: `block c${colorOf[m.choice.course]}`, style: `top:${top}px;height:${height}px`, title: `${m.choice.title} ${meetingText(m)} ${m.location}` },
        el('b', { text: m.choice.component }),
        `${formatTime(m.start).replace(' ', '')}`,
        m.location ? el('div', { text: m.location }) : null));
    }
    grid.append(col);
  }
  return el('div', { class: 'week', role: 'img', 'aria-label': 'Weekly grid of the chosen sections. The table under it lists the same sections.' }, grid);
}

function T0(hhmm) {
  return TT.toMinutes(hhmm);
}

function sectionTable(option, colorOf) {
  return el('div', { class: 'table-scroll' }, el('table', {},
    el('thead', {}, el('tr', {}, ['Course', 'Section', 'CRN', 'When', 'Where', 'Instructor'].map((h) => el('th', { text: h })))),
    el('tbody', {}, option.choices.map((c) => el('tr', {},
      el('td', {}, el('span', { class: `tag`, style: `background:var(--c${colorOf[c.course]})`, text: c.component })),
      el('td', { text: c.section }),
      el('td', { text: c.crn }),
      el('td', { text: c.meetings.length ? c.meetings.map(meetingText).join('; ') : (c.online ? 'Online, no set time' : 'Time to be announced') }),
      el('td', { text: [...new Set(c.meetings.map((m) => m.location).filter(Boolean))].join(', ') }),
      el('td', { text: c.instructor }))))));
}

// ------------------------------------------------------------------ what-if

function parsePrereqText(mode, text) {
  if (mode === 'none') return { value: null };
  const items = text.split(',').map((s) => s.trim()).filter(Boolean).map((token) => {
    const concurrent = /\(same term\)/i.test(token);
    const course = token.replace(/\(same term\)/i, '').trim().toUpperCase().replace(/\s+/g, ' ');
    return { course, concurrent };
  });
  if (items.length === 0) return { error: 'List at least one course, or choose "No prerequisites".' };
  const list = items.map((i) => (i.concurrent ? { course: i.course, concurrent_ok: true } : i.course));
  return { value: { [mode]: list }, courses: items.map((i) => i.course) };
}

function editDetail(edit, catalog) {
  switch (edit.type) {
    case 'set_prereqs': return `New prerequisites: ${P.describePrereqs(edit.prereqs ?? null)}.`;
    case 'set_meeting_pattern': return `${termName(edit.term)}${edit.section ? `, section ${edit.section}` : ', all sections'}: ${edit.meetings.map(meetingText).join('; ') || 'no set meetings'}.`;
    case 'move_requirement': {
      const req = catalog.requirements.find((r) => r.id === edit.to);
      return req ? `${req.type === 'choose' ? 'It becomes one of the elective choices' : 'It becomes a required course'} (${edit.to}).` : '';
    }
    default: return '';
  }
}

function renderWhatIf(root, result) {
  const { scenario, baseline, diff } = result;
  const catalog = baseline.catalog;
  const ids = Object.keys(catalog.courses);
  const w = ui.whatif;
  if (!w.draft.course || !ids.includes(w.draft.course)) w.draft.course = ids.includes('ENGR 3530') ? 'ENGR 3530' : ids[0];

  const errorsByPosition = new Map(result.edit_errors.map((e) => [e.position, e.message]));

  // ---- edit list
  const list = el('ol', { class: 'edit-list' });
  state.edits.forEach((edit, i) => {
    const bad = errorsByPosition.get(i);
    list.append(el('li', { class: bad ? 'bad' : '' },
      el('div', {}, el('b', { text: W.describeEdit(edit) }), el('div', { class: 'small muted', text: editDetail(edit, catalog) }),
        bad ? el('div', { class: 'small', text: `Skipped: ${bad}` }) : null),
      el('div', { class: 'row tight' },
        el('button', { type: 'button', class: 'small-btn', text: 'Up', disabled: i === 0, 'aria-label': `Move edit ${i + 1} up`, onclick: () => update((s) => { [s.edits[i - 1], s.edits[i]] = [s.edits[i], s.edits[i - 1]]; }) }),
        el('button', { type: 'button', class: 'small-btn', text: 'Down', disabled: i === state.edits.length - 1, 'aria-label': `Move edit ${i + 1} down`, onclick: () => update((s) => { [s.edits[i + 1], s.edits[i]] = [s.edits[i], s.edits[i + 1]]; }) }),
        el('button', { type: 'button', class: 'small-btn danger', text: 'Remove', 'aria-label': `Remove edit ${i + 1}`, onclick: () => update((s) => { s.edits.splice(i, 1); }) }))));
  });

  const examples = [];
  if (ids.includes('ENGR 3530')) {
    examples.push(el('button', { type: 'button', text: 'Example: make ENGR 3530 fall only', onclick: () => update((s) => { s.edits.push({ type: 'set_seasons', course: 'ENGR 3530', regular_seasons: ['fall'] }); }) }));
  }

  root.append(el('section', { class: 'panel' },
    el('h2', { text: 'What-if changes' }),
    el('p', { class: 'small muted', text: 'Describe a change the department might make. Each edit applies on top of the ones above it. Every result on every tab shows the difference from the unchanged baseline.' }),
    state.edits.length ? list : el('p', { class: 'muted', text: 'No edits yet.' }),
    el('div', { class: 'row' }, examples,
      state.edits.length ? el('button', { type: 'button', class: 'danger', text: 'Remove all edits', onclick: () => update((s) => { s.edits = []; }) }) : null)));

  root.append(editForm(catalog, scenario));

  // ---- results
  if (state.edits.length === 0) {
    root.append(el('p', { class: 'muted', text: 'Add an edit to see how the critical path, the plan, and the timetable change.' }));
    return;
  }
  if (result.new_problems.length) {
    root.append(el('div', { class: 'notice bad' },
      el('p', { text: 'These edits create problems in the catalog:' }),
      el('ul', {}, result.new_problems.map((p) => el('li', { text: p.message })))));
  }
  root.append(resultsPanel(result));
  root.append(timetableImpact(result));
}

function resultsPanel(result) {
  const { diff } = result;
  const base = result.baseline.plan;
  const alt = result.scenario.plan;
  const lines = W.summarizeDiff(diff);
  const moved = diff.moved.slice(0, 40);
  const slack = diff.critical.slack_changes.filter((c) => c.from !== null || c.to !== null).slice(0, 40);
  const responsible = Object.entries(diff.responsible).flatMap(([key, list]) => list.map((r) => ({ key, ...r })));
  return el('section', { class: 'panel' },
    el('h2', { text: 'Difference from the baseline' }),
    planSummary(result),
    el('ul', {}, lines.map((l) => el('li', { text: l }))),
    el('h3', { text: 'Critical path' }),
    el('div', { class: 'table-scroll' }, el('table', {}, el('tbody', {},
      el('tr', {}, el('th', { text: 'Baseline' }), el('td', { text: base.analysis.critical.join(', ') || 'None' })),
      el('tr', {}, el('th', { text: 'With your edits' }), el('td', { text: alt.analysis.critical.join(', ') || 'None' })),
      el('tr', {}, el('th', { text: 'Joined' }), el('td', { text: diff.critical.added.join(', ') || 'None' })),
      el('tr', {}, el('th', { text: 'Left' }), el('td', { text: diff.critical.removed.join(', ') || 'None' }))))),
    slack.length ? el('div', {},
      el('h3', { text: 'Slack that changed' }),
      el('div', { class: 'table-scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Course', 'Baseline slack', 'New slack'].map((h) => el('th', { text: h })))),
        el('tbody', {}, slack.map((c) => el('tr', {}, el('td', { text: c.course }), el('td', { text: c.from === null ? 'none' : String(c.from) }), el('td', { text: c.to === null ? 'none' : String(c.to) }))))))) : null,
    moved.length ? el('div', {},
      el('h3', { text: 'Courses that moved' }),
      el('div', { class: 'table-scroll' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Course', 'Baseline', 'With your edits'].map((h) => el('th', { text: h })))),
        el('tbody', {}, moved.map((c) => el('tr', {}, el('td', { text: c.course }), el('td', { text: c.from ? termName(c.from) : 'not in plan' }), el('td', { text: c.to ? termName(c.to) : 'not in plan' }))))))) : null,
    responsible.length ? el('div', {},
      el('h3', { text: 'Courses responsible for the delay' }),
      el('ul', {}, responsible.map((r) => el('li', {}, el('b', { text: r.course }), ` is in ${termName(r.term)} in the ${r.in_plan}${r.other_term ? ` and in ${termName(r.other_term)} in the other plan` : ' and not in the other plan'}. ${reasonText(r.reason)}`)))) : null);
}

function timetableImpact(result) {
  const terms = [...new Set(state.edits.filter((e) => e.type === 'set_meeting_pattern').map((e) => e.term))];
  if (terms.length === 0) return null;
  const panels = terms.map((term) => {
    const base = W.termTimetable({ plan: result.baseline.plan, catalog: result.baseline.catalog, schedule: result.baseline.schedules[term] ?? null, term, limit: 3 });
    const alt = W.termTimetable({ plan: result.scenario.plan, catalog: result.scenario.catalog, schedule: result.scenario.schedules[term] ?? null, term, limit: 3 });
    if (!base.available && !alt.available) {
      return el('p', { class: 'muted', text: `No schedule data for ${termName(term)}, so there is nothing to compare.` });
    }
    return timetableDiffPanel(term, base, alt) ?? el('p', { class: 'muted', text: `The baseline has no schedule data for ${termName(term)}. The changed plan uses only the sections you described.` });
  });
  return el('section', { class: 'panel' }, el('h2', { text: 'Timetable impact' }), panels);
}

function editForm(catalog, scenario) {
  const w = ui.whatif;
  const d = w.draft;
  const ids = Object.keys(catalog.courses);
  const analysis = scenario.plan.analysis;

  const typeSelect = el('select', {
    id: 'edit-type', value: d.type,
    onchange: (e) => { w.draft = { type: e.target.value, course: d.course }; w.error = ''; render(); },
  }, [
    ['set_prereqs', 'Change prerequisites'],
    ['set_seasons', 'Change offered seasons'],
    ['set_credits', 'Change credit hours'],
    ['move_requirement', 'Move between required and elective'],
    ['set_meeting_pattern', 'Replace the meeting pattern'],
  ].map(([value, text]) => el('option', { value, text })));

  const courseSelect = el('select', {
    id: 'edit-course', value: d.course,
    onchange: (e) => { w.draft = { type: d.type, course: e.target.value }; render(); },
  }, ids.map((id) => el('option', { value: id, text: courseLabel(catalog, id) })));

  const fields = [];
  const def = catalog.courses[d.course];

  if (d.type === 'set_prereqs') {
    d.mode = d.mode ?? 'all';
    if (d.text === undefined) d.text = '';
    fields.push(
      el('p', { class: 'small muted', text: `Current prerequisites: ${P.describePrereqs(def.prereqs)}` }),
      el('div', { class: 'field' }, el('label', { for: 'pr-mode', class: 'label', text: 'The student needs' }),
        el('select', { id: 'pr-mode', value: d.mode, onchange: (e) => { d.mode = e.target.value; render(); } },
          el('option', { value: 'all', text: 'All of these courses' }),
          el('option', { value: 'any', text: 'Any one of these courses' }),
          el('option', { value: 'none', text: 'No prerequisites' }))),
      d.mode === 'none' ? null : el('div', { class: 'field' },
        el('label', { for: 'pr-text', class: 'label', text: 'Courses' }),
        el('input', { id: 'pr-text', type: 'text', value: d.text, placeholder: 'MATH 1910, ENGR 2100 (same term)', onchange: (e) => { d.text = e.target.value; } }),
        el('span', { class: 'hint', text: 'Separate courses with commas. Add "(same term)" after a course that may be taken at the same time.' })));
  } else if (d.type === 'set_seasons') {
    const current = analysis.courses[d.course]?.seasons ?? [];
    d.seasons = d.seasons ?? [...current];
    fields.push(el('div', { class: 'field' }, el('span', { class: 'label', text: 'The course runs in' }),
      el('div', { class: 'row tight' }, ['fall', 'spring', 'summer'].map((s) => el('label', { class: 'check' },
        el('input', { type: 'checkbox', checked: d.seasons.includes(s), onchange: (e) => { d.seasons = e.target.checked ? [...new Set([...d.seasons, s])] : d.seasons.filter((x) => x !== s); } }),
        s))),
      el('span', { class: 'hint', text: `Now: ${current.join(' and ') || 'no season'}.` })));
  } else if (d.type === 'set_credits') {
    d.credits = d.credits ?? def.credits;
    fields.push(el('div', { class: 'field' }, el('label', { for: 'cr', class: 'label', text: 'Credit hours' }),
      el('input', { id: 'cr', type: 'number', min: 1, max: 12, value: d.credits, onchange: (e) => { d.credits = Number(e.target.value); } })));
  } else if (d.type === 'move_requirement') {
    const targets = catalog.requirements.filter((r) => r.type === 'all' || r.type === 'choose');
    d.to = d.to ?? targets[0]?.id;
    fields.push(el('div', { class: 'field' }, el('label', { for: 'mv', class: 'label', text: 'Move to' }),
      el('select', { id: 'mv', value: d.to, onchange: (e) => { d.to = e.target.value; } },
        targets.map((r) => el('option', { value: r.id, text: `${r.type === 'choose' ? 'Elective choice' : 'Required'}: ${r.id}` })))));
  } else if (d.type === 'set_meeting_pattern') {
    const termIds = [...new Set([...Object.keys(scenario.schedules), ...scenario.plan.terms.slice(0, 8).map((t) => t.term)])].sort((a, b) => T.compareTerms(a, b));
    d.term = d.term ?? termIds[0];
    fields.push(
      el('div', { class: 'row' },
        el('div', { class: 'field' }, el('label', { for: 'mp-term', class: 'label', text: 'Term' }),
          el('select', { id: 'mp-term', value: d.term, onchange: (e) => { d.term = e.target.value; } }, termIds.map((t) => el('option', { value: t, text: termName(t) })))),
        el('div', { class: 'field' }, el('label', { for: 'mp-section', class: 'label', text: 'Sections' }),
          el('input', { id: 'mp-section', type: 'text', value: d.section ?? '', placeholder: 'All sections', onchange: (e) => { d.section = e.target.value.trim() || undefined; } }))),
      el('span', { class: 'label', text: 'New meetings' }),
      w.meetings.map((m, i) => el('div', { class: 'meeting-row' },
        el('span', { class: 'day-picks' }, 'MTWRFS'.split('').map((letter) => el('label', {},
          el('input', { type: 'checkbox', checked: m.days.includes(letter), 'aria-label': `Day ${letter}`, onchange: (e) => {
            const set = new Set(m.days.split(''));
            if (e.target.checked) set.add(letter); else set.delete(letter);
            m.days = [...set].sort((a, b) => 'MTWRFS'.indexOf(a) - 'MTWRFS'.indexOf(b)).join('');
          } }), letter))),
        el('input', { type: 'time', value: m.start, 'aria-label': 'Start time', onchange: (e) => { m.start = e.target.value; } }),
        ' to ',
        el('input', { type: 'time', value: m.end, 'aria-label': 'End time', onchange: (e) => { m.end = e.target.value; } }),
        el('button', { type: 'button', class: 'small-btn danger', text: 'Remove', disabled: w.meetings.length === 1, onclick: () => { w.meetings.splice(i, 1); render(); } }))),
      el('button', { type: 'button', class: 'small-btn', text: 'Add a meeting', onclick: () => { w.meetings.push({ days: 'MWF', start: '09:00', end: '09:50' }); render(); } }),
      el('p', { class: 'hint small muted', text: 'Letters: M Monday, T Tuesday, W Wednesday, R Thursday, F Friday, S Saturday. If the term has no section of this course, the edit adds one.' }));
  }

  const add = () => {
    w.error = '';
    let edit;
    if (d.type === 'set_prereqs') {
      const parsed = parsePrereqText(d.mode, d.text ?? '');
      if (parsed.error) { w.error = parsed.error; render(); return; }
      const unknown = (parsed.courses ?? []).filter((c) => !catalog.courses[c]);
      if (unknown.length) { w.error = `These courses are not in the catalog: ${unknown.join(', ')}.`; render(); return; }
      edit = { type: 'set_prereqs', course: d.course, prereqs: parsed.value };
    } else if (d.type === 'set_seasons') {
      edit = { type: 'set_seasons', course: d.course, regular_seasons: d.seasons };
    } else if (d.type === 'set_credits') {
      if (!(d.credits > 0)) { w.error = 'Enter a positive number of credit hours.'; render(); return; }
      edit = { type: 'set_credits', course: d.course, credits: d.credits };
    } else if (d.type === 'move_requirement') {
      edit = { type: 'move_requirement', course: d.course, to: d.to };
    } else {
      const meetings = w.meetings.map((m) => ({ days: m.days, start: m.start, end: m.end }));
      if (meetings.some((m) => !m.days || !m.start || !m.end || m.end <= m.start)) { w.error = 'Each meeting needs at least one day and an end time after its start time.'; render(); return; }
      edit = { type: 'set_meeting_pattern', course: d.course, term: d.term, meetings };
      if (d.section) edit.section = d.section;
    }
    update((s) => { s.edits.push(edit); });
  };

  return el('section', { class: 'panel' },
    el('h3', { text: 'Add an edit' }),
    el('div', { class: 'row' },
      el('div', { class: 'field' }, el('label', { for: 'edit-type', class: 'label', text: 'Kind of change' }), typeSelect),
      el('div', { class: 'field' }, el('label', { for: 'edit-course', class: 'label', text: 'Course' }), courseSelect)),
    fields,
    w.error ? el('div', { class: 'notice bad' }, el('p', { text: w.error })) : null,
    el('button', { type: 'button', class: 'primary', text: 'Add this edit', onclick: add }));
}

// ------------------------------------------------------------------- render

function renderTabs() {
  const tabs = clear($('#tabs'));
  VIEWS.forEach(([id, label]) => {
    tabs.append(el('button', {
      type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': view === id ? 'true' : 'false', 'aria-controls': 'main',
      tabindex: view === id ? '0' : '-1',
      onclick: () => { view = id; location.hash = id; render(); window.scrollTo(0, 0); },
      onkeydown: (e) => {
        const i = VIEWS.findIndex(([v]) => v === view);
        if (e.key === 'ArrowRight') { view = VIEWS[(i + 1) % VIEWS.length][0]; render(); $(`#tab-${view}`).focus(); }
        if (e.key === 'ArrowLeft') { view = VIEWS[(i + VIEWS.length - 1) % VIEWS.length][0]; render(); $(`#tab-${view}`).focus(); }
      },
      text: label,
    }));
  });
}

function renderHeader() {
  const years = Object.keys(data.catalogs);
  const select = clear($('#catalog-year'));
  if (years.length === 0) select.append(el('option', { text: 'none loaded' }));
  years.forEach((y) => select.append(el('option', { value: y, text: y, selected: y === state.catalog_year })));
  const catalog = data.catalogs[state.catalog_year];
  $('#program').textContent = catalog ? `${catalog.program}, catalog ${catalog.catalog_year}` : 'Mechatronics Engineering, B.S.';
}

function render() {
  const scrollY = window.scrollY;
  renderTabs();
  renderHeader();
  renderFooterNote();
  const result = compute();
  renderNotices(result);
  const main = clear($('#main'));
  main.setAttribute('aria-labelledby', `tab-${view}`);
  if (!result || result.error) {
    main.append(el('p', { class: 'muted', text: result?.error ? 'Fix the problem above to see results.' : 'Add the catalog data to begin.' }));
    return;
  }
  const make = { graph: renderGraph, plan: renderPlan, next: renderNext, whatif: renderWhatIf }[view];
  make(main, result);
  window.scrollTo(0, scrollY);
}

// -------------------------------------------------------- export and import

function exportState() {
  const text = JSON.stringify({ version: 1, ...state }, null, 2);
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = el('a', { href: url, download: 'mtsu-degree-plan.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.prompt('Copy this text and save it in a file:', text);
  }
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state = sanitizeState(parsed, state.catalog_year);
      if (!data.catalogs[state.catalog_year]) state.catalog_year = Object.keys(data.catalogs)[0] ?? state.catalog_year;
      saveState();
      render();
    } catch {
      window.alert('That file is not a saved plan from this page.');
    }
  };
  reader.readAsText(file);
}

// -------------------------------------------------------------------- theme

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');
  const label = { light: 'Light', dark: 'Dark' }[choice] ?? 'Auto';
  $('#btn-theme').textContent = `Theme: ${label}`;
}

function setupTheme() {
  let choice = storageGet(THEME_KEY) ?? 'auto';
  applyTheme(choice);
  $('#btn-theme').addEventListener('click', () => {
    choice = { auto: 'light', light: 'dark', dark: 'auto' }[choice] ?? 'auto';
    storageSet(THEME_KEY, choice);
    applyTheme(choice);
    render();
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());
  }
}

// --------------------------------------------------------------------- boot

async function main() {
  setupTheme();
  const wanted = location.hash.replace('#', '');
  if (VIEWS.some(([id]) => id === wanted)) view = wanted;
  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#', '');
    if (VIEWS.some(([id]) => id === next) && next !== view) { view = next; render(); }
  });

  $('#catalog-year').addEventListener('change', (e) => update((s) => { s.catalog_year = e.target.value; s.completed = []; s.in_progress = []; s.choices = {}; s.edits = []; s.options.target_term = null; }));
  $('#btn-export').addEventListener('click', exportState);
  $('#file-import').addEventListener('change', (e) => { if (e.target.files[0]) importState(e.target.files[0]); e.target.value = ''; });
  $('#btn-reset').addEventListener('click', () => {
    if (window.confirm('Clear all of your choices and edits on this device?')) {
      storageRemove(STORAGE_KEY);
      state = defaultState(Object.keys(data.catalogs)[0] ?? CATALOG_YEARS[0]);
      ui.graph.selected = null;
      render();
    }
  });

  clear($('#main')).append(el('p', { class: 'muted', text: 'Loading data...' }));
  data = await loadData();
  const years = Object.keys(data.catalogs);
  state = loadSavedState(years[0] ?? CATALOG_YEARS[0]);
  if (years.length && !years.includes(state.catalog_year)) state.catalog_year = years[0];
  render();
}

main();
