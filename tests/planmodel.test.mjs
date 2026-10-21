// Tests for the student-facing plan model in app/src/lib/planModel.js, run against the real 2026-27 catalog.
// The date is fixed so the results do not change from week to week.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../app/src/lib/planModel.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('data/catalogs/2026-27.json', root), 'utf8'));
const offerings = JSON.parse(fs.readFileSync(new URL('data/offerings.json', root), 'utf8'));
const today = new Date('2026-10-20T12:00:00');
const electives = ['ENGR 3915', 'ENGR 4550', 'ENGR 4560'];

const firstSemester = () => M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, electives });
const secondYearFall = () => M.seedAnswers(catalog, { ...M.emptyAnswers(), year: 2, season: 'fall', electives });

test('a first-semester student graduates in Spring 2030 and starts senior design in Fall 2029', () => {
  const result = M.computeResult(catalog, offerings, firstSemester(), { today });
  assert.equal(result.graduationLabel, 'Spring 2030');
  assert.equal(result.seniorDesign.startLabel, 'Fall 2029');
  assert.equal(result.seniorDesign.endLabel, 'Spring 2030');
  assert.equal(result.status, 'on-track');
  assert.equal(result.terms[0].label, 'Fall 2026');
});

test('the plan reports open general education hours and no placeholder courses', () => {
  const result = M.computeResult(catalog, offerings, firstSemester(), { today });
  assert.ok(result.terms.every((t) => t.open === t.capacity - t.hours));
  assert.ok(result.terms.every((t) => t.courses.every((c) => !c.course.startsWith('tbc-'))));
  assert.equal(result.genEd.remaining, 30);
  assert.ok(result.genEd.open >= result.genEd.remaining);
});

test('the map pre-checks the courses before a 2nd year fall student and the courses in it', () => {
  const answers = secondYearFall();
  assert.deepEqual([...answers.finished].sort(), ['CHEM 1110', 'ENGR 1100', 'ENGR 2100', 'MATH 1910', 'MATH 1920', 'PHYS 2110']);
  assert.deepEqual([...answers.taking].sort(), ['ENGR 2110', 'ENGR 2210', 'MATH 3110', 'PHYS 2120']);
  const result = M.computeResult(catalog, offerings, answers, { today });
  assert.equal(result.graduationLabel, 'Spring 2029');
  assert.equal(result.seniorDesign.startLabel, 'Fall 2028');
  assert.equal(result.status, 'on-track');
});

test('unchecking PHYS 2110 delays senior design and graduation, and an alert names PHYS 2110', () => {
  const base = secondYearFall();
  const finished = [...M.closeFinished(catalog, base.finished.filter((id) => id !== 'PHYS 2110'))];
  const taking = M.closeTaking(catalog, finished, base.taking);
  assert.deepEqual(taking.sort(), ['ENGR 2210', 'MATH 3110']);
  const result = M.computeResult(catalog, offerings, { ...base, finished, taking }, { today });
  assert.equal(result.status, 'delayed');
  assert.equal(result.seniorDesign.startLabel, 'Fall 2029');
  assert.equal(result.graduationLabel, 'Spring 2030');
  assert.ok(result.alerts.some((a) => a.severity === 'bad' && a.text.startsWith('PHYS 2110 is holding up your plan')));
});

test('blocked courses explain what they need', () => {
  const base = secondYearFall();
  const finished = [...M.closeFinished(catalog, base.finished.filter((id) => id !== 'PHYS 2110'))];
  const choices = M.takingChoices(catalog, offerings, { ...base, finished, taking: [] }, today);
  const blocked = Object.fromEntries(choices.onMap.filter((c) => !c.ok).map((c) => [c.id, c.reasons[0]]));
  assert.equal(blocked['ENGR 2110'], 'Needs PHYS 2110 first.');
  assert.equal(blocked['PHYS 2120'], 'Needs PHYS 2110 first.');
});

test('unchecking a course also unchecks the finished courses that need it', () => {
  const closed = M.closeFinished(catalog, ['MATH 1910', 'MATH 1920', 'MATH 3110'].filter((id) => id !== 'MATH 1910'));
  assert.deepEqual([...closed], []);
  assert.deepEqual(closed.removed.sort(), ['MATH 1920', 'MATH 3110']);
});

test('prerequisites read as plain sentences', () => {
  assert.deepEqual(M.prereqSentences(catalog.courses['ENGR 3540'].prereqs), [
    'Take ENGR 3520 and MATH 3120 first.',
    'ENGR 3530 can be taken the same semester.',
  ]);
});

test('elective cards say when the student can take each one', () => {
  const cards = M.electiveCards(catalog, offerings, firstSemester(), today);
  assert.equal(cards.length, 8);
  const vision = cards.find((c) => c.id === 'ENGR 4570');
  assert.equal(vision.canTakeNow, false);
  assert.ok(vision.reasons.some((r) => r.includes('first offered in Fall 2027')));
  assert.ok(vision.reasons.some((r) => r.includes('ENGR 3520')));
});

test('a lighter credit load graduates later than the standard load', () => {
  const loads = Object.fromEntries(M.compareLoads(catalog, offerings, firstSemester(), today).map((l) => [l.key, l]));
  assert.equal(loads.standard.graduationLabel, 'Spring 2030');
  assert.equal(loads.heavy.graduationLabel, 'Spring 2030');
  assert.equal(loads.light.graduationLabel, 'Spring 2031');
});

test('class times fall back to the same season in an earlier year', () => {
  assert.deepEqual(M.scheduleCandidates('2027SP').slice(0, 3), ['2027SP', '2026SP', '2025SP']);
});
