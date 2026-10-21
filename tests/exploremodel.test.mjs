// Tests for the Explore map model in app/src/lib/exploreModel.js, run against the real 2026-27 catalog.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as X from '../app/src/lib/exploreModel.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('data/catalogs/2026-27.json', root), 'utf8'));

test('every catalog course sits in exactly one area, and every area course exists in the catalog', () => {
  const seen = new Map();
  for (const area of X.AREAS) for (const id of area.ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, n] of seen) assert.equal(n, 1, `${id} is in ${n} areas`);
  assert.deepEqual([...seen.keys()].filter((id) => !catalog.courses[id]), []);
  assert.deepEqual(Object.keys(catalog.courses).filter((id) => !seen.has(id)), []);
});

test('there are six areas: core, required, and four electives', () => {
  assert.deepEqual(X.AREAS.map((a) => a.id), ['core', 'required', 'systems', 'robotics', 'advanced', 'internship']);
});

test('core and required rings run in academic map order, and elective rings run in course number order', () => {
  for (const id of ['core', 'required']) {
    const rows = X.orderedCourses(catalog, X.AREA_BY_ID[id]);
    for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].position >= rows[i - 1].position, `${id} ring is out of order at ${rows[i].id}`);
  }
  for (const id of ['systems', 'robotics', 'advanced', 'internship']) {
    const ids = X.orderedCourses(catalog, X.AREA_BY_ID[id]).map((r) => r.id);
    assert.deepEqual(ids, [...ids].sort());
  }
});

test('ring slots are evenly spaced, start at the top, and run clockwise', () => {
  const area = X.AREA_BY_ID.core;
  const slots = X.ringSlots(catalog, area);
  const n = area.ids.length;
  assert.equal(slots.length, n);
  assert.ok(Math.abs(slots[0].x) < 1e-9 && slots[0].y < 0, 'first slot is at the top');
  assert.ok(slots[1].x > 0, 'second slot is to the right of the top');
  const R = X.ringRadius(area);
  for (const s of slots) assert.ok(Math.abs(Math.hypot(s.x, s.y) - R) < 1e-6);
  const gap = 2 * R * Math.sin(Math.PI / n);
  assert.ok(gap >= X.COURSE_R * 2 + 10, 'neighboring circles do not touch');
});

test('no two areas overlap in any of the 64 open and closed combinations', () => {
  const ids = X.AREAS.map((a) => a.id);
  for (let mask = 0; mask < 64; mask += 1) {
    const open = new Set(ids.filter((_, i) => mask & (1 << i)));
    const at = X.layoutAreas(open);
    const rects = ids.map((id) => X.areaRect(id, at, open));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]; const b = rects[j];
        const apart = a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
        assert.ok(apart, `${ids[i]} and ${ids[j]} overlap with open=${[...open].join(',')}`);
      }
    }
  }
});

test('the phone column layout stacks areas without overlap', () => {
  const open = new Set(['core', 'required']);
  const at = X.layoutAreas(open, 'column');
  const rects = X.AREAS.map((a) => X.areaRect(a.id, at, open));
  for (let i = 1; i < rects.length; i += 1) assert.ok(rects[i].t >= rects[i - 1].b);
  assert.ok(X.AREAS.every((a) => at[a.id].x === 0));
});

test('ENGR 3540 links to the courses it needs and the courses it opens up', () => {
  const links = X.linksFor(catalog, 'ENGR 3540');
  const needs = links.needs.map((l) => l.id).sort();
  assert.deepEqual(needs, ['ENGR 3520', 'ENGR 3530', 'MATH 3120']);
  assert.ok(links.opens.some((l) => l.id === 'ENGR 4530'));
  assert.ok(![...links.needs, ...links.opens].some((l) => l.id === 'ENGR 3540'));
});

test('a prerequisite that may be taken the same semester is marked as together', () => {
  const all = X.ALL_COURSE_IDS.flatMap((id) => X.linksFor(catalog, id).needs);
  assert.ok(all.some((l) => l.together === true));
  assert.ok(all.some((l) => l.together === false));
});

test('linkedByArea counts linked courses per area', () => {
  const counts = X.linkedByArea(X.linksFor(catalog, 'ENGR 3540'));
  assert.equal(counts.core, 1);
  assert.ok(counts.required >= 1);
});

test('search finds a course by number with or without the space, and by title words', () => {
  assert.equal(X.searchCourses(catalog, '3540')[0].id, 'ENGR 3540');
  assert.equal(X.searchCourses(catalog, 'engr3540')[0].id, 'ENGR 3540');
  assert.equal(X.searchCourses(catalog, 'feedback control')[0].id, 'ENGR 3540');
  assert.deepEqual(X.searchCourses(catalog, ''), []);
  assert.deepEqual(X.searchCourses(catalog, 'zzzz'), []);
});

test('the hover label names the course, title, and academic map semester', () => {
  assert.equal(X.hoverLabel(catalog, 'ENGR 3540'), 'ENGR 3540, Introduction to Feedback Control, Year 4 Fall');
  assert.match(X.hoverLabel(catalog, 'ENGR 4550'), /, Elective$/);
});

test('the areas hold the curriculum update: ENGR 1010 in core, ENGR 4500 in systems, ENGR 3600 and 4600 in internship, no ENGR 4610', () => {
  assert.ok(X.AREA_BY_ID.core.ids.includes('ENGR 1010'));
  assert.ok(!X.AREA_BY_ID.required.ids.includes('ENGR 4500'));
  assert.deepEqual(X.AREA_BY_ID.systems.ids, ['ENGR 3915', 'ENGR 3970', 'ENGR 4500']);
  assert.deepEqual(X.AREA_BY_ID.internship.ids, ['ENGR 3600', 'ENGR 4600']);
  assert.equal(X.AREA_OF['ENGR 4610'], undefined);
  assert.equal(X.SUBJECT_OF['ENGR 1010'].label, 'Engineering Foundations');
  assert.equal(X.SUBJECT_OF['ENGR 3600'].label, 'Electives');
});

test('hours text shows a range for a course whose hours change by semester', () => {
  assert.equal(X.hoursText(catalog.courses['ENGR 3600']), '1 to 3');
  assert.equal(X.hoursText(catalog.courses['ENGR 3540']), '3');
  assert.equal(X.areaHoursText(catalog, X.AREA_BY_ID.internship), '2 to 6 credit hours');
  assert.equal(X.areaHoursText(catalog, X.AREA_BY_ID.robotics), '6 credit hours');
});
