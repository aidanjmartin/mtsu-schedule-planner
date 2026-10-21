// What-if changes. A list of edits applies on top of the catalog and schedule data, in order.
// Nothing here changes its inputs: every function returns new objects.

import { planTerms } from './planner.js';
import { planTimetables, movableFromAnalysis } from './timetable.js';
import { validateCatalog } from './validate.js';
import { normalizePrereqs, prereqCourses } from './prereqs.js';
import { termDistance, termLabel } from './terms.js';

export const EDIT_TYPES = ['set_prereqs', 'set_seasons', 'set_credits', 'move_requirement', 'set_meeting_pattern'];

const clone = (value) => JSON.parse(JSON.stringify(value));
const SEASONS = ['fall', 'spring', 'summer'];

/** Plain-language description of one edit. */
export function describeEdit(edit) {
  switch (edit.type) {
    case 'set_prereqs':
      return `Change the prerequisites of ${edit.course}`;
    case 'set_seasons':
      return `Offer ${edit.course} in ${edit.regular_seasons?.length ? edit.regular_seasons.join(' and ') : 'no season'} only`;
    case 'set_credits':
      return `Set ${edit.course} to ${edit.credits} credit hours`;
    case 'move_requirement':
      return `Move ${edit.course} to the requirement "${edit.to}"`;
    case 'set_meeting_pattern':
      return `Replace the meeting pattern of ${edit.course} in ${edit.term}`;
    default:
      return `Unknown edit "${edit.type}"`;
  }
}

/**
 * Apply edits to copies of the catalog and schedules.
 * `schedules` maps a term id to a schedule object. Returns
 * { catalog, schedules, errors, applied, new_problems }.
 * An edit that cannot apply is skipped and listed in `errors` with its position in the list.
 */
export function applyEdits({ catalog, schedules = {}, edits = [] }) {
  const out = clone(catalog);
  const outSchedules = clone(schedules);
  const errors = [];
  const applied = [];

  edits.forEach((edit, position) => {
    const fail = (message) => errors.push({ position, edit, message });
    const def = out.courses[edit.course];
    if (!EDIT_TYPES.includes(edit.type)) return fail(`Unknown edit type "${edit.type}".`);
    if (!def) return fail(`${edit.course} is not in the catalog.`);

    if (edit.type === 'set_prereqs') {
      try {
        normalizePrereqs(edit.prereqs);
      } catch (e) {
        return fail(e.message);
      }
      const unknown = prereqCourses(normalizePrereqs(edit.prereqs ?? null)).filter((c) => !out.courses[c]);
      if (unknown.length) return fail(`These courses are not in the catalog: ${unknown.join(', ')}.`);
      def.prereqs = edit.prereqs ?? null;
    } else if (edit.type === 'set_seasons') {
      const seasons = (edit.regular_seasons ?? []).filter((s) => SEASONS.includes(s));
      def.season_override = [...new Set(seasons)];
    } else if (edit.type === 'set_credits') {
      if (!(typeof edit.credits === 'number' && edit.credits > 0)) return fail('Credits must be a positive number.');
      def.credits = edit.credits;
    } else if (edit.type === 'move_requirement') {
      const target = out.requirements.find((r) => r.id === edit.to);
      if (!target) return fail(`There is no requirement "${edit.to}".`);
      if (target.type === 'placeholder') return fail('A course cannot move into a placeholder requirement.');
      for (const req of out.requirements) {
        if (req.type === 'all') req.courses = req.courses.filter((c) => c !== edit.course);
        if (req.type === 'choose' || req.type === 'choose_hours') req.options = req.options.filter((c) => c !== edit.course);
      }
      const list = target.type === 'all' ? target.courses : target.options;
      list.push(edit.course);
    } else if (edit.type === 'set_meeting_pattern') {
      if (!/^\d{4}(FA|SP|SU)$/.test(edit.term ?? '')) return fail('The edit needs a term such as 2027SP.');
      if (!Array.isArray(edit.meetings)) return fail('The edit needs a list of meetings.');
      let schedule = outSchedules[edit.term];
      if (!schedule) {
        schedule = { term: edit.term, term_label: termLabel(edit.term), synthetic: true, sections: [] };
        outSchedules[edit.term] = schedule;
      }
      const matches = schedule.sections.filter((s) => s.course === edit.course && (!edit.section || s.section === edit.section));
      const fresh = (existing) => edit.meetings.map((m) => ({
        days: m.days,
        start: m.start,
        end: m.end,
        location: m.location ?? existing?.location ?? '',
        start_date: m.start_date ?? existing?.start_date ?? null,
        end_date: m.end_date ?? existing?.end_date ?? null,
      }));
      if (matches.length === 0) {
        schedule.sections.push({
          crn: 'EDIT', course: edit.course, section: 'EDIT', title: def.title, credits: def.credits,
          schedule_type: 'Lecture', instructional_method: 'Face-to-face', part_of_term: '1', instructor: '',
          meetings: fresh(null), synthetic: true,
        });
      } else {
        for (const s of matches) s.meetings = fresh(s.meetings?.[0]);
      }
    }
    applied.push(edit);
  });

  const before = new Set(validateCatalog(catalog).errors.map((e) => e.message));
  const newProblems = validateCatalog(out).errors.filter((e) => !before.has(e.message));
  return { catalog: out, schedules: outSchedules, errors, applied, new_problems: newProblems };
}

// ---------------------------------------------------------------- comparisons

function distance(a, b, summer) {
  if (!a || !b) return null;
  return termDistance(a, b, { summer });
}

/** Compare the critical path and slack of two analyses. */
export function diffAnalyses(base, alt) {
  const baseCritical = new Set(base.critical);
  const altCritical = new Set(alt.critical);
  const slackChanges = [];
  for (const id of Object.keys(alt.courses)) {
    const a = base.courses[id]?.slack ?? null;
    const b = alt.courses[id]?.slack ?? null;
    if (a !== b) slackChanges.push({ course: id, from: a, to: b });
  }
  return {
    added: alt.critical.filter((c) => !baseCritical.has(c)),
    removed: base.critical.filter((c) => !altCritical.has(c)),
    unchanged: alt.critical.filter((c) => baseCritical.has(c)),
    slack_changes: slackChanges,
  };
}

/**
 * Compare two plans. `base` is the reference and `alt` is the changed plan.
 * `responsible` lists the courses on the later plan's driving chain that sit in a different term
 * (or appear in only one plan), which explains a difference in start or graduation dates.
 */
export function diffPlans(base, alt) {
  const summer = base.summer_allowed || alt.summer_allowed;
  const moved = [];
  const ids = new Set([...Object.keys(base.placements), ...Object.keys(alt.placements)]);
  for (const course of [...ids].sort()) {
    const from = base.placements[course] ?? null;
    const to = alt.placements[course] ?? null;
    if (from !== to) moved.push({ course, from, to, delta_terms: distance(from, to, summer) });
  }

  const milestones = base.milestones.map((m) => {
    const other = alt.milestones.find((x) => x.id === m.id);
    return {
      id: m.id, label: m.label,
      base_start: m.start_term, alt_start: other?.start_term ?? null,
      delta_terms: distance(m.start_term, other?.start_term ?? null, summer),
    };
  });

  const graduation = {
    base: base.graduation_term,
    alt: alt.graduation_term,
    delta_terms: distance(base.graduation_term, alt.graduation_term, summer),
  };

  const responsibleFor = (baseChain, altChain, laterIsAlt) => {
    const chain = laterIsAlt ? altChain : baseChain;
    const otherPlacements = laterIsAlt ? base.placements : alt.placements;
    return (chain ?? [])
      .filter((step) => otherPlacements[step.course] !== step.term)
      .map((step) => ({
        course: step.course,
        term: step.term,
        other_term: otherPlacements[step.course] ?? null,
        reason: step.reason,
        in_plan: laterIsAlt ? 'changed plan' : 'reference plan',
      }));
  };
  const responsible = {};
  for (const m of milestones) {
    if (m.delta_terms === null || m.delta_terms === 0) continue;
    responsible[m.id] = responsibleFor(base.drivers.milestones[m.id], alt.drivers.milestones[m.id], m.delta_terms > 0);
  }
  if (graduation.delta_terms) {
    responsible.graduation = responsibleFor(base.drivers.graduation.chain, alt.drivers.graduation.chain, graduation.delta_terms > 0);
  }

  return {
    graduation,
    milestones,
    moved,
    responsible,
    critical: diffAnalyses(base.analysis, alt.analysis),
    changed: graduation.delta_terms !== 0 || moved.length > 0,
  };
}

/** Sentences that describe a plan difference, ready to show on a page. */
export function summarizeDiff(diff, { baseName = 'the baseline', altName = 'the changed plan' } = {}) {
  const lines = [];
  const plural = (n) => `${Math.abs(n)} term${Math.abs(n) === 1 ? '' : 's'}`;
  const g = diff.graduation;
  if (g.base === null || g.alt === null) {
    if (g.base !== g.alt) lines.push(g.alt === null ? `${altName} cannot finish inside the planning window.` : `${baseName} cannot finish inside the planning window, but ${altName} can.`);
  } else if (g.delta_terms === 0) {
    lines.push(`Graduation stays at ${termLabel(g.alt)}.`);
  } else {
    lines.push(`Graduation moves from ${termLabel(g.base)} to ${termLabel(g.alt)}, ${plural(g.delta_terms)} ${g.delta_terms > 0 ? 'later' : 'earlier'}.`);
  }
  for (const m of diff.milestones) {
    if (m.base_start === null && m.alt_start === null) continue;
    if (m.base_start === m.alt_start) lines.push(`${m.label} still starts in ${termLabel(m.alt_start)}.`);
    else if (m.base_start && m.alt_start) lines.push(`${m.label} starts in ${termLabel(m.alt_start)} instead of ${termLabel(m.base_start)}, ${plural(m.delta_terms)} ${m.delta_terms > 0 ? 'later' : 'earlier'}.`);
  }
  if (diff.critical.added.length) lines.push(`Joins the critical path: ${diff.critical.added.join(', ')}.`);
  if (diff.critical.removed.length) lines.push(`Leaves the critical path: ${diff.critical.removed.join(', ')}.`);
  return lines;
}

/**
 * Run the student's plan once with no edits and once with the edits, and compare them.
 * Returns { baseline, scenario, diff, edit_errors, new_problems }.
 */
export function compareScenario({ catalog, offerings = null, schedules = {}, student, edits = [] }) {
  const base = planTerms({ catalog, offerings, student });
  const applied = applyEdits({ catalog, schedules, edits });
  const scenario = edits.length === 0
    ? base
    : planTerms({ catalog: applied.catalog, offerings, student });
  return {
    baseline: { plan: base, catalog, schedules },
    scenario: { plan: scenario, catalog: applied.catalog, schedules: applied.schedules },
    diff: diffPlans(base, scenario),
    edit_errors: applied.errors,
    new_problems: applied.new_problems,
  };
}

/**
 * Timetable options for one planned term.
 * Uses the courses the plan puts in `term` and the schedule for that term.
 */
export function termTimetable({ plan, catalog, schedule, term, limit = 10 }) {
  const planned = plan.terms.find((t) => t.term === term);
  const courses = planned ? planned.courses.map((c) => c.course) : [];
  const result = planTimetables({
    courses, catalog, schedule, limit,
    movable: movableFromAnalysis(plan.analysis, term),
  });
  return { term, courses, ...result };
}

/** Compare timetable results for the same term before and after a change. */
export function diffTimetables(base, alt) {
  const best = (r) => (r.options[0] ? { campus_days: r.options[0].campus_days, early_classes: r.options[0].early_classes } : null);
  return {
    total: { base: base.total, alt: alt.total },
    best: { base: best(base), alt: best(alt) },
    conflict: { base: base.conflicts.length > 0, alt: alt.conflicts.length > 0 },
    base_conflicts: base.conflicts.map((c) => c.courses),
    alt_conflicts: alt.conflicts.map((c) => c.courses),
  };
}
