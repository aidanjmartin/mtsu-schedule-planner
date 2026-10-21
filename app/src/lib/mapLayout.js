// Fixed layout of the Flow view. Every course sits in a group, every group has a fixed place, and every course has a
// fixed slot inside its group, so the chart looks the same every time. A wide layout fits desktop screens. A narrow
// layout stacks the groups in one column, about as wide as a phone screen, so the chart can open fitted to the width.

import { SUBJECT_OF } from './exploreModel.js';

export const TILE_W = 176;
export const TILE_H = 84;
export const GAP = 12;
export const PAD = 14;
export const HEADER = 40;
const COL_GAP = 40;
const ROW_GAP = 40;

/**
 * Groups, from the interface specification: one box for each subject, and one box for each elective career area.
 * `slots` lists courses as [course id, column, row] inside the group. `wide` and `narrow` give each box's columns
 * and row count in the two layouts, with the slots for the narrow layout when they differ.
 */
export const GROUPS = [
  {
    id: 'math', label: 'Math & Science', kind: 'core', subject: 'math',
    slots: [
      ['MATH 1910', 0, 0], ['MATH 1920', 0, 1], ['MATH 3110', 0, 2],
      ['CHEM 1110', 1, 0], ['PHYS 2110', 1, 1], ['PHYS 2120', 1, 2],
      ['MATH 2010', 2, 0], ['MATH 3120', 2, 1], ['CSCI 1170', 2, 2],
    ],
    narrowSlots: [
      ['MATH 1910', 0, 0], ['MATH 1920', 1, 0], ['CHEM 1110', 0, 1], ['PHYS 2110', 1, 1], ['MATH 2010', 0, 2],
      ['MATH 3110', 1, 2], ['PHYS 2120', 0, 3], ['MATH 3120', 1, 3], ['CSCI 1170', 0, 4],
    ],
  },
  {
    id: 'foundations', label: 'Engineering Foundations', kind: 'core', subject: 'found',
    slots: [['ENGR 1010', 0, 0], ['ENGR 1100', 1, 0], ['ENGR 2100', 0, 1], ['ENGR 2210', 1, 1]],
  },
  {
    id: 'mechanics', label: 'Mechanics', kind: 'core', subject: 'mech',
    slots: [['ENGR 2110', 0, 0], ['ENGR 2120', 0, 1], ['ENGR 3590', 0, 2], ['ENGR 3560', 1, 0], ['ENGR 3550', 1, 1]],
  },
  {
    id: 'circuits', label: 'Circuits, Electronics & Automation', kind: 'core', subject: 'circ',
    slots: [['ENGR 2130', 0, 0], ['ENGR 3510', 0, 1], ['ENGR 3530', 0, 2], ['ENGR 3520', 1, 0], ['ENGR 4510', 1, 1], ['ENGR 4520', 1, 2]],
  },
  { id: 'controls', label: 'Controls', kind: 'core', subject: 'ctrl', slots: [['ENGR 3540', 0, 0], ['ENGR 4530', 0, 1]] },
  { id: 'senior', label: 'Senior Design', kind: 'core', subject: 'senior', slots: [['ENGR 4580', 0, 0], ['ENGR 4590', 0, 1]] },
  {
    id: 'systems', label: 'Elective: Systems Engineering & Management', short: 'Systems Engineering & Management', kind: 'elective', subject: 'elective',
    slots: [['ENGR 3915', 0, 0], ['ENGR 3970', 1, 0], ['ENGR 4500', 0, 1]],
  },
  {
    id: 'robotics', label: 'Elective: Robotics & Embedded Systems', short: 'Robotics & Embedded Systems', kind: 'elective', subject: 'elective',
    slots: [['ENGR 4550', 0, 0], ['ENGR 4560', 1, 0]],
  },
  {
    id: 'advanced', label: 'Elective: Advanced Study', short: 'Advanced Study', kind: 'elective', subject: 'elective',
    slots: [['ENGR 4540', 0, 0], ['ENGR 4570', 1, 0]],
  },
  {
    id: 'internship', label: 'Elective: Internship & Research', short: 'Internship & Research', kind: 'elective', subject: 'elective',
    slots: [['ENGR 3600', 0, 0], ['ENGR 4600', 1, 0]],
  },
];

function sizeOf(slots) {
  const cols = Math.max(...slots.map((s) => s[1])) + 1;
  const rows = Math.max(...slots.map((s) => s[2])) + 1;
  return {
    cols, rows,
    w: PAD * 2 + cols * TILE_W + (cols - 1) * GAP,
    h: HEADER + PAD + rows * TILE_H + (rows - 1) * GAP + PAD,
  };
}

/** Group boxes and course tiles for the wide or the narrow layout. */
function build(mode) {
  const narrow = mode === 'narrow';
  const slotsOf = (g) => (narrow && g.narrowSlots ? g.narrowSlots : g.slots);
  const size = Object.fromEntries(GROUPS.map((g) => [g.id, sizeOf(slotsOf(g))]));
  const place = {};
  if (!narrow) {
    // Row 1: the early subjects. Row 2: math, circuits, and internship. Row 3: the other elective areas.
    const x2 = size.foundations.w + COL_GAP;
    const x3 = x2 + size.mechanics.w + COL_GAP;
    const x4 = x3 + size.controls.w + COL_GAP;
    const row1 = Math.max(size.foundations.h, size.mechanics.h, size.controls.h, size.senior.h);
    const y2 = row1 + ROW_GAP;
    const row2 = Math.max(size.math.h, size.circuits.h, size.internship.h);
    const y3 = y2 + row2 + ROW_GAP;
    Object.assign(place, {
      foundations: [0, 0], mechanics: [x2, 0], controls: [x3, 0], senior: [x4, 0],
      math: [0, y2], circuits: [size.math.w + COL_GAP, y2], internship: [size.math.w + COL_GAP + size.circuits.w + COL_GAP, y2],
      systems: [0, y3], robotics: [x2, y3], advanced: [x3, y3],
    });
  } else {
    let y = 0;
    const stack = (id, x = 0) => { place[id] = [x, y]; };
    const next = (h) => { y += h + ROW_GAP; };
    stack('foundations'); next(size.foundations.h);
    stack('math'); next(size.math.h);
    stack('mechanics'); next(size.mechanics.h);
    stack('circuits'); next(size.circuits.h);
    stack('controls'); stack('senior', size.controls.w + GAP); next(Math.max(size.controls.h, size.senior.h));
    for (const id of ['systems', 'robotics', 'advanced', 'internship']) { stack(id); next(size[id].h); }
  }
  const groups = GROUPS.map((g) => ({ ...g, slots: slotsOf(g), x: place[g.id][0], y: place[g.id][1], ...size[g.id] }));
  const tiles = {};
  for (const g of groups) {
    for (const [id, col, row] of g.slots) {
      tiles[id] = { x: g.x + PAD + col * (TILE_W + GAP), y: g.y + HEADER + PAD + row * (TILE_H + GAP), w: TILE_W, h: TILE_H, group: g.id };
    }
  }
  let w = 0;
  let h = 0;
  for (const g of groups) { w = Math.max(w, g.x + g.w); h = Math.max(h, g.y + g.h); }
  return { groups, tiles, bounds: { w, h } };
}

const LAYOUTS = { wide: build('wide'), narrow: build('narrow') };

/** The layout for the screen: groups, tile rectangles by course id, and the overall size. */
export function flowLayout(narrow) {
  return narrow ? LAYOUTS.narrow : LAYOUTS.wide;
}

/** Every course the Flow view draws. */
export const FLOW_COURSE_IDS = GROUPS.flatMap((g) => g.slots.map((s) => s[0]));

export const GROUP_BY_COURSE = Object.fromEntries(
  GROUPS.flatMap((g) => g.slots.map(([id]) => [id, g])),
);

// Each tile takes the color of its subject, the same colors the Circle view uses.
export function subjectKeyOf(id) {
  return SUBJECT_OF[id]?.css ?? 'math';
}
