// The "Check a change" section of the plan page. A student moves a course to another semester, the engine's plan
// checker (web/engine/checker.js) checks the whole plan, and the page lists each conflict with the fixes the checker
// confirmed. Everything here is a pure function, so the Node tests run it directly.

import { checker as C, terms as T } from './engine.js';

/** Words for each kind of conflict, used as the heading of its card. */
export const CONFLICT_TITLES = {
  missing_prerequisite: 'Prerequisite not finished',
  class_standing: 'Class standing not reached',
  overloaded_term: 'Too many credit hours',
  light_term: 'Too few credit hours',
  not_offered: 'Not offered that semester',
  rarely_offered: 'Rarely offered that semester',
  not_yet_offered: 'Not offered yet',
  duplicate_course: 'Planned twice',
  already_completed: 'Already finished',
  missing_requirement: 'Required course missing',
  elective_hours: 'Elective hours do not add up',
  milestone_not_planned: 'Senior design missing',
  time_conflict: 'Class times overlap',
  no_sections: 'No sections listed',
  unknown_course: 'Unknown course',
};

/**
 * The recommended plan in the checker's plan format, cut to the semesters the plan page shows.
 * `result` is the output of `computeResult` in planModel.js.
 */
export function planForCheck(result) {
  const plan = C.planFromPlanner(result.raw, result.student);
  const shown = new Set(result.terms.map((t) => t.term));
  return { ...plan, terms: plan.terms.filter((t) => shown.has(t.term)) };
}

/** Every planned course with its semester, earliest semester first: `[{ course, term, label }]`. */
export function plannedCourses(plan) {
  return plan.terms.flatMap((t) => t.courses.map((c) => ({ course: c.course, term: t.term, label: T.termLabel(t.term) })));
}

/** Semesters a course can move to: every semester in the plan, plus the fall and spring after the last one. */
export function moveTargets(plan) {
  const ids = plan.terms.map((t) => t.term);
  let last = ids[ids.length - 1];
  for (let i = 0; i < 2 && last; i += 1) {
    last = T.nextTerm(last, { summer: false });
    ids.push(last);
  }
  return ids.map((term) => ({ term, label: T.termLabel(term) }));
}

/** Drop empty semesters at the end of a plan, so a course moved back out of a new semester leaves no blank card. */
function trimEnd(terms) {
  const out = [...terms];
  while (out.length && out[out.length - 1].courses.length === 0) out.pop();
  return out;
}

/** A new plan with `course` moved from the semester it is in to `to`. The semester is added when it is new. */
export function moveCourse(plan, course, to) {
  const from = plan.terms.find((t) => t.courses.some((c) => c.course === course));
  if (!from || from.term === to) return plan;
  const entry = from.courses.find((c) => c.course === course);
  let terms = plan.terms.map((t) => (t === from ? { ...t, courses: t.courses.filter((c) => c !== entry) } : t));
  if (terms.some((t) => t.term === to)) {
    terms = terms.map((t) => (t.term === to ? { ...t, courses: [...t.courses, entry] } : t));
  } else {
    terms = [...terms, { term: to, courses: [entry], other_hours: 0 }].sort((a, b) => T.compareTerms(a.term, b.term));
  }
  return { ...plan, terms: trimEnd(terms) };
}

/** Apply one checker fix and drop any empty semesters it leaves at the end. */
export function applyFix(catalog, plan, fix) {
  const next = C.applyPlanFix(catalog, plan, fix);
  return { ...next, terms: trimEnd(next.terms) };
}

/** The courses whose semester differs between two plans: `[{ course, from, to, fromLabel, toLabel }]`. */
export function planChanges(base, plan) {
  const where = (p) => Object.fromEntries(plannedCourses(p).map((c) => [c.course, c.term]));
  const before = where(base);
  const after = where(plan);
  const out = [];
  for (const course of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[course] ?? null;
    const to = after[course] ?? null;
    if (from === to) continue;
    out.push({
      course, from, to,
      fromLabel: from ? T.termLabel(from) : 'not planned',
      toLabel: to ? T.termLabel(to) : 'removed from the plan',
    });
  }
  return out.sort((a, b) => a.course.localeCompare(b.course));
}

/**
 * Check a plan and return what the page shows:
 * `{ ok, conflicts, terms, lastLabel, seniorDesign }`. Each conflict is
 * `{ id, kind, title, severity, message, course, fixes: [{ text, fix, delays }] }`, errors first.
 */
export function checkChanges(catalog, offerings, plan) {
  const report = C.checkPlan({ catalog, offerings, plan, replan: false });
  const conflicts = report.issues
    .filter((i) => i.severity === 'error' || i.severity === 'warning')
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      title: CONFLICT_TITLES[i.kind] ?? 'Conflict',
      severity: i.severity,
      message: i.message,
      course: i.course ?? null,
      fixes: (i.fixes ?? []).map((f) => ({ text: f.text, fix: f, delays: Boolean(f.delays_graduation), partial: Boolean(f.partial) })),
    }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const flagged = new Set(report.terms.flatMap((t) => t.courses.filter((c) => c.issues.length).map((c) => `${t.term}|${c.course}`)));
  const terms = report.terms.map((t) => ({
    term: t.term, label: t.label, hours: t.hours, status: t.status,
    courses: t.courses.map((c) => ({ course: c.course, hours: c.hours, flagged: flagged.has(`${t.term}|${c.course}`) })),
  }));
  const sd = report.readiness.find((r) => r.id === 'senior-design') ?? null;
  return {
    ok: conflicts.length === 0,
    errors: conflicts.filter((c) => c.severity === 'error').length,
    conflicts,
    terms,
    lastLabel: report.last_term_label,
    seniorDesign: sd ? { status: sd.status, plannedLabel: sd.planned_term ? T.termLabel(sd.planned_term) : null, message: sd.message } : null,
  };
}
