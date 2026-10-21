// Fixed layout of the Explore course map. Every course sits in a group, every group has a fixed place,
// and every course has a fixed slot inside its group, so the map looks the same every time.

export const TILE_W = 156;
export const TILE_H = 68;
export const GAP = 12;
export const PAD = 14;
export const HEADER = 40;

/**
 * Groups, from the approved interface specification.
 * `slots` lists courses as [course id, column, row] inside the group.
 */
export const GROUPS = [
  {
    id: 'math', label: 'Math & Science', kind: 'core', cols: 3, rows: 3,
    slots: [
      ['MATH 1910', 0, 0], ['MATH 1920', 0, 1], ['MATH 3110', 0, 2],
      ['CHEM 1110', 1, 0], ['PHYS 2110', 1, 1], ['PHYS 2120', 1, 2],
      ['MATH 2010', 2, 0], ['MATH 3120', 2, 1], ['CSCI 1170', 2, 2],
    ],
  },
  {
    id: 'foundations', label: 'Engineering Foundations', kind: 'core', cols: 2, rows: 2,
    slots: [['ENGR 1100', 0, 0], ['ENGR 2100', 1, 0], ['ENGR 2210', 0, 1], ['ENGR 4500', 1, 1]],
  },
  {
    id: 'mechanics', label: 'Mechanics', kind: 'core', cols: 2, rows: 3,
    slots: [['ENGR 2110', 0, 0], ['ENGR 2120', 0, 1], ['ENGR 3590', 0, 2], ['ENGR 3560', 1, 0], ['ENGR 3550', 1, 1]],
  },
  {
    id: 'circuits', label: 'Circuits, Electronics & Automation', kind: 'core', cols: 2, rows: 3,
    slots: [['ENGR 2130', 0, 0], ['ENGR 3510', 0, 1], ['ENGR 3530', 0, 2], ['ENGR 3520', 1, 0], ['ENGR 4510', 1, 1], ['ENGR 4520', 1, 2]],
  },
  {
    id: 'controls', label: 'Controls', kind: 'core', cols: 1, rows: 2,
    slots: [['ENGR 3540', 0, 0], ['ENGR 4530', 0, 1]],
  },
  {
    id: 'senior', label: 'Senior Design', kind: 'core', cols: 1, rows: 2,
    slots: [['ENGR 4580', 0, 0], ['ENGR 4590', 0, 1]],
  },
  {
    id: 'systems', label: 'Elective: Systems Engineering & Management', short: 'Systems Engineering & Management', kind: 'elective', cols: 2, rows: 1,
    slots: [['ENGR 3915', 0, 0], ['ENGR 3970', 1, 0]],
  },
  {
    id: 'internship', label: 'Elective: Internship & Research', short: 'Internship & Research', kind: 'elective', cols: 2, rows: 1,
    slots: [['ENGR 4600', 0, 0], ['ENGR 4610', 1, 0]],
  },
  {
    id: 'advanced', label: 'Elective: Advanced Study', short: 'Advanced Study', kind: 'elective', cols: 2, rows: 1,
    slots: [['ENGR 4540', 0, 0], ['ENGR 4570', 1, 0]],
  },
  {
    id: 'robotics', label: 'Elective: Robotics & Embedded Systems', short: 'Robotics & Embedded Systems', kind: 'elective', cols: 2, rows: 1,
    slots: [['ENGR 4550', 0, 0], ['ENGR 4560', 1, 0]],
  },
];

export function groupSize(group) {
  return {
    w: PAD * 2 + group.cols * TILE_W + (group.cols - 1) * GAP,
    h: HEADER + PAD + group.rows * TILE_H + (group.rows - 1) * GAP + PAD,
  };
}

// Group positions. The core areas sit in the middle and the elective career groups sit above and below them.
const SIZE = Object.fromEntries(GROUPS.map((g) => [g.id, groupSize(g)]));
const COL_GAP = 40;
const ROW_GAP = 40;
const X = {};
X.a = 0;                                  // first column
X.b = X.a + SIZE.foundations.w + COL_GAP; // second column
X.c = X.b + SIZE.mechanics.w + COL_GAP;   // third column (controls)
X.d = X.c + SIZE.controls.w + COL_GAP;    // fourth column (senior design)
const ELECTIVE_H = SIZE.systems.h;
const ROW1_Y = ELECTIVE_H + ROW_GAP;
const ROW2_Y = ROW1_Y + SIZE.mechanics.h + ROW_GAP;
const ROW3_Y = ROW2_Y + SIZE.math.h + ROW_GAP;

const PLACE = {
  systems: [X.a, 0],
  internship: [X.b, 0],
  foundations: [X.a, ROW1_Y],
  mechanics: [X.b, ROW1_Y],
  controls: [X.c, ROW1_Y],
  senior: [X.d, ROW1_Y],
  math: [X.a, ROW2_Y],
  circuits: [X.a + SIZE.math.w + COL_GAP, ROW2_Y],
  advanced: [X.a, ROW3_Y],
  robotics: [X.a + SIZE.math.w + COL_GAP, ROW3_Y],
};

const CSS_KEY = { math: 'math', foundations: 'found', mechanics: 'mech', circuits: 'circ', controls: 'ctrl', senior: 'senior', systems: 'systems', robotics: 'robotics', advanced: 'advanced', internship: 'internship' };

export const LAYOUT = GROUPS.map((g) => ({ ...g, cssKey: CSS_KEY[g.id], x: PLACE[g.id][0], y: PLACE[g.id][1], ...SIZE[g.id] }));

/** Absolute rectangle of every course tile, by course id. */
export const TILE_RECTS = (() => {
  const rects = {};
  for (const g of LAYOUT) {
    for (const [id, col, row] of g.slots) {
      rects[id] = {
        x: g.x + PAD + col * (TILE_W + GAP),
        y: g.y + HEADER + PAD + row * (TILE_H + GAP),
        w: TILE_W,
        h: TILE_H,
        group: g.id,
      };
    }
  }
  return rects;
})();

export const GROUP_BY_COURSE = Object.fromEntries(
  Object.entries(TILE_RECTS).map(([id, r]) => [id, LAYOUT.find((g) => g.id === r.group)]),
);

export const MAP_BOUNDS = (() => {
  let w = 0;
  let h = 0;
  for (const g of LAYOUT) {
    w = Math.max(w, g.x + g.w);
    h = Math.max(h, g.y + g.h);
  }
  return { w, h };
})();
