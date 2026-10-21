// Tests for the Flow view layout in app/src/lib/mapLayout.js and the lines in app/src/lib/flowGraph.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../app/src/lib/mapLayout.js';
import * as G from '../app/src/lib/flowGraph.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalogs/2026-27.json', import.meta.url), 'utf8'));

const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

test('the Flow view draws every catalog course once, in the ten groups from the specification', () => {
  assert.deepEqual([...L.FLOW_COURSE_IDS].sort(), Object.keys(catalog.courses).sort());
  assert.equal(L.GROUPS.length, 10);
  assert.equal(L.GROUPS.filter((g) => g.kind === 'elective').length, 4);
});

for (const mode of [false, true]) {
  test(`${mode ? 'narrow' : 'wide'} layout: no two groups or tiles overlap, and every tile sits inside its group`, () => {
    const layout = L.flowLayout(mode);
    for (let i = 0; i < layout.groups.length; i += 1) {
      for (let j = i + 1; j < layout.groups.length; j += 1) assert.ok(!overlap(layout.groups[i], layout.groups[j]), `${layout.groups[i].id} overlaps ${layout.groups[j].id}`);
    }
    const tiles = Object.entries(layout.tiles);
    assert.equal(tiles.length, 37);
    for (let i = 0; i < tiles.length; i += 1) {
      const [id, t] = tiles[i];
      const group = layout.groups.find((g) => g.id === t.group);
      assert.ok(t.x >= group.x && t.y >= group.y && t.x + t.w <= group.x + group.w && t.y + t.h <= group.y + group.h, `${id} sits inside ${group.id}`);
      for (let j = i + 1; j < tiles.length; j += 1) assert.ok(!overlap(t, tiles[j][1]), `${id} overlaps ${tiles[j][0]}`);
    }
  });
}

test('the narrow layout is about as wide as a phone screen so the chart can open fitted to the width', () => {
  assert.ok(L.flowLayout(true).bounds.w <= 430);
  assert.ok(L.flowLayout(false).bounds.w > 1000);
});

test('selecting ENGR 3540 finds what it needs and what it opens up, all the way along each chain', () => {
  const edges = G.buildEdges(catalog);
  const chains = G.chainsFor('ENGR 3540', edges);
  assert.ok(chains.before.has('ENGR 3520') && chains.before.has('MATH 3120') && chains.before.has('MATH 1910'));
  assert.ok(chains.after.has('ENGR 4530'));
  assert.ok(edges.some((e) => e.to === 'ENGR 3540' && e.from === 'ENGR 3530' && e.together));
  assert.ok(edges.some((e) => e.to === 'ENGR 1100' && e.from === 'ENGR 1010' && e.together), 'ENGR 1010 may be taken with ENGR 1100');
});
