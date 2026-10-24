// Tests for the "Check a change" model in app/src/lib/planCheck.js, run against the real 2026-27 catalog with a fixed date.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../app/src/lib/planModel.js';
import * as K from '../app/src/lib/planCheck.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('data/catalogs/2026-27.json', root), 'utf8'));
const offerings = JSON.parse(fs.readFileSync(new URL('data/offerings.json', root), 'utf8'));
const today = new Date('2026-10-21T12:00:00');
const answers = M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, electives: ['ENGR 3915', 'ENGR 4550', 'ENGR 4560', 'ENGR 4500'] });
const result = M.computeResult(catalog, offerings, answers, { today });
const base = K.planForCheck(result);

test('the recommended plan has the semesters the plan page shows and no conflicts', () => {
  assert.deepEqual(base.terms.map((t) => t.term), result.terms.map((t) => t.term));
  const report = K.checkChanges(catalog, offerings, base);
  assert.equal(report.ok, true);
  assert.equal(report.lastLabel, 'Spring 2031');
  assert.equal(report.seniorDesign.plannedLabel, 'Fall 2030');
});

test('moving a prerequisite later lists each conflict with a fix, and the fix clears every conflict', () => {
  const moved = K.moveCourse(base, 'ENGR 2120', '2030SP');
  assert.deepEqual(K.planChanges(base, moved), [{ course: 'ENGR 2120', from: '2029SP', to: '2030SP', fromLabel: 'Spring 2029', toLabel: 'Spring 2030' }]);
  const report = K.checkChanges(catalog, offerings, moved);
  assert.equal(report.ok, false);
  assert.deepEqual(report.conflicts.map((c) => c.kind), ['missing_prerequisite', 'missing_prerequisite', 'overloaded_term']);
  for (const c of report.conflicts) assert.ok(c.fixes.length > 0, `${c.id} has a fix`);
  const fixed = K.applyFix(catalog, moved, report.conflicts[0].fixes[0].fix);
  assert.equal(K.checkChanges(catalog, offerings, fixed).ok, true);
  assert.deepEqual(K.planChanges(base, fixed), []);
});

test('moving a course into a new semester adds it, and moving it back removes the empty semester', () => {
  const targets = K.moveTargets(base).map((t) => t.term);
  assert.deepEqual(targets.slice(-2), ['2031FA', '2032SP']);
  const later = K.moveCourse(base, 'ENGR 4550', '2032SP');
  assert.deepEqual(later.terms.slice(-2).map((t) => t.term), ['2031SP', '2032SP']);
  const back = K.moveCourse(later, 'ENGR 4550', '2031SP');
  assert.deepEqual(back.terms.map((t) => t.term), base.terms.map((t) => t.term));
});

test('a senior design course moved to spring is flagged as not offered, with the fall fix first', () => {
  const report = K.checkChanges(catalog, offerings, K.moveCourse(base, 'ENGR 4580', '2031SP'));
  const notOffered = report.conflicts.find((c) => c.kind === 'not_offered');
  assert.equal(notOffered.title, 'Not offered that semester');
  assert.equal(notOffered.fixes[0].text, 'Move ENGR 4580 from Spring 2031 to Fall 2030.');
  assert.equal(notOffered.fixes[0].delays, false);
  assert.ok(notOffered.fixes.slice(1).every((f) => f.delays));
  const flagged = report.terms.find((t) => t.term === '2031SP').courses.filter((c) => c.flagged).map((c) => c.course);
  assert.ok(flagged.includes('ENGR 4580'));
});
