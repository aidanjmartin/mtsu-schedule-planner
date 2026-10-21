// Data and geometry for the Explore map. Everything here is a pure function, so it runs in Node tests as well as
// in the browser. The map is drawn in "world" units: each area has a center, and each course sits on a ring around it.

import { prereqs as P } from './engine.js';
import { tileLabel, directUnlocks } from './courseGraph.js';

// ------------------------------------------------------------------ areas

/** Subject colors, from the interface specification. `css` names a color token pair in tokens.css. */
export const SUBJECTS = [
  { key: 'math', css: 'math', label: 'Math & Science', ids: ['MATH 1910', 'MATH 1920', 'MATH 2010', 'MATH 3110', 'MATH 3120', 'PHYS 2110', 'PHYS 2120', 'CHEM 1110', 'CSCI 1170'] },
  { key: 'found', css: 'found', label: 'Engineering Foundations', ids: ['ENGR 1100', 'ENGR 2100', 'ENGR 2210', 'ENGR 4500'] },
  { key: 'mech', css: 'mech', label: 'Mechanics', ids: ['ENGR 2110', 'ENGR 2120', 'ENGR 3550', 'ENGR 3560', 'ENGR 3590'] },
  { key: 'circ', css: 'circ', label: 'Circuits, Electronics & Automation', ids: ['ENGR 2130', 'ENGR 3510', 'ENGR 3520', 'ENGR 3530', 'ENGR 4510', 'ENGR 4520'] },
  { key: 'ctrl', css: 'ctrl', label: 'Controls', ids: ['ENGR 3540', 'ENGR 4530'] },
  { key: 'senior', css: 'senior', label: 'Senior Design', ids: ['ENGR 4580', 'ENGR 4590'] },
  { key: 'elective', css: 'elective', label: 'Electives', ids: ['ENGR 3915', 'ENGR 3970', 'ENGR 4540', 'ENGR 4550', 'ENGR 4560', 'ENGR 4570', 'ENGR 4600', 'ENGR 4610'] },
];

export const SUBJECT_OF = Object.fromEntries(SUBJECTS.flatMap((s) => s.ids.map((id) => [id, s])));

/**
 * The six areas, in the order they stack on a phone. `semesters` areas order their ring by academic map semester and
 * label each semester. The others order their ring by course number.
 */
export const AREAS = [
  {
    id: 'core', kind: 'core', semesters: true, tone: 'blue', closedR: 104,
    label: [{ text: 'Core' }, { text: 'Years 1 and 2', muted: true }], name: 'Core, Years 1 and 2',
    ids: ['MATH 1910', 'MATH 1920', 'MATH 3110', 'MATH 3120', 'PHYS 2110', 'PHYS 2120', 'CHEM 1110', 'CSCI 1170', 'ENGR 1100', 'ENGR 2100', 'ENGR 2110', 'ENGR 2120', 'ENGR 2130', 'ENGR 2210'],
  },
  {
    id: 'required', kind: 'required', semesters: true, tone: 'blue', closedR: 88,
    label: [{ text: 'Required' }, { text: 'Years 3 and 4', muted: true }], name: 'Required, Years 3 and 4',
    ids: ['ENGR 3510', 'ENGR 3520', 'ENGR 3530', 'ENGR 3540', 'ENGR 3550', 'ENGR 3560', 'ENGR 3590', 'ENGR 4500', 'ENGR 4510', 'ENGR 4520', 'ENGR 4530', 'ENGR 4580', 'ENGR 4590', 'MATH 2010'],
  },
  {
    id: 'systems', kind: 'elective', semesters: false, tone: 'gold', closedR: 80,
    label: [{ text: 'Systems Engineering' }, { text: '& Management' }, { text: 'Elective', muted: true }], name: 'Elective: Systems Engineering & Management',
    ids: ['ENGR 3915', 'ENGR 3970'],
  },
  {
    id: 'robotics', kind: 'elective', semesters: false, tone: 'gold', closedR: 80,
    label: [{ text: 'Robotics &' }, { text: 'Embedded Systems' }, { text: 'Elective', muted: true }], name: 'Elective: Robotics & Embedded Systems',
    ids: ['ENGR 4550', 'ENGR 4560'],
  },
  {
    id: 'advanced', kind: 'elective', semesters: false, tone: 'gold', closedR: 80,
    label: [{ text: 'Advanced Study' }, { text: 'Elective', muted: true }], name: 'Elective: Advanced Study',
    ids: ['ENGR 4540', 'ENGR 4570'],
  },
  {
    id: 'internship', kind: 'elective', semesters: false, tone: 'gold', closedR: 80,
    label: [{ text: 'Internship & Research' }, { text: 'Elective', muted: true }], name: 'Elective: Internship & Research',
    ids: ['ENGR 4600', 'ENGR 4610'],
  },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
export const AREA_OF = Object.fromEntries(AREAS.flatMap((a) => a.ids.map((id) => [id, a.id])));
export const ALL_COURSE_IDS = AREAS.flatMap((a) => a.ids);

const SEASON_NAME = ['Fall', 'Spring', 'Summer'];

/** "Year 4 Fall" for an academic map position (3 per year: fall, spring, summer). */
export function semesterLabel(position) {
  return `Year ${Math.floor(position / 3) + 1} ${SEASON_NAME[position % 3]}`;
}

export function mapPositionOf(catalog, id) {
  return P.suggestedPositionOf(catalog, id);
}

/** An area's courses in ring order, with each course's academic map position. */
export function orderedCourses(catalog, area) {
  const rows = area.ids.map((id) => ({ id, position: mapPositionOf(catalog, id) ?? 99 }));
  if (area.semesters) rows.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  else rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// --------------------------------------------------------------- ring shapes

export const COURSE_R = 28;
const RING_GAP = 14;          // space between neighboring course circles on a ring
const ELECTIVE_RING_R = 92;   // the ring for two elective courses
const LABEL_LINE = 18;

/** Radius of the ring the course circles sit on. */
export function ringRadius(area) {
  const n = area.ids.length;
  if (n <= 4) return ELECTIVE_RING_R;
  return Math.ceil((COURSE_R * 2 + RING_GAP) / (2 * Math.sin(Math.PI / n)));
}

/** Radius of the enlarged selected course in the middle of its ring. */
export function selectedRadius(area) {
  return Math.min(72, ringRadius(area) - COURSE_R - 6);
}

/**
 * Sizes of an area, closed or open. `half` is the half-width, `top` and `bottom` are the heights above and below
 * the center, all including the area label above and the close button below.
 */
export function areaSize(area, open) {
  const lines = area.label.length;
  if (!open) {
    const r = area.closedR;
    return { r, half: r, top: r + 14 + LABEL_LINE * lines, bottom: r + 14 };
  }
  const R = ringRadius(area);
  const bg = R + COURSE_R + 8;
  const arc = bg + 10;
  const outer = area.semesters ? arc + 18 : bg + 4;
  return {
    r: area.closedR, R, bg, arc, outer,
    half: Math.max(outer, 92),
    top: outer + 10 + LABEL_LINE * lines,
    bottom: outer + 46,
  };
}

/** Where each course circle sits on the ring. Angles run clockwise from the top. */
export function ringSlots(catalog, area) {
  const rows = orderedCourses(catalog, area);
  const n = rows.length;
  const R = ringRadius(area);
  return rows.map((row, i) => {
    const angle = -90 + (i * 360) / n;
    const rad = (angle * Math.PI) / 180;
    return { ...row, index: i, angle, x: R * Math.cos(rad), y: R * Math.sin(rad) };
  });
}

/** The thin outer arcs, one per academic map semester, for areas that have them. */
export function semesterArcs(catalog, area) {
  if (!area.semesters) return [];
  const slots = ringSlots(catalog, area);
  const step = 360 / slots.length;
  const gap = 3.2;
  const arcs = [];
  for (const slot of slots) {
    const last = arcs[arcs.length - 1];
    if (last && last.position === slot.position) {
      last.end = slot.angle + step / 2 - gap / 2;
      last.count += 1;
    } else {
      arcs.push({ position: slot.position, label: semesterLabel(slot.position), start: slot.angle - step / 2 + gap / 2, end: slot.angle + step / 2 - gap / 2, count: 1 });
    }
  }
  return arcs;
}

// -------------------------------------------------------------------- layout

// Directions out from the core for the five other areas: required above, then the four electives clockwise
// starting at the upper right.
// These angles and the stretch were chosen by trying many and keeping the one that fits the screen best.
const WIDE = 0.9;
const SATELLITE_DIRS = [-90, -30, 30, 150, 210].map((deg) => [WIDE * Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]);
const SPACE = 16;                                    // the least space between two areas

function rectOf(area, open, at) {
  const s = areaSize(area, open);
  return { l: at.x - s.half, r: at.x + s.half, t: at.y - s.top, b: at.y + s.bottom };
}

function rectsTouch(a, b, gap = SPACE) {
  return a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;
}

/**
 * Center of every area. The core area sits in the middle. Each other area sits on its own line out from the middle and
 * moves out only as far as it needs to so nothing overlaps.
 */
export function layoutAreas(open, mode = 'radial') {
  const openSet = open instanceof Set ? open : new Set(open);
  const at = {};
  if (mode === 'column') {
    let y = 0;
    AREAS.forEach((area, i) => {
      const s = areaSize(area, openSet.has(area.id));
      if (i > 0) y += SPACE + 8;
      y += s.top;
      at[area.id] = { x: 0, y };
      y += s.bottom;
    });
    return at;
  }
  const core = AREAS[0];
  at[core.id] = { x: 0, y: 0 };
  const placed = [rectOf(core, openSet.has(core.id), at[core.id])];
  const coreSize = areaSize(core, openSet.has(core.id));
  AREAS.slice(1).forEach((area, i) => {
    const size = areaSize(area, openSet.has(area.id));
    const [ux, uy] = SATELLITE_DIRS[i];
    let d = (Math.max(coreSize.top, coreSize.half) + Math.max(size.top, size.half)) * 0.3;
    for (let guard = 0; guard < 400; guard += 1) {
      const p = { x: d * ux, y: d * uy };
      const rect = rectOf(area, openSet.has(area.id), p);
      if (!placed.some((other) => rectsTouch(rect, other))) {
        at[area.id] = p;
        placed.push(rect);
        return;
      }
      d += 4;
    }
    throw new Error(`No room found for ${area.id}`);
  });
  return at;
}

/** The smallest box around every area, for fitting the map to the screen. */
export function boundsOf(at, open) {
  const openSet = open instanceof Set ? open : new Set(open);
  let l = Infinity; let r = -Infinity; let t = Infinity; let b = -Infinity;
  for (const area of AREAS) {
    const rect = rectOf(area, openSet.has(area.id), at[area.id]);
    l = Math.min(l, rect.l); r = Math.max(r, rect.r); t = Math.min(t, rect.t); b = Math.max(b, rect.b);
  }
  return { l, r, t, b, w: r - l, h: b - t };
}

export function areaRect(areaId, at, open) {
  const openSet = open instanceof Set ? open : new Set(open);
  return rectOf(AREA_BY_ID[areaId], openSet.has(areaId), at[areaId]);
}

/** The smallest box that holds every rectangle in a list. */
export function unionRects(rects) {
  const box = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
  for (const rect of rects) {
    box.l = Math.min(box.l, rect.l); box.r = Math.max(box.r, rect.r); box.t = Math.min(box.t, rect.t); box.b = Math.max(box.b, rect.b);
  }
  return { ...box, w: box.r - box.l, h: box.b - box.t };
}

/**
 * A camera ({ x, y, k }: screen offset and zoom) that shows `box` inside a view of `width` by `height`.
 * The insets keep the box clear of things drawn over the map, such as the legend.
 */
export function fitCamera(box, view, { pad = 28, maxK = 1.15, minK = 0.12, bottomInset = 0, topInset = 0, leftInset = 0, rightInset = 0 } = {}) {
  const availW = Math.max(60, view.width - pad * 2 - leftInset - rightInset);
  const availH = Math.max(60, view.height - pad * 2 - bottomInset - topInset);
  const k = Math.min(maxK, Math.max(minK, Math.min(availW / box.w, availH / box.h)));
  const cx = (box.l + box.r) / 2;
  const cy = (box.t + box.b) / 2;
  return {
    k,
    x: leftInset + pad + availW / 2 - cx * k,
    y: topInset + pad + availH / 2 - cy * k,
  };
}

/** Whether a world rectangle is fully on screen under a camera, with `margin` pixels to spare. */
export function rectOnScreen(rect, cam, view, { margin = 8, leftInset = 0, rightInset = 0, bottomInset = 0 } = {}) {
  const l = rect.l * cam.k + cam.x;
  const r = rect.r * cam.k + cam.x;
  const t = rect.t * cam.k + cam.y;
  const b = rect.b * cam.k + cam.y;
  return l >= leftInset + margin && r <= view.width - rightInset - margin && t >= margin && b <= view.height - bottomInset - margin;
}

// --------------------------------------------------------------------- links

/**
 * The courses a course needs and the courses it opens up, limited to courses on the map.
 * `together` is true when the prerequisite may be taken in the same semester.
 */
export function linksFor(catalog, id) {
  const known = (c) => Boolean(AREA_OF[c]);
  const needs = new Map();
  for (const leaf of P.prereqLeaves(catalog.courses[id]?.prereqs ?? null)) {
    if (!known(leaf.course) || leaf.course === id) continue;
    const together = leaf.concurrent_ok === true;
    needs.set(leaf.course, needs.has(leaf.course) ? needs.get(leaf.course) && together : together);
  }
  const opens = directUnlocks(catalog, id).filter((u) => known(u.id)).map((u) => ({ id: u.id, together: u.together }));
  return {
    needs: [...needs].map(([course, together]) => ({ id: course, together })),
    opens,
  };
}

/** Number of linked courses in each area (used for the badge on a closed area). */
export function linkedByArea(links) {
  const counts = {};
  for (const l of [...links.needs, ...links.opens]) counts[AREA_OF[l.id]] = (counts[AREA_OF[l.id]] ?? 0) + 1;
  return counts;
}

// ------------------------------------------------------------- labels, search

/** The label shown when hovering a course: "ENGR 3540, Introduction to Feedback Control, Year 4 Fall". */
export function hoverLabel(catalog, id) {
  const area = AREA_BY_ID[AREA_OF[id]];
  const where = area.semesters ? semesterLabel(mapPositionOf(catalog, id) ?? 99) : 'Elective';
  return `${tileLabel(catalog, id)}, ${catalog.courses[id].title}, ${where}`;
}

/** Courses that match what the student typed: a course number (with or without the space) or words from the title. */
export function searchCourses(catalog, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const qs = squash(q);
  const words = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const id of ALL_COURSE_IDS) {
    const def = catalog.courses[id];
    const label = squash(tileLabel(catalog, id));
    const title = def.title.toLowerCase();
    let score = null;
    if (label.startsWith(qs) || squash(id).startsWith(qs)) score = 0;
    else if (squash(id).includes(qs) || label.includes(qs)) score = 1;
    else if (words.every((w) => title.includes(w))) score = 2;
    if (score !== null) scored.push({ id, score, title: def.title });
  }
  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit);
}

/** Wrap text into lines of about `max` characters, for text drawn in SVG. */
export function wrapText(text, max) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
