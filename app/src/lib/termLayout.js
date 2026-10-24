// Fixed layout of the Term view. Each academic map semester is a column, in order from Year 1 Fall to Year 4 Spring.
// Required courses sit at the top of their column and elective options sit below a divider. The wide layout puts
// Years 1 and 2 in a top band and Years 3 and 4 in a band below it, so the whole map fits a laptop screen at a
// readable size. A narrow layout stacks the semesters in one column for phones.

import { TILE_W, TILE_H, GAP, PAD, HEADER, FLOW_COURSE_IDS } from './mapLayout.js';
import { mapPositionOf, semesterLabel } from './exploreModel.js';
import { ELECTIVE_REQUIREMENT } from './planModel.js';

const COL_GAP = 28;
const ROW_GAP = 32;
const BAND_YEARS = 2;        // academic years in each band of the wide layout
const WIDE_ELECTIVES = 4;    // a column with this many electives or more is two tiles wide
export const DIVIDER = 30;   // room for the "Elective options" line inside a column

function isElective(catalog, id) {
  return (catalog.requirements ?? []).some((r) => r.id === ELECTIVE_REQUIREMENT && r.options?.includes(id));
}

/** Courses in each academic map semester: `[{ position, label, required, electives }]`, earliest first. */
export function termColumns(catalog, ids = FLOW_COURSE_IDS) {
  const byPos = new Map();
  for (const id of ids) {
    if (!catalog.courses[id]) continue;
    const pos = mapPositionOf(catalog, id) ?? 99;
    if (!byPos.has(pos)) byPos.set(pos, { position: pos, label: pos === 99 ? 'Any semester' : semesterLabel(pos), required: [], electives: [] });
    byPos.get(pos)[isElective(catalog, id) ? 'electives' : 'required'].push(id);
  }
  const cols = [...byPos.values()].sort((a, b) => a.position - b.position);
  for (const c of cols) { c.required.sort(); c.electives.sort(); }
  return cols;
}

function columnSize(col, perRow) {
  const rows = (n) => Math.ceil(n / perRow);
  const tileRows = (n) => (n ? rows(n) * TILE_H + (rows(n) - 1) * GAP : 0);
  const reqH = tileRows(col.required.length);
  const elecH = col.electives.length ? DIVIDER + tileRows(col.electives.length) + (col.required.length ? GAP : 0) : 0;
  return {
    w: PAD * 2 + perRow * TILE_W + (perRow - 1) * GAP,
    h: HEADER + PAD + reqH + elecH + PAD,
  };
}

/**
 * Columns and course tiles for the wide or the narrow layout, in the same shape as `flowLayout`:
 * `{ groups, tiles, bounds }`. Each group carries `dividerY`, the offset of the elective divider inside it, or null.
 */
export function termLayout(catalog, narrow = false) {
  const cols = termColumns(catalog);
  const groups = [];
  const tiles = {};
  let x = 0;
  let y = 0;
  let band = null;
  let bandH = 0;
  for (const col of cols) {
    const perRow = narrow || col.electives.length >= WIDE_ELECTIVES ? 2 : 1;
    const size = columnSize(col, perRow);
    const colBand = Math.floor(Math.floor(col.position / 3) / BAND_YEARS);
    if (!narrow && band !== null && colBand !== band) { x = 0; y += bandH + ROW_GAP; bandH = 0; }
    band = colBand;
    bandH = Math.max(bandH, size.h);
    const g = {
      id: `term-${col.position}`, kind: 'term', label: col.label, subject: 'term', x, y, ...size,
      count: col.required.length + col.electives.length, dividerY: null,
    };
    const place = (list, top) => list.forEach((id, i) => {
      tiles[id] = {
        x: x + PAD + (i % perRow) * (TILE_W + GAP),
        y: top + Math.floor(i / perRow) * (TILE_H + GAP),
        w: TILE_W, h: TILE_H, group: g.id,
      };
    });
    const top = y + HEADER + PAD;
    place(col.required, top);
    if (col.electives.length) {
      const reqRows = Math.ceil(col.required.length / perRow);
      const dividerTop = top + (reqRows ? reqRows * (TILE_H + GAP) : 0);
      g.dividerY = dividerTop - y;
      place(col.electives, dividerTop + DIVIDER);
    }
    groups.push(g);
    if (narrow) y += size.h + ROW_GAP;
    else x += size.w + COL_GAP;
  }
  let w = 0;
  let h = 0;
  for (const g of groups) { w = Math.max(w, g.x + g.w); h = Math.max(h, g.y + g.h); }
  return { groups, tiles, bounds: { w, h } };
}
