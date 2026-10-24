// Tests for the Term view layout in app/src/lib/termLayout.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../app/src/lib/termLayout.js';
import { FLOW_COURSE_IDS } from '../app/src/lib/mapLayout.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalogs/2026-27.json', import.meta.url), 'utf8'));

const overlap = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

test('the Term view has one column per academic map semester, in order, with every course once', () => {
  const cols = L.termColumns(catalog);
  assert.deepEqual(cols.map((c) => c.label), [
    'Year 1 Fall', 'Year 1 Spring', 'Year 2 Fall', 'Year 2 Spring', 'Year 3 Fall', 'Year 3 Spring', 'Year 4 Fall', 'Year 4 Spring',
  ]);
  const all = cols.flatMap((c) => [...c.required, ...c.electives]);
  assert.deepEqual([...all].sort(), [...FLOW_COURSE_IDS].sort());
  assert.equal(new Set(all).size, all.length);
});

test('each course sits in its academic map semester, and electives are kept apart from required courses', () => {
  const cols = L.termColumns(catalog);
  const at = (label) => cols.find((c) => c.label === label);
  assert.ok(at('Year 1 Fall').required.includes('ENGR 1010'));
  assert.ok(at('Year 4 Fall').required.includes('ENGR 4580'));
  assert.ok(at('Year 4 Spring').required.includes('ENGR 4590'));
  assert.ok(at('Year 4 Fall').electives.includes('ENGR 4570'));
  assert.ok(at('Year 3 Spring').electives.includes('ENGR 3600'));
  const options = catalog.requirements.find((r) => r.id === 'engr-elective').options;
  for (const c of cols) {
    for (const id of c.electives) assert.ok(options.includes(id), `${id} is an elective`);
    for (const id of c.required) assert.ok(!options.includes(id), `${id} is required`);
  }
});

for (const narrow of [false, true]) {
  test(`${narrow ? 'narrow' : 'wide'} layout: nothing overlaps, every tile sits in its column, and electives sit below the divider`, () => {
    const layout = L.termLayout(catalog, narrow);
    for (let i = 0; i < layout.groups.length; i += 1) {
      for (let j = i + 1; j < layout.groups.length; j += 1) assert.ok(!overlap(layout.groups[i], layout.groups[j]));
    }
    const tiles = Object.entries(layout.tiles);
    assert.equal(tiles.length, 37);
    for (let i = 0; i < tiles.length; i += 1) {
      const [id, t] = tiles[i];
      const g = layout.groups.find((x) => x.id === t.group);
      assert.ok(t.x >= g.x && t.y >= g.y && t.x + t.w <= g.x + g.w && t.y + t.h <= g.y + g.h, `${id} sits inside ${g.label}`);
      for (let j = i + 1; j < tiles.length; j += 1) assert.ok(!overlap(t, tiles[j][1]), `${id} overlaps ${tiles[j][0]}`);
    }
    const cols = L.termColumns(catalog);
    for (const c of cols) {
      const g = layout.groups.find((x) => x.label === c.label);
      for (const id of c.electives) assert.ok(layout.tiles[id].y >= g.y + g.dividerY + L.DIVIDER, `${id} sits below the divider`);
      for (const id of c.required) assert.ok(g.dividerY === null || layout.tiles[id].y + layout.tiles[id].h <= g.y + g.dividerY);
    }
    if (narrow) assert.ok(layout.bounds.w <= 400, 'the narrow layout is about as wide as a phone');
  });
}

test('the wide layout reads left to right: Years 1 and 2 above Years 3 and 4', () => {
  const { groups } = L.termLayout(catalog, false);
  const top = groups.slice(0, 4);
  const bottom = groups.slice(4);
  for (let i = 1; i < 4; i += 1) assert.ok(top[i].x > top[i - 1].x && bottom[i].x > bottom[i - 1].x);
  assert.ok(Math.min(...bottom.map((g) => g.y)) > Math.max(...top.map((g) => g.y + g.h)));
});
