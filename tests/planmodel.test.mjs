// Tests for the student-facing plan model in app/src/lib/planModel.js, run against the real 2026-27 catalog.
// The date is fixed so the results do not change from week to week.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../app/src/lib/planModel.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL('data/catalogs/2026-27.json', root), 'utf8'));
const offerings = JSON.parse(fs.readFileSync(new URL('data/offerings.json', root), 'utf8'));
const today = new Date('2026-10-21T12:00:00');
const electives = ['ENGR 3915', 'ENGR 4550', 'ENGR 4560'];

const firstSemester = () => M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, electives });
const secondYearFall = () => M.seedAnswers(catalog, { ...M.emptyAnswers(), year: 2, season: 'fall', electives });

test('a first-semester student starts in Fall 2027 by default, graduates in Spring 2031, and starts senior design in Fall 2030', () => {
  const result = M.computeResult(catalog, offerings, firstSemester(), { today });
  assert.equal(result.graduationLabel, 'Spring 2031');
  assert.equal(result.seniorDesign.startLabel, 'Fall 2030');
  assert.equal(result.seniorDesign.endLabel, 'Spring 2031');
  assert.equal(result.status, 'on-track');
  assert.equal(result.terms[0].label, 'Fall 2027');
  assert.equal(result.inProgress, null);
});

test('today is October 21, 2026: the current semester is Fall 2026 and first-semester students choose Fall 2027 or Spring 2027', () => {
  assert.equal(M.referenceTerm(today), '2026FA');
  assert.deepEqual(M.firstSemesterOptions(today), { terms: ['2027FA', '2027SP'], default: '2027FA' });
  assert.equal(M.planStartTerm(secondYearFall(), today), '2027SP');
  assert.equal(M.planStartTerm(firstSemester(), today), '2027FA');
});

test('the current semester follows the calendar: August to December is fall, January to May is spring, June and July lead to fall', () => {
  const at = (y, m, d) => new Date(y, m - 1, d, 12);
  assert.equal(M.referenceTerm(at(2026, 8, 1)), '2026FA');
  assert.equal(M.referenceTerm(at(2026, 12, 31)), '2026FA');
  assert.equal(M.referenceTerm(at(2027, 1, 1)), '2027SP');
  assert.equal(M.referenceTerm(at(2027, 5, 31)), '2027SP');
  assert.equal(M.referenceTerm(at(2027, 6, 1)), '2027SP');
  assert.equal(M.referenceTerm(at(2027, 7, 31)), '2027SP');
  const spring = { ...M.emptyAnswers(), year: 2, season: 'spring' };
  assert.equal(M.planStartTerm(spring, at(2027, 7, 15)), '2027FA', 'in July the next semester is fall');
  assert.equal(M.planStartTerm(spring, at(2027, 2, 15)), '2027FA', 'a spring student plans from the next fall');
  assert.deepEqual(M.firstSemesterOptions(at(2027, 7, 15)), { terms: ['2027FA', '2028SP'], default: '2027FA' });
  assert.deepEqual(M.firstSemesterOptions(at(2027, 2, 15)), { terms: ['2027FA', '2028SP'], default: '2027FA' });
});

test('a first-semester student can start in Spring 2027 and the plan assumes nothing is finished', () => {
  const answers = M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, firstTerm: '2027SP', electives });
  assert.equal(M.planStartTerm(answers, today), '2027SP');
  assert.equal(M.startPosition(answers, today), 1);
  const result = M.computeResult(catalog, offerings, answers, { today });
  assert.equal(result.terms[0].label, 'Spring 2027');
  assert.equal(result.pace, null);
  assert.deepEqual(result.student.completed, []);
  assert.ok(result.terms[0].courses.some((c) => c.course === 'ENGR 1100'), 'first-year courses still come first');
  // A saved choice that is no longer one of the next two semesters falls back to the default.
  const stale = { ...answers, firstTerm: '2026FA' };
  assert.equal(M.planStartTerm(stale, today), '2027FA');
});

test('the semester is not asked: a year alone puts the student in the season of today\'s date', () => {
  const byYear = { ...secondYearFall(), season: null };
  assert.equal(M.hasPosition(byYear), true);
  assert.equal(M.mapPosition(byYear, today), 3, 'October is fall, so 2nd year fall is map position 3');
  assert.equal(M.mapPosition(byYear, new Date('2027-02-10T12:00:00')), 4, 'February is spring');
  assert.equal(M.currentTermFor(byYear, today), '2026FA');
  assert.equal(M.planStartTerm(byYear, today), '2027SP');
  const result = M.computeResult(catalog, offerings, byYear, { today });
  assert.equal(result.graduationLabel, M.computeResult(catalog, offerings, secondYearFall(), { today }).graduationLabel);
  assert.equal(M.hasPosition(M.emptyAnswers()), false);
});

test('the map statement appears only when every remaining course sits in its map semester', () => {
  // ENGR 4560 runs only in fall and ENGR 3560 does not fit the load, so this plan leaves the map.
  const off = M.computeResult(catalog, offerings, firstSemester(), { today });
  assert.equal(off.matchesMap, false);
  assert.ok(off.offMap.includes('ENGR 4560'));
  const exact = M.computeResult(
    catalog, offerings,
    { ...firstSemester(), electives: ['ENGR 3915', 'ENGR 3970', 'ENGR 4550'] },
    { today, loadKey: 'heavy' },
  );
  assert.equal(exact.matchesMap, true);
  assert.deepEqual(exact.offMap, []);
  assert.equal(exact.graduationLabel, 'Spring 2031');
  // A student who is behind never matches the map.
  const base = secondYearFall();
  const finished = [...M.closeFinished(catalog, base.finished.filter((id) => id !== 'PHYS 2110'))];
  const behind = M.computeResult(catalog, offerings, { ...base, finished, taking: M.closeTaking(catalog, finished, base.taking) }, { today });
  assert.equal(behind.matchesMap, false);
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
  assert.equal(result.startTerm, '2027SP');
  assert.equal(result.terms[0].label, 'Spring 2027');
  assert.equal(result.inProgress.label, 'Fall 2026');
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
  assert.ok(vision.reasons.some((r) => r.includes('ENGR 3520')));
  assert.ok(!vision.reasons.some((r) => r.includes('first offered')), 'it is already offered by the Fall 2027 start');
  const spring = M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, firstTerm: '2027SP', electives });
  const early = M.electiveCards(catalog, offerings, spring, today).find((c) => c.id === 'ENGR 4570');
  assert.ok(early.reasons.some((r) => r.includes('first offered in Fall 2027')));
});

test('a lighter credit load graduates later than the standard load', () => {
  const loads = Object.fromEntries(M.compareLoads(catalog, offerings, firstSemester(), today).map((l) => [l.key, l]));
  assert.equal(loads.standard.graduationLabel, 'Spring 2031');
  assert.equal(loads.heavy.graduationLabel, 'Spring 2031');
  assert.equal(loads.light.graduationLabel, 'Spring 2032');
});

test('class times fall back to the same season in an earlier year', () => {
  assert.deepEqual(M.scheduleCandidates('2027SP').slice(0, 3), ['2027SP', '2026SP', '2025SP']);
});
