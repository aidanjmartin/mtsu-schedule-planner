// Tests for the course graph, the plan checker, the broken-plan what-if report, and the elective optimizer.
// They run against the real 2026-27 catalog, offering patterns, Spring 2027 class schedule, and career tracks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as engine from '../web/engine/index.js';
import {
  buildCourseModel, buildPrereqGraph, ancestors, descendants, levels, longestChain, prerequisitesOf,
} from '../web/engine/graph.js';
import { checkPlan, applyPlanFix, planFromPlanner, suggestReplan } from '../web/engine/checker.js';
import { findBrokenPlans, plannerPlans, applyEdits } from '../web/engine/whatif.js';
import { optimizeElectives, validateTracks, electiveSets, trackRequirement } from '../web/engine/electives.js';
import { planTerms } from '../web/engine/planner.js';
import { checkHourPicks } from '../web/engine/prereqs.js';
import { suggestedPlacement } from '../web/engine/validate.js';
import { termFromIndex, termIndex } from '../web/engine/terms.js';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(fs.readFileSync(new URL(path, root), 'utf8'));
const catalog = read('data/catalogs/2026-27.json');
const offerings = read('data/offerings.json');
const tracks = read('data/career-tracks.json');
const spring2027 = read('data/schedule/2027SP.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

// A first-semester student who starts in Fall 2027 with a 17-hour limit, as the plan page's Standard load.
const freshman = { start_term: '2027FA', start_position: 0, completed: [], in_progress: [], options: { max_credits: 17 } };
const freshmanPlan = () => planFromPlanner(planTerms({ catalog, offerings, student: freshman }), freshman);

const termWith = (plan, course) => plan.terms.find((t) => t.courses.some((c) => (c.course ?? c) === course));
const move = (plan, course, to) => {
  const out = clone(plan);
  const from = termWith(out, course);
  const entry = from.courses.find((c) => (c.course ?? c) === course);
  from.courses = from.courses.filter((c) => c !== entry);
  let target = out.terms.find((t) => t.term === to);
  if (!target) { target = { term: to, courses: [] }; out.terms.push(target); }
  target.courses.push(entry);
  return out;
};
const kinds = (result) => result.issues.map((i) => i.kind);
const find = (result, kind, course) => result.issues.find((i) => i.kind === kind && (!course || i.course === course));

// ------------------------------------------------------------------- graph

test('graph: every prerequisite in the catalog becomes an edge, and same-term links are corequisites', () => {
  const g = buildPrereqGraph(catalog);
  assert.equal(g.unknown.length, 0);
  assert.equal(g.nodes.length, Object.keys(catalog.courses).length);
  const edge = (from, to) => g.edges.find((e) => e.from === from && e.to === to);
  assert.equal(edge('ENGR 3590', 'ENGR 4580').kind, 'prerequisite');
  assert.equal(edge('ENGR 3540', 'ENGR 4580').kind, 'corequisite');
  assert.equal(edge('ENGR 3510', 'ENGR 3530').kind, 'corequisite');
  assert.equal(edge('MATH 1910', 'MATH 1920').min_grade, 'C');
  assert.deepEqual(prerequisitesOf(g, 'ENGR 4590').map((e) => e.from).sort(), ['ENGR 4510', 'ENGR 4580']);
  for (const [id, def] of Object.entries(catalog.courses)) {
    const count = JSON.stringify(def.prereqs ?? null).match(/[A-Z]{4} \d{4}/g)?.length ?? 0;
    assert.equal(prerequisitesOf(g, id).length, count, `${id} edge count`);
  }
});

test('graph: ancestors, descendants, levels, and the longest chain into senior design', () => {
  const g = buildPrereqGraph(catalog);
  const before = ancestors(g, 'ENGR 4580');
  for (const c of ['MATH 1910', 'PHYS 2110', 'CSCI 1170', 'ENGR 3590', 'ENGR 3540']) assert.ok(before.includes(c), c);
  assert.ok(!before.includes('ENGR 4510'), 'ENGR 4510 is needed for ENGR 4590, not ENGR 4580');
  assert.ok(descendants(g, 'MATH 1910').includes('ENGR 4590'));
  const lv = levels(catalog);
  assert.ok(Object.values(lv).every((v) => v !== null), 'the catalog has no prerequisite cycle');
  assert.equal(lv['MATH 1910'], 0);
  assert.equal(lv['ENGR 1100'], 0, 'corequisites add no term');
  assert.equal(lv['ENGR 4590'], 6);
  assert.deepEqual(longestChain(catalog, 'ENGR 4590'), ['MATH 1910', 'PHYS 2110', 'ENGR 2110', 'ENGR 2120', 'ENGR 3590', 'ENGR 4580', 'ENGR 4590']);
});

test('course model: seasons, roles, proposed courses, and standing come from the catalog and offering data', () => {
  const model = buildCourseModel(catalog, offerings);
  assert.equal(Object.keys(model.courses).length, Object.keys(catalog.courses).length);
  const sd = model.courses['ENGR 4580'];
  assert.deepEqual(sd.seasons, ['fall']);
  assert.equal(sd.role, 'required');
  assert.equal(sd.level, 4000);
  assert.equal(model.courses['ENGR 4550'].role, 'elective');
  assert.equal(model.courses['ENGR 4570'].available_from, '2027FA');
  assert.equal(model.courses['ENGR 4570'].proposed, true);
  assert.equal(model.courses['ENGR 3540'].proposed, false);
  assert.deepEqual(model.courses['ENGR 3600'].credits, { min: 1, max: 3 });
  assert.equal(model.courses['ENGR 3970'].standing_hours, 60);
  assert.deepEqual(model.courses['PHYS 2110'].components, ['PHYS 2110', 'PHYS 2111']);
  assert.equal(model.courses['MATH 3110'].season_source, 'data');
  assert.doesNotThrow(() => JSON.stringify(model));
});

test('the public interface exposes every engine module and the main functions', () => {
  for (const name of ['graph', 'checker', 'electives', 'whatif', 'planner', 'timetable', 'validate', 'prereqs', 'terms', 'critical']) {
    assert.equal(typeof engine[name], 'object', name);
  }
  for (const name of ['checkPlan', 'findBrokenPlans', 'optimizeElectives', 'buildCourseModel', 'buildPrereqGraph', 'planTerms', 'applyPlanFix']) {
    assert.equal(typeof engine[name], 'function', name);
  }
});

// ----------------------------------------------------------------- checker

test('checker: a plan the planner made passes, and senior design readiness names the course with no room to slip', () => {
  const result = checkPlan({ catalog, offerings, plan: freshmanPlan() });
  assert.equal(result.ok, true, result.issues.map((i) => i.message).join('\n'));
  assert.equal(result.counts.error, 0);
  const sd = result.readiness.find((r) => r.id === 'senior-design');
  assert.equal(sd.status, 'ready');
  assert.equal(sd.planned_term, '2030FA');
  assert.equal(sd.ready_term, '2030FA');
  const risk = sd.at_risk.find((r) => r.course === 'ENGR 3540');
  assert.ok(risk, 'ENGR 3540 shares the term with senior design and cannot slip');
  assert.equal(risk.new_start_term, '2031FA');
  assert.match(sd.message, /Ready for senior design in Fall 2030/);
  assert.match(result.summary, /no problems/);
});

test('checker: the academic map\'s own semesters pass the prerequisite, season, and standing checks', () => {
  const { placement } = suggestedPlacement(catalog);
  const { required } = engine.prereqs.resolveRequirements(catalog, {});
  const start = termIndex('2026FA');
  const terms = new Map();
  for (const [course, pos] of Object.entries(placement)) {
    if (!required.has(course)) continue;
    const term = termFromIndex(start + pos);
    if (!terms.has(term)) terms.set(term, []);
    terms.get(term).push(course);
  }
  const gen = new Map();
  for (const r of catalog.requirements.filter((x) => x.type === 'placeholder')) {
    for (const s of r.suggested_terms) {
      const term = termFromIndex(start + engine.terms.parseSuggested(s));
      gen.set(term, (gen.get(term) ?? 0) + r.hours / r.suggested_terms.length);
    }
  }
  const plan = {
    terms: [...terms].map(([term, courses]) => ({ term, courses, other_hours: gen.get(term) ?? 0 })),
    options: { max_credits: 19 },
  };
  const result = checkPlan({ catalog, offerings, plan, fixes: false });
  assert.deepEqual(result.issues.filter((i) => i.severity === 'error').map((i) => i.message), []);
  assert.equal(result.readiness[0].planned_term, '2029FA');
});

test('checker: senior design without its prerequisite is flagged, explained, and fixed by moving the prerequisite back', () => {
  const plan = move(freshmanPlan(), 'ENGR 3590', '2030FA');
  const result = checkPlan({ catalog, offerings, plan });
  const issue = find(result, 'missing_prerequisite', 'ENGR 4580');
  assert.ok(issue);
  assert.equal(issue.severity, 'error');
  assert.match(issue.message, /ENGR 4580 is planned for Fall 2030, but it needs ENGR 3590 \(in an earlier term; it is planned for Fall 2030\)/);
  assert.equal(issue.fixes[0].type, 'move');
  assert.equal(issue.fixes[0].course, 'ENGR 3590');
  assert.equal(issue.fixes[0].to, '2029FA');
  assert.equal(issue.fixes[0].text, 'Move ENGR 3590 from Fall 2030 to Fall 2029.');
  const sd = result.readiness[0];
  assert.equal(sd.status, 'not_ready');
  assert.deepEqual(sd.missing, ['ENGR 3590']);
  assert.equal(sd.ready_term, '2031FA', 'senior design runs in fall only, so the slip costs a year');
  const fixed = checkPlan({ catalog, offerings, plan: applyPlanFix(catalog, plan, issue.fixes[0]) });
  assert.equal(fixed.ok, true);
});

test('checker: courses in the wrong season or before they are first offered are flagged with a move to a term they run', () => {
  const plan = freshmanPlan();
  plan.terms.find((t) => t.term === '2030SP').courses.push({ course: 'ENGR 4580' });
  plan.terms.find((t) => t.term === '2030FA').courses = plan.terms.find((t) => t.term === '2030FA').courses.filter((c) => c.course !== 'ENGR 4580');
  const result = checkPlan({ catalog, offerings, plan });
  const issue = find(result, 'not_offered', 'ENGR 4580');
  assert.match(issue.message, /ENGR 4580 is planned for Spring 2030, but it runs in fall only\./);
  assert.ok(issue.fixes.some((f) => f.to === '2030FA'));

  const early = { completed: [], terms: [{ term: '2027SP', courses: ['ENGR 4570'] }] };
  const r2 = checkPlan({ catalog, offerings, plan: early, fixes: false });
  assert.match(find(r2, 'not_yet_offered', 'ENGR 4570').message, /first offered in Fall 2027/);
});

test('checker: an overloaded term gets a confirmed fix, and applying it clears the problem', () => {
  const plan = move(freshmanPlan(), 'ENGR 3915', '2029FA');
  const result = checkPlan({ catalog, offerings, plan });
  assert.deepEqual(result.issues.filter((i) => i.severity === 'error').map((i) => i.kind), ['overloaded_term']);
  const issue = find(result, 'overloaded_term');
  assert.equal(issue.term, '2029FA');
  assert.match(issue.message, /^Fall 2029 has \d\d credit hours, more than the 17-hour limit\.$/);
  assert.ok(issue.fixes.length > 0);
  const after = checkPlan({ catalog, offerings, plan: applyPlanFix(catalog, plan, issue.fixes[0]), fixes: false });
  assert.ok(!after.issues.some((i) => i.kind === 'overloaded_term' && i.term === '2029FA'));
  assert.equal(after.counts.error, 0);
});

test('checker: class standing, repeats, finished courses, missing requirements, and elective hours are reported', () => {
  const plan = {
    completed: ['MATH 1910', 'ENGR 1010', 'ENGR 1100'],
    terms: [
      { term: '2027SP', courses: ['ENGR 3970', 'MATH 1910', 'MATH 1920', 'ENGR 2100'] },
      { term: '2027FA', courses: ['MATH 1920'] },
    ],
  };
  const result = checkPlan({ catalog, offerings, plan });
  assert.match(find(result, 'class_standing', 'ENGR 3970').message, /needs junior standing \(60 credit hours finished\), but the plan has only 8 credit hours finished before Spring 2027/);
  assert.ok(find(result, 'already_completed', 'MATH 1910').fixes.some((f) => f.type === 'remove'));
  assert.ok(find(result, 'duplicate_course', 'MATH 1920'));
  assert.ok(find(result, 'missing_requirement', 'ENGR 4590'));
  assert.ok(find(result, 'missing_requirement', 'PHYS 2110').fixes.some((f) => f.type === 'add'));
  const hours = find(result, 'elective_hours');
  assert.match(hours.message, /3 credit hours of the 10 required/);
  assert.ok(find(result, 'milestone_not_planned', 'ENGR 4580'));
  assert.equal(result.readiness[0].status, 'not_planned');
  assert.ok(result.replan, 'a plan this far off gets a rebuilt plan');
  assert.match(result.replan.message, /A rebuilt plan moves \d+ courses and finishes in/);
});

test('checker: two courses whose Spring 2027 sections always overlap are a time conflict, with a move that clears it', () => {
  const plan = {
    completed: ['MATH 1910', 'ENGR 1010', 'ENGR 1100', 'MATH 1920', 'PHYS 2110', 'ENGR 2100', 'CHEM 1110', 'ENGR 2110', 'ENGR 2210', 'MATH 3110', 'PHYS 2120', 'ENGR 2120', 'ENGR 2130', 'MATH 3120', 'CSCI 1170'],
    terms: [{ term: '2027SP', courses: ['ENGR 3510', 'ENGR 3550'] }, { term: '2027FA', courses: ['ENGR 3590'] }],
  };
  const result = checkPlan({ catalog, offerings, schedules: { '2027SP': spring2027 }, plan, replan: false });
  const issue = find(result, 'time_conflict');
  assert.ok(issue, kinds(result).join(', '));
  assert.deepEqual([...issue.courses].sort(), ['ENGR 3510', 'ENGR 3550']);
  assert.match(issue.message, /In Spring 2027, no set of sections fits together\. Every section of ENGR 35[15]0 overlaps every section of ENGR 35[15]0\./);
  assert.ok(issue.fixes.length > 0);
  const fixed = checkPlan({ catalog, offerings, schedules: { '2027SP': spring2027 }, plan: applyPlanFix(catalog, plan, issue.fixes[0]), fixes: false });
  assert.ok(!find(fixed, 'time_conflict'));
});

test('checker: every fix offered for a broken plan clears its problem without adding a new error', () => {
  let plan = move(freshmanPlan(), 'ENGR 3590', '2030FA');
  plan = move(plan, 'ENGR 3915', '2028SP');
  const result = checkPlan({ catalog, offerings, plan, replan: false });
  const before = new Set(result.issues.filter((i) => i.severity === 'error').map((i) => i.id));
  let checked = 0;
  for (const issue of result.issues) {
    for (const fix of issue.fixes) {
      const after = checkPlan({ catalog, offerings, plan: applyPlanFix(catalog, plan, fix), fixes: false });
      const still = after.issues.find((i) => i.id === issue.id);
      if (fix.partial) assert.ok(still && still.amount < issue.amount, fix.text);
      else assert.ok(!still, fix.text);
      assert.deepEqual(after.issues.filter((i) => i.severity === 'error' && !before.has(i.id)).map((i) => i.message), [], fix.text);
      checked += 1;
    }
  }
  assert.ok(checked >= 4);
});

test('checker: a rebuilt plan keeps finished courses and elective picks', () => {
  const plan = move(freshmanPlan(), 'ENGR 3590', '2030FA');
  const replan = suggestReplan({ catalog, offerings, plan });
  const again = checkPlan({ catalog, offerings, plan: replan.plan });
  assert.equal(again.ok, true, again.issues.map((i) => i.message).join('\n'));
  assert.equal(again.readiness[0].planned_term, '2030FA');
});

// ------------------------------------------------------------------ what-if

const cohort = () => plannerPlans({
  catalog, offerings, students: [
    { ...freshman, id: 'fa27', label: 'Freshman starting Fall 2027' },
    {
      id: 'so28', label: 'Second year, Fall 2028', start_term: '2028FA', start_position: 3,
      completed: ['ENGR 1010', 'ENGR 1100', 'MATH 1910', 'CHEM 1110', 'ENGR 2100', 'MATH 1920', 'PHYS 2110'],
      options: { max_credits: 17 },
    },
  ],
});

test('what-if: plans made under the current catalog still pass when nothing changes', () => {
  const report = findBrokenPlans({ catalog, offerings, plans: cohort(), edits: [] });
  assert.deepEqual(report.plans.map((p) => p.status), ['still_ok', 'still_ok']);
  assert.match(report.summary, /0 of 2 plans break/);
});

test('what-if: moving senior design I to spring breaks every plan and says why', () => {
  const report = findBrokenPlans({
    catalog, offerings, plans: cohort(),
    edits: [{ type: 'set_seasons', course: 'ENGR 4580', regular_seasons: ['spring'] }],
  });
  assert.equal(report.counts.breaks, 2);
  for (const p of report.plans) {
    assert.equal(p.status, 'breaks');
    const issue = p.new_issues.find((i) => i.kind === 'not_offered' && i.course === 'ENGR 4580');
    assert.ok(issue, p.label);
    assert.match(issue.message, /runs in spring only/);
  }
  assert.match(report.summary, /Offer ENGR 4580 in spring only\. 2 of 2 plans break\./);
});

test('what-if: adding ENGR 4510 as a strict prerequisite of ENGR 4580 breaks plans that take them together', () => {
  const report = findBrokenPlans({
    catalog, offerings, plans: cohort(),
    edits: [{ type: 'set_prereqs', course: 'ENGR 4580', prereqs: { all: ['ENGR 3590', 'ENGR 4510', { course: 'ENGR 3540', concurrent_ok: true }, { course: 'ENGR 3550', concurrent_ok: true }] } }],
  });
  const p = report.plans[0];
  assert.equal(p.status, 'breaks');
  assert.ok(p.new_issues.some((i) => i.kind === 'missing_prerequisite' && i.courses.includes('ENGR 4510')));
  assert.equal(p.readiness.after.status, 'not_ready');
});

test('what-if: a new required course breaks every plan; removing a course breaks none and drops it from prerequisites', () => {
  const add = findBrokenPlans({
    catalog, offerings, plans: cohort(),
    edits: [{ type: 'add_course', course: 'ENGR 4620', requirement: 'engr-core', definition: { title: 'Capstone Seminar', credits: 1, prereqs: 'ENGR 3590', season_override: ['fall', 'spring'] } }],
  });
  assert.equal(add.edit_errors.length, 0);
  assert.equal(add.counts.breaks, 2);
  assert.ok(add.plans[0].new_issues[0].fixes.some((f) => f.type === 'add' && f.course === 'ENGR 4620'));

  const edits = [{ type: 'remove_course', course: 'ENGR 3530' }];
  const { catalog: changed, new_problems: problems } = applyEdits({ catalog, edits });
  assert.equal(changed.courses['ENGR 3530'], undefined);
  assert.ok(!JSON.stringify(changed.courses['ENGR 3540'].prereqs).includes('ENGR 3530'));
  assert.deepEqual(problems, []);
  const remove = findBrokenPlans({ catalog, offerings, plans: cohort(), edits });
  assert.equal(remove.counts.breaks, 0);
  assert.ok(remove.plans.every((p) => p.status === 'still_ok'), 'a course left in a plan after removal is only a warning');
});

test('what-if: a stricter standing rule breaks plans and bad edits are listed, not applied', () => {
  const report = findBrokenPlans({
    catalog, offerings, plans: cohort(),
    edits: [
      { type: 'set_standing', course: 'ENGR 3590', standing: 'senior' },
      { type: 'set_standing', course: 'ENGR 3590', standing: 'graduate' },
      { type: 'add_course', course: 'ENGR 3540', requirement: 'engr-core', definition: { title: 'Duplicate' } },
    ],
  });
  assert.equal(report.edit_errors.length, 2);
  assert.ok(report.plans[0].new_issues.some((i) => i.kind === 'class_standing' && i.course === 'ENGR 3590'));
});

// ---------------------------------------------------------------- electives

test('electives: the career tracks file matches the catalog', () => {
  assert.deepEqual(validateTracks(catalog, tracks), { errors: [], warnings: [] });
  assert.equal(trackRequirement(catalog, tracks).id, 'engr-elective');
});

test('electives: every candidate set adds up to 10 hours inside the 6-hour internship and research limit', () => {
  const req = trackRequirement(catalog, tracks);
  const sets = electiveSets(catalog, req);
  assert.ok(sets.length > 100);
  for (const picks of sets) assert.equal(checkHourPicks(catalog, req, picks).ok, true, JSON.stringify(picks));
  const keys = new Set(sets.map((s) => JSON.stringify(s)));
  assert.equal(keys.size, sets.length, 'no set appears twice');
});

test('electives: the robotics track picks robotics, machine vision, and embedded systems without delaying graduation', () => {
  const result = optimizeElectives({ catalog, offerings, tracks, track: 'robotics-automation', student: freshman });
  const best = result.recommendations[0];
  const courses = best.picks.map((p) => p.course);
  for (const c of ['ENGR 4550', 'ENGR 4570', 'ENGR 4560']) assert.ok(courses.includes(c), c);
  assert.equal(best.total_hours, 10);
  assert.ok(best.delay_terms <= 0);
  assert.ok(best.fit_percent >= 80);
  assert.match(best.explanation, /^Fits robotics and automation at \d+%\. ENGR 4550 and ENGR 4570 are central to the track\./);
  const replanned = planTerms({ catalog, offerings, student: { ...freshman, choices: best.choices } });
  assert.equal(replanned.graduation_term, best.graduation_term);
  assert.deepEqual(replanned.choices[0].selected.sort(), [...courses].sort());
  for (let i = 1; i < result.recommendations.length; i += 1) {
    const [a, b] = [result.recommendations[i - 1], result.recommendations[i]];
    assert.ok((a.delay_terms ?? 99) < (b.delay_terms ?? 99) || ((a.delay_terms ?? 99) === (b.delay_terms ?? 99) && a.fit >= b.fit) || a.senior_design_start < b.senior_design_start);
  }
});

test('electives: each track favors its own central courses', () => {
  const expect = {
    'manufacturing-management': ['ENGR 3915', 'ENGR 3970'],
    'energy-systems': ['ENGR 4540'],
    'graduate-research': ['ENGR 4600'],
    'professional-licensure': ['ENGR 4500'],
    'embedded-controls': ['ENGR 4560'],
  };
  for (const [track, central] of Object.entries(expect)) {
    const best = optimizeElectives({ catalog, offerings, tracks, track, student: freshman, limit: 1 }).recommendations[0];
    for (const c of central) assert.ok(best.picks.some((p) => p.course === c), `${track}: ${c}`);
  }
});

test('electives: finished and kept courses stay in, avoided courses stay out, and an unknown track is an error', () => {
  const student = { ...freshman, completed: ['ENGR 3915'] };
  const result = optimizeElectives({ catalog, offerings, tracks, track: 'robotics-automation', student, avoid: ['ENGR 4570'], keep: ['ENGR 4500'] });
  for (const rec of result.recommendations) {
    const courses = rec.picks.map((p) => p.course);
    assert.ok(courses.includes('ENGR 3915'));
    assert.ok(courses.includes('ENGR 4500'));
    assert.ok(!courses.includes('ENGR 4570'));
    assert.equal(rec.total_hours, 10);
  }
  assert.throws(() => optimizeElectives({ catalog, offerings, tracks, track: 'astronaut', student: freshman }), /no career track "astronaut"/);
});
