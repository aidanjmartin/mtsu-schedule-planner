// Term-by-term planner.
//
// Each term, take every course that is offered, has its prerequisites met, and meets its standing rule.
// Sort by least slack, then by the longest chain of courses that depend on it, and fill the term up to the
// credit limit. General education hours are reserved in their preferred terms first.
//
// This rule produces a good plan. It does not guarantee the best plan.

import { buildModel, analyze, firstOffered } from './critical-path.js';
import { readyOrdinal, bindingLeaves } from './prereqs.js';
import { termLabel } from './terms.js';

const REASON_TEXT = {
  prerequisite: 'Placed as soon as its prerequisites allow.',
  offering: 'Waited for the next term it is offered.',
  'credit limit': 'Pushed to a later term by the credit limit.',
  standing: 'Waited until enough hours were completed.',
  'in progress': 'Already in progress.',
};

export function reasonText(reason) {
  return REASON_TEXT[reason] ?? reason;
}

/**
 * Build a plan.
 * `student` follows DATA_FORMAT.md: start_term, completed, in_progress, options, and an optional `choices` map.
 */
export function planTerms({ catalog, offerings = null, student, horizon = 24 }) {
  const model = buildModel({ catalog, offerings, student, horizon });
  const analysis = analyze(model);
  return planFromModel(model, analysis);
}

export function planFromModel(model, analysis) {
  const { axis, options, catalog } = model;
  const n = axis.terms.length;
  const capacity = (t) => (axis.seasons[t] === 'summer' ? options.summer_max_credits : options.max_credits);

  const placed = new Map();
  for (const id of model.inProgress) placed.set(id, 0);

  const reserved = new Array(n).fill(0);
  for (const chunk of model.chunks) reserved[chunk.ordinal] += chunk.hours;
  const used = reserved.slice();
  for (const id of model.inProgress) used[0] += model.courses.get(id).credits;

  const termOf = (id) => {
    const c = model.courses.get(id);
    if (!c) return Infinity;
    if (c.status === 'completed') return -Infinity;
    return placed.has(id) ? placed.get(id) : Infinity;
  };

  const hoursBefore = (t) => {
    let hours = model.completedHours;
    for (const [id, p] of placed) if (p < t) hours += model.courses.get(id).credits;
    for (const chunk of model.chunks) if (chunk.ordinal < t) hours += chunk.hours;
    return hours;
  };

  const slackOf = (id) => analysis.courses[id].slack ?? Infinity;
  const priority = (a, b) =>
    slackOf(a) - slackOf(b)
    || analysis.courses[b].chain - analysis.courses[a].chain
    || (model.courses.get(a).suggestedPos ?? 99) - (model.courses.get(b).suggestedPos ?? 99)
    || a.localeCompare(b);

  const waiting = new Set(model.todo);
  for (let t = 0; t < n && waiting.size > 0; t += 1) {
    const cap = capacity(t);
    let progress = true;
    while (progress) {
      progress = false;
      const order = [...waiting].sort(priority);
      for (const id of order) {
        const course = model.courses.get(id);
        if (!course.seasons.has(axis.seasons[t])) continue;
        if (readyOrdinal(course.prereqs, termOf) > t) continue;
        if (course.standing && hoursBefore(t) < (catalog.standing_hours?.[course.standing] ?? 0)) continue;
        if (used[t] + course.credits > cap) continue;
        placed.set(id, t);
        used[t] += course.credits;
        waiting.delete(id);
        progress = true;
        break;
      }
    }
  }

  // Why each course landed where it did.
  const standingReady = (course) => {
    if (!course.standing) return 0;
    const need = catalog.standing_hours?.[course.standing] ?? 0;
    for (let t = 0; t < n; t += 1) if (hoursBefore(t) >= need) return t;
    return Infinity;
  };
  const explain = (id) => {
    const course = model.courses.get(id);
    const p = placed.get(id);
    if (course.status === 'in_progress') return 'in progress';
    const byPrereq = Math.max(readyOrdinal(course.prereqs, termOf), 0);
    const byStanding = standingReady(course);
    const ready = Math.max(byPrereq, byStanding);
    const offered = firstOffered(model, id, ready);
    if (p > offered) return 'credit limit';
    if (offered > ready) return 'offering';
    return byStanding > byPrereq ? 'standing' : 'prerequisite';
  };
  const chainFor = (id) => {
    const steps = [];
    const seen = new Set();
    let current = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const reason = explain(current);
      steps.push({ course: current, term: axis.terms[placed.get(current)], reason });
      if (reason === 'credit limit' || reason === 'standing' || reason === 'in progress') break;
      const leaves = bindingLeaves(model.courses.get(current).prereqs, termOf)
        .filter((l) => placed.has(l.course) && model.courses.get(l.course).status === 'todo');
      leaves.sort((a, b) => placed.get(b.course) - placed.get(a.course));
      current = leaves.length ? leaves[0].course : null;
    }
    return steps.reverse();
  };

  const unplaced = [...waiting].map((id) => {
    const blocked = analysis.blocked.find((b) => b.course === id);
    return {
      course: id,
      reason: blocked ? blocked.reason : `Could not fit inside the next ${n} terms with the current credit limits.`,
    };
  });

  const placedOrdinals = [...placed.values()];
  const lastCourse = placedOrdinals.length ? Math.max(...placedOrdinals) : -1;
  const lastChunk = model.chunks.length ? Math.max(...model.chunks.map((c) => c.ordinal)) : -1;
  const gradOrdinal = unplaced.length ? null : Math.max(lastCourse, lastChunk, 0);
  const lastShown = gradOrdinal === null ? n - 1 : gradOrdinal;

  const terms = [];
  for (let t = 0; t <= lastShown; t += 1) {
    const list = [...placed.entries()]
      .filter(([, p]) => p === t)
      .map(([id]) => id)
      .sort(priority);
    terms.push({
      term: axis.terms[t],
      label: termLabel(axis.terms[t]),
      season: axis.seasons[t],
      capacity: capacity(t),
      credits: used[t],
      courses: list.map((id) => ({
        course: id,
        title: model.courses.get(id).title,
        credits: model.courses.get(id).credits,
        slack: analysis.courses[id].slack,
        critical: analysis.courses[id].critical,
        added: model.courses.get(id).added,
        reason: explain(id),
      })),
      placeholders: model.chunks.filter((c) => c.ordinal === t).map((c) => ({ id: c.id, label: c.label, hours: c.hours })),
    });
  }

  const placements = {};
  for (const [id, p] of placed) placements[id] = axis.terms[p];

  const milestones = [];
  const milestoneDrivers = {};
  for (const m of catalog.milestones ?? []) {
    const open = (m.courses ?? []).filter((id) => placed.has(id));
    const done = (m.courses ?? []).every((id) => model.courses.get(id)?.status === 'completed');
    if (open.length === 0) {
      milestones.push({ id: m.id, label: m.label, courses: m.courses, start_term: null, end_term: null, status: done ? 'done' : 'not planned' });
      continue;
    }
    const sorted = [...open].sort((a, b) => placed.get(a) - placed.get(b));
    milestones.push({
      id: m.id, label: m.label, courses: m.courses,
      start_term: axis.terms[placed.get(sorted[0])],
      end_term: axis.terms[placed.get(sorted[sorted.length - 1])],
      status: 'planned',
    });
    milestoneDrivers[m.id] = chainFor(sorted[0]);
  }

  let graduationDriver = { set_by: 'courses', chain: [] };
  if (gradOrdinal !== null) {
    const atEnd = [...placed.entries()].filter(([, p]) => p === lastCourse).map(([id]) => id);
    if (lastChunk > lastCourse) {
      graduationDriver = { set_by: 'general education hours', chain: [] };
    } else if (atEnd.length) {
      atEnd.sort((a, b) => analysis.courses[b].chain - analysis.courses[a].chain || a.localeCompare(b));
      graduationDriver = { set_by: 'courses', chain: chainFor(atEnd[0]) };
    }
  }

  const remainingHours =
    model.todo.reduce((sum, id) => sum + model.courses.get(id).credits, 0) +
    model.placeholders.filter((p) => !p.done).reduce((sum, p) => sum + p.hours, 0);

  const warnings = [...model.warnings];
  for (const u of unplaced) warnings.push(`${u.course} is not in the plan. ${u.reason}`);

  return {
    start_term: model.student.start_term,
    summer_allowed: options.summer_allowed,
    terms,
    placements,
    graduation_term: gradOrdinal === null ? null : axis.terms[gradOrdinal],
    graduation_label: gradOrdinal === null ? null : termLabel(axis.terms[gradOrdinal]),
    last_course_term: lastCourse >= 0 ? axis.terms[lastCourse] : null,
    milestones,
    drivers: { graduation: graduationDriver, milestones: milestoneDrivers },
    unplaced,
    remaining_hours: remainingHours,
    choices: model.choose,
    added_prereqs: model.added,
    warnings,
    assumptions: [...model.assumptions],
    analysis,
  };
}
