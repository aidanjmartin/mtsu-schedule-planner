// Engine tests. Run with: node --test tests/
// These use the small synthetic fixtures in tests/fixtures. They do not need real MTSU data.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as terms from '../web/engine/terms.js';
import * as prereqs from '../web/engine/prereqs.js';
import * as validate from '../web/engine/validate.js';
import { analyzeCriticalPath, buildModel } from '../web/engine/critical-path.js';
import { planTerms } from '../web/engine/planner.js';
import * as timetable from '../web/engine/timetable.js';
import * as whatif from '../web/engine/whatif.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

const catalog = load('catalog-small.json');
const offerings = load('offerings-small.json');
const schedule = load('schedule-small.json');

const freshStudent = (extra = {}) => ({
  start_term: '2026FA', completed: [], in_progress: [], options: {}, ...extra,
});

// -------------------------------------------------------------------- terms

test('terms: parse, index, and label', () => {
  assert.deepEqual(terms.parseTerm('2026FA'), { year: 2026, code: 'FA', season: 'fall' });
  assert.throws(() => terms.parseTerm('2026XX'));
  for (const t of ['2026FA', '2027SP', '2027SU', '2028FA']) assert.equal(terms.termFromIndex(terms.termIndex(t)), t);
  assert.equal(terms.termLabel('2027SP'), 'Spring 2027');
  assert.ok(terms.termIndex('2027SP') < terms.termIndex('2027SU'));
  assert.ok(terms.termIndex('2027SU') < terms.termIndex('2027FA'));
});

test('terms: next term and distance skip summer when summer is off', () => {
  assert.equal(terms.nextTerm('2026FA'), '2027SP');
  assert.equal(terms.nextTerm('2027SP'), '2027SU');
  assert.equal(terms.nextTerm('2027SP', { summer: false }), '2027FA');
  assert.equal(terms.termDistance('2026FA', '2027FA', { summer: false }), 2);
  assert.equal(terms.termDistance('2026FA', '2027FA', { summer: true }), 3);
  assert.equal(terms.termDistance('2027FA', '2026FA', { summer: false }), -2);
});

test('terms: axis and suggested positions', () => {
  const axis = terms.buildTermAxis('2026FA', { summerAllowed: false, count: 5 });
  assert.deepEqual(axis.terms, ['2026FA', '2027SP', '2027FA', '2028SP', '2028FA']);
  const withSummer = terms.buildTermAxis('2026FA', { summerAllowed: true, count: 4 });
  assert.deepEqual(withSummer.terms, ['2026FA', '2027SP', '2027SU', '2027FA']);
  assert.equal(terms.parseSuggested('junior-fall'), 6);
  assert.equal(terms.suggestedFromPosition(7), 'junior-spring');
  assert.equal(terms.suggestedLabel('senior-spring'), 'Senior spring');
});

// ------------------------------------------------------------------ prereqs

test('prereqs: normalize, describe, and evaluate', () => {
  const expr = { all: ['A 1000', { any: ['B 1000', 'C 1000'] }, { course: 'D 1000', concurrent_ok: true }] };
  assert.equal(prereqs.describePrereqs(expr), 'A 1000 and (B 1000 or C 1000) and D 1000 (may be taken at the same time)');
  assert.deepEqual(prereqs.prereqCourses(expr), ['A 1000', 'B 1000', 'C 1000', 'D 1000']);
  assert.equal(prereqs.normalizePrereqs(null), null);
  assert.throws(() => prereqs.normalizePrereqs({ nonsense: 1 }));

  const done = new Set(['A 1000', 'C 1000']);
  assert.equal(prereqs.evaluatePrereqs(expr, { before: done }).ok, false);
  assert.deepEqual(prereqs.evaluatePrereqs(expr, { before: done }).missing, ['D 1000 (may be taken at the same time)']);
  assert.equal(prereqs.evaluatePrereqs(expr, { before: done, same: new Set(['D 1000']) }).ok, true);
  assert.equal(prereqs.evaluatePrereqs(null).ok, true);
  assert.equal(prereqs.evaluatePrereqs({ any: ['X 1', 'Y 1'] }, { before: new Set() }).ok, false);
});

test('prereqs: ready ordinal treats concurrent prerequisites as same-term and any-of as the earliest', () => {
  const placed = { 'A 1': 2, 'B 1': 5 };
  const termOf = (c) => (c in placed ? placed[c] : Infinity);
  assert.equal(prereqs.readyOrdinal('A 1', termOf), 3);
  assert.equal(prereqs.readyOrdinal({ course: 'A 1', concurrent_ok: true }, termOf), 2);
  assert.equal(prereqs.readyOrdinal({ all: ['A 1', 'B 1'] }, termOf), 6);
  assert.equal(prereqs.readyOrdinal({ any: ['A 1', 'B 1'] }, termOf), 3);
  assert.equal(prereqs.readyOrdinal(null, termOf), -Infinity);
  assert.equal(prereqs.readyOrdinal('Z 9', termOf), Infinity);
});

test('prereqs: offering seasons come from edits, then data, then the suggested season', () => {
  const data = prereqs.effectiveSeasons(catalog, 'ENGR 3530', offerings);
  assert.deepEqual([...data.seasons].sort(), ['fall', 'spring']);
  assert.equal(data.source, 'data');

  const none = prereqs.effectiveSeasons(catalog, 'ENGR 3530', null);
  assert.deepEqual([...none.seasons], ['spring']);
  assert.equal(none.source, 'assumed');

  const edited = clone(catalog);
  edited.courses['ENGR 3530'].season_override = ['fall'];
  assert.equal(prereqs.effectiveSeasons(edited, 'ENGR 3530', offerings).source, 'edit');

  const occ = clone(offerings);
  occ.courses['ENGR 1100'].occasional_seasons = ['spring'];
  assert.deepEqual([...prereqs.effectiveSeasons(catalog, 'ENGR 1100', occ).seasons], ['fall']);
  assert.deepEqual(
    [...prereqs.effectiveSeasons(catalog, 'ENGR 1100', occ, { includeOccasional: true }).seasons].sort(),
    ['fall', 'spring'],
  );
});

test('prereqs: requirements resolve choices and placeholders', () => {
  let r = prereqs.resolveRequirements(catalog, {});
  assert.ok(r.required.has('ENGR 4540') && !r.required.has('ENGR 4550'));
  r = prereqs.resolveRequirements(catalog, { choices: { 'engr-elective': ['ENGR 4550'] } });
  assert.ok(r.required.has('ENGR 4550') && !r.required.has('ENGR 4540'));
  r = prereqs.resolveRequirements(catalog, { completed: ['ENGR 4550'] });
  assert.ok(r.required.has('ENGR 4550'), 'a completed option satisfies the choice');
  assert.equal(r.placeholders[0].done, false);
  assert.equal(prereqs.resolveRequirements(catalog, { completed: ['tbc-history'] }).placeholders[0].done, true);
});

test('prereqs: needed prerequisites that the degree does not list are added', () => {
  const c = clone(catalog);
  c.courses['ENGR 4540'].prereqs = { all: ['ENGR 4550'] };
  const { required, added } = prereqs.closeOverPrereqs(c, new Set(['ENGR 4540']), []);
  assert.deepEqual(added.slice(0, 1), ['ENGR 4550']);
  assert.ok(required.has('ENGR 3530'), 'added courses bring their own prerequisites');
});

// ----------------------------------------------------------------- validate

test('validate: the fixture catalog is clean', () => {
  const result = validate.validateCatalog(catalog);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('validate: finds cycles, unknown courses, and requirements nobody can satisfy', () => {
  const c = clone(catalog);
  c.courses['MATH 1730'].prereqs = { all: ['ENGR 4590'] };
  c.courses['ENGR 1100'].prereqs = { all: ['NOPE 1000'] };
  c.requirements[1].count = 3;
  const codes = validate.validateCatalog(c).errors.map((e) => e.code);
  assert.ok(codes.includes('cycle'));
  assert.ok(codes.includes('unknown_course'));
  assert.ok(codes.includes('unsatisfiable_requirement'));
});

test('validate: a cycle linked only by same-term prerequisites is a warning', () => {
  const c = clone(catalog);
  c.courses['CSCI 1170'].prereqs = { all: [{ course: 'ENGR 1100', concurrent_ok: true }] };
  c.courses['ENGR 1100'].prereqs = { all: [{ course: 'CSCI 1170', concurrent_ok: true }] };
  const result = validate.validateCatalog(c);
  assert.ok(result.warnings.some((w) => w.code === 'concurrent_cycle'));
  assert.ok(!result.errors.some((e) => e.code === 'cycle'));
});

test('validate: a loop that exists only through an any-of choice is a warning', () => {
  const c = clone(catalog);
  c.courses['CSCI 1170'].prereqs = { any: ['ENGR 1100', 'ENGR 3520'] };
  const result = validate.validateCatalog(c);
  assert.ok(result.warnings.some((w) => w.code === 'possible_cycle'));
  assert.ok(!result.errors.some((e) => e.code === 'cycle'));
});

test('validate: each course must sit in exactly one requirement', () => {
  const c = clone(catalog);
  c.requirements[1].options.push('ENGR 1100');
  c.requirements[0].courses = c.requirements[0].courses.filter((x) => x !== 'CSCI 1170');
  const codes = validate.validateCatalog(c).errors.map((e) => e.code);
  assert.ok(codes.includes('many_requirements'));
  assert.ok(codes.includes('no_requirement'));
});

test('validate: CHECK notes are listed', () => {
  const c = clone(catalog);
  c.courses['ENGR 2100'].notes = 'CHECK: the description and the map disagree.';
  assert.deepEqual(validate.validateCatalog(c).checks, [{ course: 'ENGR 2100', note: 'CHECK: the description and the map disagree.' }]);
});

test('acceptance 2 (fixture): the suggested schedule passes the prerequisite check', () => {
  assert.deepEqual(validate.checkSuggestedSchedule(catalog), []);
});

test('validate: a placement that breaks a prerequisite or a standing rule is reported', () => {
  const { placement, counted } = validate.suggestedPlacement(catalog);
  const broken = { ...placement, 'ENGR 3520': 3 }; // same position as ENGR 2100 is sophomore-spring (4); move earlier
  const violations = validate.checkPlacement(catalog, broken, { counted });
  assert.ok(violations.some((v) => v.course === 'ENGR 3520' && v.kind === 'prerequisite'));
  const early = { ...placement, 'ENGR 4580': 1 };
  const kinds = validate.checkPlacement(catalog, early, { counted }).map((v) => v.kind);
  assert.ok(kinds.includes('standing') && kinds.includes('prerequisite'));
  const concurrentOk = { ...placement, 'PHYS 2110': placement['MATH 1910'] };
  assert.deepEqual(validate.checkPlacement(catalog, concurrentOk, { counted }).filter((v) => v.course === 'PHYS 2110'), []);
});

test('validate: schedule shape check catches bad times', () => {
  assert.deepEqual(validate.validateSchedule(schedule), []);
  const bad = clone(schedule);
  bad.sections[0].meetings[0].end = '07:00';
  assert.equal(validate.validateSchedule(bad).length, 1);
});

// ------------------------------------------------------------- critical path

test('critical path: forward and backward passes on the small catalog', () => {
  const a = analyzeCriticalPath({ catalog, offerings, student: freshStudent() });
  assert.equal(a.finish_term, '2030SP');
  assert.equal(a.courses['MATH 1730'].earliest_term, '2026FA');
  assert.equal(a.courses['ENGR 2100'].earliest_term, '2028SP', 'spring-only course waits for spring');
  assert.equal(a.courses['PHYS 2110'].earliest_term, '2027SP', 'a same-term prerequisite allows the same term');
  assert.equal(a.courses['MATH 1910'].earliest_term, '2027SP');
  assert.deepEqual(a.critical, ['ENGR 2100', 'ENGR 3520', 'ENGR 3530', 'ENGR 4540', 'ENGR 4580', 'ENGR 4590']);
  assert.equal(a.courses['ENGR 1100'].slack, 2);
  assert.equal(a.courses['MATH 1730'].slack, 1);
  assert.equal(a.courses['PHYS 2110'].slack, 2);
  assert.equal(a.courses['ENGR 4540'].status, 'todo');
  assert.equal(a.courses['ENGR 4550'].status, 'optional');
  assert.equal(a.courses['ENGR 4550'].slack, null);
  assert.equal(a.feasible, true);
});

test('critical path: an any-of prerequisite follows its earliest alternative only', () => {
  const a = analyzeCriticalPath({ catalog, offerings, student: freshStudent() });
  // ENGR 3520 needs PHYS 2110 or CSCI 1170. Both are ready at the same time, so the first listed binds.
  assert.equal(a.courses['PHYS 2110'].latest_term, '2028SP');
  assert.ok(a.courses['CSCI 1170'].slack > a.courses['PHYS 2110'].slack);
});

test('critical path: slack toward a milestone and toward a later target', () => {
  const a = analyzeCriticalPath({ catalog, offerings, student: freshStudent() });
  const m = a.milestones['senior-design'];
  assert.equal(m.start_term, '2029FA');
  assert.equal(m.end_term, '2030SP');
  assert.ok(m.critical.includes('ENGR 3530'));
  assert.ok(!('ENGR 4540' in m.slack), 'courses that do not lead to senior design have no milestone slack');

  const relaxed = analyzeCriticalPath({
    catalog, offerings, student: freshStudent({ options: { target_term: '2031SP' } }),
  });
  assert.equal(relaxed.courses['ENGR 4590'].slack, 2);
  assert.deepEqual(relaxed.critical, []);
  const tight = analyzeCriticalPath({ catalog, offerings, student: freshStudent({ options: { target_term: '2029SP' } }) });
  assert.ok(tight.courses['ENGR 4590'].slack < 0, 'a target before the earliest finish gives negative slack');
});

test('critical path: standing hours can delay a course', () => {
  const c = clone(catalog);
  c.standing_hours.senior = 33;
  const a = analyzeCriticalPath({ catalog: c, offerings, student: freshStudent() });
  assert.equal(a.courses['ENGR 4580'].earliest_term, '2030FA');
  const impossible = clone(catalog);
  impossible.standing_hours.senior = 90;
  const b = analyzeCriticalPath({ catalog: impossible, offerings, student: freshStudent() });
  assert.equal(b.feasible, false);
  assert.ok(b.blocked.some((x) => x.course === 'ENGR 4580'));
});

test('critical path: completed courses drop out and in-progress courses count as this term', () => {
  const a = analyzeCriticalPath({
    catalog, offerings,
    student: freshStudent({ completed: ['MATH 1730', 'ENGR 1100'], in_progress: ['MATH 1910'] }),
  });
  assert.equal(a.courses['MATH 1730'].status, 'completed');
  assert.equal(a.courses['MATH 1910'].earliest_term, '2026FA');
  assert.equal(a.courses['ENGR 2100'].earliest_term, '2027SP');
  assert.equal(a.finish_term, '2029SP');
});

test('critical path: missing offering data falls back to the suggested season and says so', () => {
  const a = analyzeCriticalPath({ catalog, offerings: null, student: freshStudent() });
  assert.ok(a.assumptions.some((s) => /suggested season/.test(s)));
  assert.equal(a.courses['ENGR 4580'].season_source, 'assumed');
  assert.deepEqual(a.courses['ENGR 4580'].seasons, ['fall']);
});

test('critical path: a course offered in no season is reported as blocked', () => {
  const o = clone(offerings);
  o.courses['ENGR 3520'].regular_seasons = [];
  const a = analyzeCriticalPath({ catalog, offerings: o, student: freshStudent() });
  assert.equal(a.feasible, false);
  const blocked = a.blocked.map((b) => b.course);
  assert.ok(blocked.includes('ENGR 3520') && blocked.includes('ENGR 4590'));
});

test('critical path: occasional offerings are used only when allowed', () => {
  const o = clone(offerings);
  o.courses['ENGR 3520'].regular_seasons = [];
  o.courses['ENGR 3520'].occasional_seasons = ['fall'];
  const off = analyzeCriticalPath({ catalog, offerings: o, student: freshStudent() });
  assert.equal(off.feasible, false);
  const on = analyzeCriticalPath({ catalog, offerings: o, student: freshStudent({ options: { include_occasional: true } }) });
  assert.equal(on.feasible, true);
});

test('model: unknown completed ids are ignored with a warning', () => {
  const model = buildModel({ catalog, offerings, student: freshStudent({ completed: ['ENGL 1010', 'tbc-history'] }) });
  assert.ok(model.warnings.some((w) => w.includes('ENGL 1010')));
  assert.ok(!model.warnings.some((w) => w.includes('tbc-history')));
  assert.equal(model.completedHours, 6);
});

// ------------------------------------------------------------------ planner

const termOf = (plan, course) => plan.placements[course];

test('planner: baseline plan for a student with nothing completed', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent() });
  assert.equal(plan.graduation_term, '2030SP');
  assert.deepEqual(plan.terms.map((t) => t.term), ['2026FA', '2027SP', '2027FA', '2028SP', '2028FA', '2029SP', '2029FA', '2030SP']);
  assert.equal(termOf(plan, 'MATH 1730'), '2026FA');
  assert.equal(termOf(plan, 'MATH 1910'), '2027SP');
  assert.equal(termOf(plan, 'PHYS 2110'), '2027SP');
  assert.equal(termOf(plan, 'CSCI 1170'), '2027SP');
  assert.equal(termOf(plan, 'ENGR 2100'), '2028SP');
  assert.equal(termOf(plan, 'ENGR 4580'), '2029FA');
  assert.equal(plan.milestones[0].start_term, '2029FA');
  assert.deepEqual(plan.unplaced, []);
  assert.equal(plan.remaining_hours, 32 + 3 + 6);
});

test('planner: general education hours are reserved in their preferred terms', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent() });
  const reserved = plan.terms.filter((t) => t.placeholders.length).map((t) => [t.term, t.placeholders[0].hours]);
  assert.deepEqual(reserved, [['2027FA', 3], ['2028FA', 3]]);
  const fall27 = plan.terms.find((t) => t.term === '2027FA');
  assert.equal(fall27.credits, 3);
});

test('planner: a completed placeholder reserves nothing', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent({ completed: ['tbc-history'] }) });
  assert.ok(plan.terms.every((t) => t.placeholders.length === 0));
});

test('planner: the credit limit pushes courses later and the reason says so', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent({ completed: ['tbc-history'], options: { max_credits: 4 } }) });
  assert.equal(termOf(plan, 'MATH 1730'), '2026FA');
  assert.equal(termOf(plan, 'ENGR 1100'), '2027FA');
  for (const t of plan.terms) assert.ok(t.credits <= t.capacity, `${t.term} stays within its limit`);
  const chain = plan.drivers.graduation.chain.map((s) => s.course);
  assert.ok(chain.length > 0);
  assert.ok(plan.terms.flatMap((t) => t.courses).some((c) => c.reason === 'credit limit'));
});

test('planner: summer terms are used only when allowed', () => {
  const off = clone(offerings);
  off.courses['ENGR 2100'].regular_seasons = ['spring', 'summer'];
  const without = planTerms({ catalog, offerings: off, student: freshStudent() });
  assert.ok(without.terms.every((t) => t.season !== 'summer'));
  const withSummer = planTerms({ catalog, offerings: off, student: freshStudent({ options: { summer_allowed: true } }) });
  assert.equal(termOf(withSummer, 'ENGR 2100'), '2027SU');
  assert.ok(terms.termIndex(withSummer.graduation_term) <= terms.termIndex(without.graduation_term));
});

test('planner: choice of elective changes the plan', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent({ choices: { 'engr-elective': ['ENGR 4550'] } }) });
  assert.equal(termOf(plan, 'ENGR 4550'), '2030SP', 'spring-only, after ENGR 3530');
  assert.ok(!('ENGR 4540' in plan.placements));
});

test('planner: courses in progress fill the first term', () => {
  const plan = planTerms({
    catalog, offerings,
    student: freshStudent({ completed: ['MATH 1730'], in_progress: ['ENGR 1100'] }),
  });
  assert.equal(plan.terms[0].credits, 2 + plan.terms[0].courses.filter((c) => c.course !== 'ENGR 1100').reduce((s, c) => s + c.credits, 0));
  assert.equal(termOf(plan, 'ENGR 1100'), '2026FA');
});

test('acceptance 5 (fixture): two starting points get plans and the difference is explained', () => {
  const slow = planTerms({ catalog, offerings, student: freshStudent() });
  const fast = planTerms({ catalog, offerings, student: freshStudent({ completed: ['MATH 1730'] }) });
  assert.equal(slow.milestones[0].start_term, '2029FA');
  assert.equal(fast.milestones[0].start_term, '2028FA');
  const diff = whatif.diffPlans(slow, fast);
  assert.equal(diff.milestones[0].delta_terms, -2);
  const names = diff.responsible['senior-design'].map((r) => r.course);
  assert.ok(names.includes('MATH 1910') || names.includes('MATH 1730'), 'math sequence is named as responsible');
  assert.ok(diff.moved.some((m) => m.course === 'MATH 1730' && m.to === null));
});

test('planner: courses with no place inside the window are listed, not dropped', () => {
  const o = clone(offerings);
  o.courses['ENGR 3520'].regular_seasons = [];
  const plan = planTerms({ catalog, offerings: o, student: freshStudent() });
  assert.equal(plan.graduation_term, null);
  assert.ok(plan.unplaced.some((u) => u.course === 'ENGR 3520'));
  assert.ok(plan.warnings.some((w) => w.includes('ENGR 3520')));
});

test('planner: the driving chain names the courses that set the senior design start', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent() });
  const chain = plan.drivers.milestones['senior-design'].map((s) => s.course);
  assert.deepEqual(chain, ['MATH 1730', 'MATH 1910', 'ENGR 2100', 'ENGR 3520', 'ENGR 3530', 'ENGR 4580']);
  const reasons = Object.fromEntries(plan.drivers.milestones['senior-design'].map((s) => [s.course, s.reason]));
  assert.equal(reasons['ENGR 2100'], 'offering');
});

// ---------------------------------------------------------------- timetable

const FALL_COURSES = ['MATH 1730', 'ENGR 1100', 'PHYS 2110'];

test('timetable: lists every conflict-free combination and ranks by campus days then early classes', () => {
  const r = timetable.planTimetables({ courses: FALL_COURSES, catalog, schedule, limit: 50 });
  assert.equal(r.total, 10);
  assert.equal(r.options.length, 10);
  const best = r.options[0];
  assert.equal(best.campus_days, 4);
  assert.equal(best.early_classes, 1);
  const crns = best.choices.map((c) => c.crn);
  assert.ok(crns.includes('10001') && crns.includes('10012') && crns.includes('10021'));
  const sorted = [...r.options].sort((a, b) => a.campus_days - b.campus_days || a.early_classes - b.early_classes);
  assert.deepEqual(r.options.map((o) => [o.campus_days, o.early_classes]), sorted.map((o) => [o.campus_days, o.early_classes]));
  for (const option of r.options) {
    for (let i = 0; i < option.choices.length; i += 1) {
      for (let j = i + 1; j < option.choices.length; j += 1) {
        const a = { meetings: option.choices[i].meetings };
        const b = { meetings: option.choices[j].meetings };
        assert.equal(timetable.sectionsOverlap(a, b), null, 'no two chosen sections overlap');
      }
    }
  }
});

test('timetable: a lecture and its lab count as one choice', () => {
  const r = timetable.planTimetables({ courses: ['PHYS 2110'], catalog, schedule, limit: 10 });
  assert.equal(r.total, 2, 'one lecture times two labs');
  for (const option of r.options) {
    assert.deepEqual(option.choices.map((c) => c.component).sort(), ['PHYS 2110', 'PHYS 2111']);
  }
});

test('acceptance 6 (fixture): two known overlapping sections produce a conflict report naming both courses', () => {
  const s = clone(schedule);
  s.sections = s.sections.filter((x) => ['10003', '10011', '10021', '10022', '10023'].includes(x.crn));
  s.sections.find((x) => x.crn === '10003').meetings[0] = {
    days: 'TR', start: '10:00', end: '11:20', location: 'FIX 100', start_date: '2026-08-24', end_date: '2026-12-11',
  };
  const movable = (course) => ({ can_move: course === 'ENGR 1100', to_term: course === 'ENGR 1100' ? '2027FA' : null, slack: course === 'ENGR 1100' ? 2 : 0 });
  const r = timetable.planTimetables({ courses: ['MATH 1730', 'ENGR 1100'], catalog, schedule: s, movable });
  assert.equal(r.options.length, 0);
  assert.equal(r.conflicts.length, 1);
  const conflict = r.conflicts[0];
  assert.deepEqual([...conflict.courses].sort(), ['ENGR 1100', 'MATH 1730']);
  assert.match(conflict.reason, /ENGR 1100/);
  assert.match(conflict.reason, /MATH 1730/);
  assert.equal(conflict.examples[0].day === 'T' || conflict.examples[0].day === 'R', true);
  const byCourse = Object.fromEntries(conflict.resolutions.map((x) => [x.course, x]));
  assert.equal(byCourse['ENGR 1100'].can_move, true);
  assert.equal(byCourse['ENGR 1100'].move_to, '2027FA');
  assert.equal(byCourse['MATH 1730'].can_move, false);
  assert.equal(byCourse['ENGR 1100'].fits_without, true);
});

test('timetable: finds the smallest conflicting set among many courses', () => {
  const s = clone(schedule);
  s.sections = s.sections.filter((x) => ['10003', '10011', '10021', '10022', '10023'].includes(x.crn));
  s.sections.find((x) => x.crn === '10003').meetings[0].start = '10:00';
  s.sections.find((x) => x.crn === '10003').meetings[0].end = '11:20';
  const r = timetable.planTimetables({ courses: ['MATH 1730', 'ENGR 1100', 'PHYS 2110'], catalog, schedule: s });
  assert.deepEqual([...r.conflicts[0].courses].sort(), ['ENGR 1100', 'MATH 1730']);
  assert.equal(r.conflicts[0].minimal, true);
});

test('timetable: online sections never conflict and sections in different date ranges do not overlap', () => {
  const s = clone(schedule);
  s.sections = s.sections.filter((x) => x.crn === '10003' || x.crn === '10011');
  s.sections.find((x) => x.crn === '10003').meetings[0] = {
    days: 'TR', start: '09:40', end: '11:05', location: 'FIX 100', start_date: '2026-08-24', end_date: '2026-12-11',
  };
  assert.equal(timetable.planTimetables({ courses: ['MATH 1730', 'ENGR 1100'], catalog, schedule: s }).options.length, 0);

  const online = clone(s);
  online.sections.find((x) => x.crn === '10011').meetings = [];
  online.sections.find((x) => x.crn === '10011').instructional_method = 'Online';
  const r = timetable.planTimetables({ courses: ['MATH 1730', 'ENGR 1100'], catalog, schedule: online });
  assert.equal(r.total, 1);
  assert.equal(r.options[0].campus_days, 2, 'an online section adds no campus day');

  const halves = clone(s);
  halves.sections.find((x) => x.crn === '10003').meetings[0].end_date = '2026-10-09';
  halves.sections.find((x) => x.crn === '10011').meetings[0].start_date = '2026-10-12';
  assert.equal(timetable.planTimetables({ courses: ['MATH 1730', 'ENGR 1100'], catalog, schedule: halves }).total, 1);
});

test('timetable: courses with no sections are reported and a missing schedule is flagged', () => {
  const r = timetable.planTimetables({ courses: ['MATH 1730', 'CSCI 1170'], catalog, schedule });
  assert.deepEqual(r.no_sections.map((x) => x.course), ['CSCI 1170']);
  assert.ok(r.total > 0);
  assert.equal(timetable.planTimetables({ courses: ['MATH 1730'], catalog, schedule: null }).available, false);
});

test('timetable: course pairs that can never fit together are listed even when a full combination exists', () => {
  const s = clone(schedule);
  // MATH 1730 sections 001 and 002 stay; make every ENGR 1100 section overlap every MATH 1730 section.
  s.sections = s.sections.filter((x) => ['10001', '10011', '10021', '10022', '10023'].includes(x.crn));
  s.sections.find((x) => x.crn === '10011').meetings[0] = {
    days: 'MWF', start: '08:30', end: '09:30', location: 'FIX 200', start_date: '2026-08-24', end_date: '2026-12-11',
  };
  const pairs = timetable.incompatiblePairs({ courses: ['MATH 1730', 'ENGR 1100', 'PHYS 2110'], catalog, schedule: s });
  assert.deepEqual(pairs, [['MATH 1730', 'ENGR 1100']]);
  assert.deepEqual(timetable.incompatiblePairs({ courses: ['MATH 1730', 'PHYS 2110'], catalog, schedule }), []);
});

test('timetable: meeting overlap rule', () => {
  const base = { days: 'MWF', start: '09:00', end: '09:50', start_date: '2026-08-24', end_date: '2026-12-11' };
  assert.equal(timetable.meetingsOverlap(base, { ...base, days: 'TR' }), false);
  assert.equal(timetable.meetingsOverlap(base, { ...base, start: '09:50', end: '10:40' }), false, 'touching times do not overlap');
  assert.equal(timetable.meetingsOverlap(base, { ...base, start: '09:30', end: '10:40', days: 'F' }), true);
  assert.equal(timetable.meetingsOverlap(base, { ...base, start_date: '2027-01-10', end_date: '2027-04-30' }), false);
});

// ------------------------------------------------------------------- what-if

test('what-if: edits apply in order to copies and leave the inputs alone', () => {
  const before = JSON.stringify(catalog);
  const result = whatif.applyEdits({
    catalog,
    edits: [
      { type: 'set_credits', course: 'ENGR 2100', credits: 4 },
      { type: 'set_seasons', course: 'ENGR 3530', regular_seasons: ['fall'] },
      { type: 'set_prereqs', course: 'ENGR 4580', prereqs: { all: ['ENGR 3520'] } },
      { type: 'move_requirement', course: 'ENGR 4550', to: 'major-core' },
    ],
  });
  assert.equal(JSON.stringify(catalog), before);
  assert.deepEqual(result.errors, []);
  assert.equal(result.catalog.courses['ENGR 2100'].credits, 4);
  assert.deepEqual(result.catalog.courses['ENGR 3530'].season_override, ['fall']);
  assert.deepEqual(result.catalog.courses['ENGR 4580'].prereqs, { all: ['ENGR 3520'] });
  assert.ok(result.catalog.requirements[0].courses.includes('ENGR 4550'));
  assert.ok(!result.catalog.requirements[1].options.includes('ENGR 4550'));
});

test('what-if: bad edits are skipped and listed', () => {
  const result = whatif.applyEdits({
    catalog,
    edits: [
      { type: 'set_credits', course: 'NOPE 1', credits: 3 },
      { type: 'set_prereqs', course: 'ENGR 4580', prereqs: { all: ['NOPE 2'] } },
      { type: 'move_requirement', course: 'ENGR 4580', to: 'tbc-history' },
      { type: 'frobnicate', course: 'ENGR 4580' },
    ],
  });
  assert.equal(result.errors.length, 4);
  assert.deepEqual(result.applied, []);
});

test('what-if: an edit that creates a prerequisite cycle is reported', () => {
  const result = whatif.applyEdits({
    catalog, edits: [{ type: 'set_prereqs', course: 'MATH 1730', prereqs: { all: ['ENGR 4590'] } }],
  });
  assert.ok(result.new_problems.some((p) => p.code === 'cycle'));
});

test('acceptance 7 (fixture): making ENGR 3530 fall-only changes the critical path and shows the difference', () => {
  const edits = [{ type: 'set_seasons', course: 'ENGR 3530', regular_seasons: ['fall'] }];
  const result = whatif.compareScenario({ catalog, offerings, student: freshStudent(), edits });
  const { diff } = result;
  assert.equal(diff.graduation.base, '2030SP');
  assert.equal(diff.graduation.alt, '2031SP');
  assert.equal(diff.graduation.delta_terms, 2);
  assert.equal(diff.milestones[0].alt_start, '2030FA');
  assert.deepEqual(diff.critical.removed, ['ENGR 4540']);
  assert.ok(diff.critical.unchanged.includes('ENGR 3530'));
  assert.ok(diff.critical.slack_changes.some((c) => c.course === 'ENGR 4540' && c.from === 0 && c.to === 2));
  assert.ok(diff.moved.some((m) => m.course === 'ENGR 3530' && m.from === '2029SP' && m.to === '2029FA'));
  assert.ok(diff.responsible['senior-design'].some((r) => r.course === 'ENGR 3530'));
  const lines = whatif.summarizeDiff(diff);
  assert.ok(lines.some((l) => /Graduation moves from Spring 2030 to Spring 2031, 2 terms later/.test(l)));
  assert.ok(lines.some((l) => /Leaves the critical path: ENGR 4540/.test(l)));
});

test('what-if: no edits means no difference', () => {
  const result = whatif.compareScenario({ catalog, offerings, student: freshStudent(), edits: [] });
  assert.equal(result.diff.changed, false);
  assert.deepEqual(result.diff.critical.added, []);
  assert.deepEqual(result.diff.critical.removed, []);
});

test('what-if: a new meeting pattern changes the timetable result', () => {
  const s = clone(schedule);
  s.sections = s.sections.filter((x) => ['10003', '10011'].includes(x.crn));
  const planned = ['MATH 1730', 'ENGR 1100'];
  const base = timetable.planTimetables({ courses: planned, catalog, schedule: s });
  assert.equal(base.total, 1);
  const { schedules } = whatif.applyEdits({
    catalog, schedules: { '2026FA': s },
    edits: [{ type: 'set_meeting_pattern', course: 'ENGR 1100', term: '2026FA', meetings: [{ days: 'TR', start: '13:00', end: '14:00' }] }],
  });
  const alt = timetable.planTimetables({ courses: planned, catalog, schedule: schedules['2026FA'] });
  assert.equal(alt.total, 0);
  assert.deepEqual([...alt.conflicts[0].courses].sort(), ['ENGR 1100', 'MATH 1730']);
  assert.equal(schedules['2026FA'].sections.find((x) => x.crn === '10011').meetings[0].start_date, '2026-08-24', 'dates carry over');
  const d = whatif.diffTimetables(base, alt);
  assert.deepEqual(d.total, { base: 1, alt: 0 });
  assert.deepEqual(d.conflict, { base: false, alt: true });
});

test('what-if: a meeting pattern for a term with no data adds a section the timetable can use', () => {
  const { schedules } = whatif.applyEdits({
    catalog, schedules: {},
    edits: [{ type: 'set_meeting_pattern', course: 'ENGR 3530', term: '2029SP', meetings: [{ days: 'W', start: '13:00', end: '16:00' }] }],
  });
  const r = timetable.planTimetables({ courses: ['ENGR 3530'], catalog, schedule: schedules['2029SP'] });
  assert.equal(r.total, 1);
  assert.equal(r.options[0].choices[0].meetings[0].end, '16:00');
});

test('what-if: term timetable uses the plan and reports who can move', () => {
  const plan = planTerms({ catalog, offerings, student: freshStudent() });
  const result = whatif.termTimetable({ plan, catalog, schedule, term: '2026FA' });
  assert.deepEqual(result.courses.sort(), ['ENGR 1100', 'MATH 1730']);
  assert.ok(result.total > 0);
  const movable = timetable.movableFromAnalysis(plan.analysis, '2026FA');
  assert.equal(movable('ENGR 1100').can_move, true, 'ENGR 1100 has slack, so it can wait for the next fall');
  assert.equal(movable('ENGR 1100').to_term, '2027FA');
  const inSpring = timetable.movableFromAnalysis(plan.analysis, '2028SP');
  assert.equal(inSpring('ENGR 2100').can_move, false, 'a zero-slack course cannot move');
});
