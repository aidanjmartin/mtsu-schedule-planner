// Plan checker. It reads a term-by-term plan that a student or an instructor wrote (or that the planner made) and
// reports what is wrong with it, in plain language, with fixes that the checker has tried and confirmed.
//
// It checks:
//   - missing prerequisites and corequisites (a corequisite may share the term; a prerequisite must come earlier)
//   - class standing (junior or senior standing measured in finished credit hours)
//   - overloaded terms (more hours than the credit limit) and, when asked, light terms
//   - courses planned in a season they do not run, or before the term they are first offered
//   - courses repeated or already finished, required courses missing, and elective hours that do not add up
//   - time conflicts, for terms that have a class schedule
//   - senior design readiness: when the plan lets senior design start, and which courses have no room to slip
//
// A fix is offered only after the checker applies it to a copy of the plan and confirms that it clears the problem
// without creating a new one.

import {
  buildTermAxis, termLabel, termIndex, seasonOf, isTerm, compareTerms,
} from './terms.js';
import {
  normalizePrereqs, readyOrdinal, effectiveSeasons, creditRange, minCredits, isRepeatable, checkHourPicks,
  describePrereqs,
} from './prereqs.js';
import { planTimetables } from './timetable.js';
import { planTerms } from './planner.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const DEFAULT_CHECK_OPTIONS = {
  max_credits: 18,
  summer_max_credits: 8,
  min_credits: null,
  summer_allowed: false,
  include_occasional: false,
  max_fixes: 3,
};

const list = (items, joiner = 'and') => {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${joiner} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${joiner} ${items[items.length - 1]}`;
};
const hoursWord = (n) => `${n} credit ${n === 1 ? 'hour' : 'hours'}`;
const termsWord = (n) => `${n} ${n === 1 ? 'term' : 'terms'}`;

// --------------------------------------------------------------------- input

/**
 * Read a plan into one shape. A plan is
 *   { completed, in_progress, completed_hours, terms: [{ term, courses, other_hours }], options }
 * where each entry of `courses` is a course id or { course, hours } (or { course, credits }, as the planner writes).
 * `other_hours` counts hours that are not catalog courses, such as general education. A planner term's
 * `placeholders` list counts the same way. `in_progress` courses finish before the first planned term.
 */
export function normalizePlan(catalog, plan = {}) {
  const terms = [];
  for (const t of plan.terms ?? []) {
    if (!isTerm(t.term)) continue;
    const entries = [];
    for (const raw of t.courses ?? []) {
      const course = typeof raw === 'string' ? raw : raw?.course;
      if (typeof course !== 'string') continue;
      const def = catalog.courses[course];
      let hours = typeof raw === 'object' ? raw.hours ?? raw.credits : undefined;
      if (Array.isArray(hours)) hours = hours[0];
      if (!Number.isFinite(hours)) hours = def ? minCredits(def) : 0;
      if (def) {
        const { min, max } = creditRange(def);
        hours = Math.min(max, Math.max(min, hours));
      }
      entries.push({ course, hours });
    }
    const placeholderHours = (t.placeholders ?? []).reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
    terms.push({ term: t.term, entries, other_hours: (Number(t.other_hours) || 0) + placeholderHours });
  }
  terms.sort((a, b) => compareTerms(a.term, b.term));
  // Merge two entries for the same term.
  const merged = [];
  for (const t of terms) {
    const last = merged[merged.length - 1];
    if (last && last.term === t.term) { last.entries.push(...t.entries); last.other_hours += t.other_hours; } else merged.push(t);
  }
  return {
    completed: [...new Set(plan.completed ?? [])],
    in_progress: [...new Set(plan.in_progress ?? [])].filter((c) => !(plan.completed ?? []).includes(c)),
    completed_hours: Number.isFinite(plan.completed_hours) ? plan.completed_hours : null,
    terms: merged,
    options: { ...DEFAULT_CHECK_OPTIONS, ...(plan.options ?? {}) },
  };
}

/** Turn a normalized plan back into the input shape (used for fixes and by the what-if module). */
export function denormalizePlan(norm) {
  return {
    completed: [...norm.completed],
    in_progress: [...norm.in_progress],
    ...(norm.completed_hours === null ? {} : { completed_hours: norm.completed_hours }),
    terms: norm.terms.map((t) => ({
      term: t.term,
      courses: t.entries.map((e) => ({ course: e.course, hours: e.hours })),
      ...(t.other_hours ? { other_hours: t.other_hours } : {}),
    })),
    options: { ...norm.options },
  };
}

/** Convert a plan made by planTerms into checker input. */
export function planFromPlanner(plannerPlan, student = {}) {
  return {
    completed: [...(student.completed ?? [])],
    in_progress: [...(student.in_progress ?? [])],
    terms: plannerPlan.terms.map((t) => ({
      term: t.term,
      courses: t.courses
        .filter((c) => !(student.in_progress ?? []).includes(c.course) || t.term !== plannerPlan.terms[0].term)
        .map((c) => ({ course: c.course, hours: c.credits })),
      other_hours: (t.placeholders ?? []).reduce((sum, p) => sum + p.hours, 0),
    })),
    options: {
      max_credits: student.options?.max_credits ?? DEFAULT_CHECK_OPTIONS.max_credits,
      summer_allowed: plannerPlan.summer_allowed ?? false,
    },
  };
}

// ------------------------------------------------------------------- context

function buildContext(catalog, offerings, norm) {
  const opts = norm.options;
  const first = norm.terms[0]?.term ?? null;
  const usesSummer = norm.terms.some((t) => seasonOf(t.term) === 'summer');
  const summerAllowed = opts.summer_allowed || usesSummer;
  let axis = null;
  if (first) {
    const last = norm.terms[norm.terms.length - 1].term;
    let count = 1;
    while (true) {
      axis = buildTermAxis(first, { summerAllowed, count });
      if (compareTerms(axis.terms[axis.terms.length - 1], last) >= 0) break;
      count += 1;
    }
    axis = buildTermAxis(first, { summerAllowed, count: count + 6 });
  }
  const seasonsOf = new Map();
  const seasonInfo = (id) => {
    if (!seasonsOf.has(id)) {
      seasonsOf.set(id, catalog.courses[id] ? effectiveSeasons(catalog, id, offerings, { includeOccasional: false }) : null);
    }
    return seasonsOf.get(id);
  };
  return { catalog, offerings, norm, opts, axis, seasonInfo };
}

const capacityOf = (opts, term) => (seasonOf(term) === 'summer' ? opts.summer_max_credits : opts.max_credits);

function runsIn(ctx, id, term, { occasional = ctx.opts.include_occasional } = {}) {
  const info = ctx.seasonInfo(id);
  if (!info) return true;
  const season = seasonOf(term);
  if (info.seasons.has(season)) return true;
  return occasional && info.occasional.includes(season);
}

function availableIn(ctx, id, term) {
  const from = ctx.catalog.courses[id]?.available_from;
  return !from || termIndex(term) >= termIndex(from);
}

/** Where each course sits: completed, in progress, or the first planned term ordinal. */
function placementsOf(ctx, norm) {
  const done = new Set(norm.completed);
  const doing = new Set(norm.in_progress);
  const at = new Map();
  norm.terms.forEach((t) => {
    const n = ctx.axis.index.get(t.term) ?? ctx.axis.terms.findIndex((x) => x === t.term);
    for (const e of t.entries) if (!at.has(e.course)) at.set(e.course, n);
  });
  const termOf = (id) => {
    if (done.has(id)) return -Infinity;
    if (doing.has(id)) return -1;
    return at.has(id) ? at.get(id) : Infinity;
  };
  return { done, doing, at, termOf };
}

/** The leaves of an expression that are not met when the course sits at ordinal `t`. */
function unmetLeaves(expr, termOf, t) {
  const out = [];
  const met = (node) => readyOrdinal(node, termOf) <= t;
  const walk = (node) => {
    if (!node || met(node)) return;
    if (node.type === 'course') { out.push(node); return; }
    if (node.type === 'all') { node.items.forEach(walk); return; }
    node.items.forEach(walk);
  };
  walk(normalizePrereqs(expr));
  return out;
}

function hoursFinishedBefore(ctx, norm, ordinal) {
  let hours = norm.completed_hours;
  if (hours === null) {
    hours = 0;
    for (const id of norm.completed) {
      const def = ctx.catalog.courses[id];
      if (def) hours += minCredits(def);
      else {
        const ph = (ctx.catalog.requirements ?? []).find((r) => r.type === 'placeholder' && r.id === id);
        if (ph) hours += ph.hours;
      }
    }
  }
  for (const id of norm.in_progress) if (ctx.catalog.courses[id]) hours += minCredits(ctx.catalog.courses[id]);
  for (const t of norm.terms) {
    if ((ctx.axis.index.get(t.term) ?? Infinity) >= ordinal) continue;
    hours += t.other_hours + t.entries.reduce((sum, e) => sum + e.hours, 0);
  }
  return hours;
}

function issueKey(issue) {
  return `${issue.kind}|${issue.course ?? ''}|${issue.term ?? ''}`;
}

function makeIssue(kind, severity, fields) {
  const issue = { kind, severity, course: null, term: null, courses: [], ...fields, fixes: [] };
  issue.id = issueKey(issue);
  if (issue.term && !issue.term_label) issue.term_label = termLabel(issue.term);
  return issue;
}

// -------------------------------------------------------------- the checks

function where(ctx, place, id) {
  if (place.done.has(id)) return 'finished';
  if (place.doing.has(id)) return 'in progress now';
  const t = place.at.get(id);
  return t === undefined ? 'not in the plan' : `planned for ${termLabel(ctx.axis.terms[t])}`;
}

/** Every problem in a plan, without fixes. `timetables: false` skips the time conflict search. */
function findIssues(ctx, norm, { timetables = true, schedules = {} } = {}) {
  const { catalog, opts } = ctx;
  const issues = [];
  if (!ctx.axis) return issues;
  const place = placementsOf(ctx, norm);
  const seen = new Map();

  for (const t of norm.terms) {
    const ordinal = ctx.axis.index.get(t.term);
    const label = termLabel(t.term);
    for (const e of t.entries) {
      const id = e.course;
      const def = catalog.courses[id];
      if (!def) {
        issues.push(makeIssue('unknown_course', 'warning', {
          course: id, term: t.term,
          message: `${id} in ${label} is not in the ${catalog.catalog_year} catalog, so the checker cannot check it.`,
        }));
        continue;
      }
      if (place.done.has(id) && !isRepeatable(def)) {
        issues.push(makeIssue('already_completed', 'warning', {
          course: id, term: t.term,
          message: `${id} is planned for ${label}, but it is already finished.`,
        }));
        continue;
      }
      if (seen.has(id) && !isRepeatable(def)) {
        issues.push(makeIssue('duplicate_course', 'error', {
          course: id, term: t.term,
          message: `${id} appears twice: in ${termLabel(seen.get(id))} and again in ${label}. It counts only once.`,
        }));
        continue;
      }
      if (!seen.has(id)) seen.set(id, t.term);

      // A repeat semester of a repeatable course only needs the course's own prerequisites once.
      const firstTime = place.at.get(id) === ordinal;
      if (firstTime) {
        const unmet = unmetLeaves(def.prereqs, place.termOf, ordinal);
        if (unmet.length) {
          const parts = unmet.map((leaf) => {
            const w = where(ctx, place, leaf.course);
            const rule = leaf.concurrent_ok ? 'in the same term or earlier' : 'in an earlier term';
            return `${leaf.course} (${rule}; it is ${w})`;
          });
          const anyGroup = normalizePrereqs(def.prereqs)?.type === 'any';
          issues.push(makeIssue('missing_prerequisite', 'error', {
            course: id, term: t.term, courses: unmet.map((l) => l.course),
            message: `${id} is planned for ${label}, but it needs ${anyGroup ? 'one of ' : ''}${list(parts, anyGroup ? 'or' : 'and')}.`,
            detail: `The catalog requires: ${describePrereqs(def.prereqs)}.`,
          }));
        }
        if (def.standing) {
          const need = catalog.standing_hours?.[def.standing] ?? 0;
          const have = hoursFinishedBefore(ctx, norm, ordinal);
          if (have < need) {
            issues.push(makeIssue('class_standing', 'error', {
              course: id, term: t.term,
              message: `${id} needs ${def.standing} standing (${hoursWord(need)} finished), but the plan has only ${hoursWord(have)} finished before ${label}.`,
            }));
          }
        }
      }
      if (!availableIn(ctx, id, t.term)) {
        issues.push(makeIssue('not_yet_offered', 'error', {
          course: id, term: t.term,
          message: `${id} is planned for ${label}, but it is first offered in ${termLabel(def.available_from)}.`,
        }));
      } else if (!runsIn(ctx, id, t.term)) {
        const info = ctx.seasonInfo(id);
        const season = seasonOf(t.term);
        const runs = [...info.seasons];
        const rare = info.occasional.includes(season);
        const when = runs.length ? `${runs.join(' and ')} only` : 'no regular season';
        issues.push(makeIssue(rare ? 'rarely_offered' : 'not_offered', rare ? 'warning' : 'error', {
          course: id, term: t.term,
          message: rare
            ? `${id} is planned for ${label}, but it has run in ${season} only now and then. It regularly runs in ${when}.`
            : `${id} is planned for ${label}, but it runs in ${when}.`,
          detail: info.source === 'data' ? 'Offering seasons come from MTSU class schedules since Fall 2018.'
            : info.source === 'edit' ? 'Offering seasons come from the department\'s planned schedule.'
              : 'There is no offering history for this course, so the academic map season stands in.',
        }));
      }
    }

    const hours = t.entries.reduce((sum, e) => sum + e.hours, 0) + t.other_hours;
    const cap = capacityOf(opts, t.term);
    if (hours > cap) {
      issues.push(makeIssue('overloaded_term', 'error', {
        term: t.term, courses: t.entries.map((e) => e.course), amount: hours - cap,
        message: `${label} has ${hoursWord(hours)}, more than the ${cap}-hour limit.`,
        detail: `Courses: ${t.entries.map((e) => `${e.course} (${e.hours})`).join(', ')}${t.other_hours ? `, plus ${t.other_hours} other hours` : ''}.`,
      }));
    } else if (Number.isFinite(opts.min_credits) && hours > 0 && hours < opts.min_credits && seasonOf(t.term) !== 'summer') {
      issues.push(makeIssue('light_term', 'warning', {
        term: t.term,
        message: `${label} has ${hoursWord(hours)}, fewer than the ${opts.min_credits} hours asked for.`,
      }));
    }

    if (timetables && schedules[t.term] && ordinal !== undefined) {
      const courses = t.entries.map((e) => e.course).filter((c) => catalog.courses[c]);
      const result = planTimetables({ courses, catalog, schedule: schedules[t.term], limit: 1, maxNodes: 200000 });
      if (result.available && result.options.length === 0 && result.conflicts.length) {
        const c = result.conflicts[0];
        issues.push(makeIssue('time_conflict', 'error', {
          term: t.term, courses: c.courses, course: c.courses[0],
          message: `In ${label}, no set of sections fits together. ${c.reason}`,
          detail: c.examples?.[0] ? `For example, ${c.examples[0].a.course} section ${c.examples[0].a.section} and ${c.examples[0].b.course} section ${c.examples[0].b.section} meet at the same time.` : undefined,
        }));
      }
      for (const miss of result.no_sections ?? []) {
        issues.push(makeIssue('no_sections', 'warning', {
          course: miss.course, term: t.term,
          message: `${miss.course} has no sections in the ${label} class schedule.`,
        }));
      }
    }
  }

  // Requirements: every required course somewhere, and electives that add up.
  const present = (id) => place.done.has(id) || place.doing.has(id) || place.at.has(id);
  for (const req of catalog.requirements ?? []) {
    if (req.type === 'all') {
      for (const id of req.courses ?? []) {
        if (!present(id) && catalog.courses[id]) {
          issues.push(makeIssue('missing_requirement', 'error', {
            course: id,
            message: `${id} (${catalog.courses[id].title}) is required for the degree, but it is not finished or planned.`,
          }));
        }
      }
    } else if (req.type === 'choose_hours') {
      const picks = electivePicksInPlan(catalog, norm, req);
      const check = checkHourPicks(catalog, req, picks);
      const over = check.limits.find((l) => l.over);
      if (check.status !== 'exact' || over) {
        const name = req.label ?? req.id;
        let message;
        if (over) message = `${list(over.courses)} can count for at most ${hoursWord(over.max_hours)}, but the plan has ${over.used}.`;
        else if (check.status === 'under') message = `${name}: the plan has ${hoursWord(check.total)} of the ${req.hours} required.`;
        else message = `${name}: the plan has ${hoursWord(check.total)}, ${hoursWord(check.total - req.hours)} more than the ${req.hours} required.`;
        issues.push(makeIssue('elective_hours', check.status === 'over' && !over ? 'warning' : 'error', {
          course: null, requirement: req.id, courses: check.picks.map((p) => p.course),
          message,
          detail: check.picks.length ? `Electives found: ${check.picks.map((p) => `${p.course} (${p.hours.reduce((a, b) => a + b, 0)})`).join(', ')}.` : 'No electives found.',
          hours_short: Math.max(0, req.hours - check.total),
          amount: over ? over.used - over.max_hours : Math.abs(check.total - req.hours),
        }));
      }
    } else if (req.type === 'choose') {
      const have = (req.options ?? []).filter(present);
      if (have.length < req.count) {
        issues.push(makeIssue('elective_hours', 'error', {
          requirement: req.id, courses: have,
          message: `${req.label ?? req.id}: the plan has ${have.length} of the ${req.count} courses required.`,
        }));
      }
    }
  }

  // Senior design (and any other milestone) must be in the plan.
  for (const m of catalog.milestones ?? []) {
    const missing = (m.courses ?? []).filter((id) => catalog.courses[id] && !present(id));
    if (missing.length && missing.length === (m.courses ?? []).length) {
      issues.push(makeIssue('milestone_not_planned', 'error', {
        course: m.courses[0], courses: missing,
        message: `${m.label} (${list(m.courses)}) is not in the plan.`,
      }));
    }
  }

  // A required course reported as missing is also reported as a missing prerequisite. Keep both; they have different fixes.
  return issues;
}

/** The elective picks a plan holds for a choose_hours requirement, in the engine's pick format. */
export function electivePicksInPlan(catalog, norm, req) {
  const options = new Set(req.options ?? []);
  const byCourse = new Map();
  for (const id of [...norm.completed, ...norm.in_progress]) {
    if (options.has(id) && catalog.courses[id]) byCourse.set(id, [minCredits(catalog.courses[id])]);
  }
  for (const t of norm.terms) {
    for (const e of t.entries) {
      if (!options.has(e.course) || !catalog.courses[e.course]) continue;
      const def = catalog.courses[e.course];
      if (byCourse.has(e.course) && !isRepeatable(def)) continue;
      byCourse.set(e.course, [...(byCourse.get(e.course) ?? []), e.hours]);
    }
  }
  return [...byCourse].map(([course, hours]) => ({ course, hours }));
}

// ------------------------------------------------------------------ fixes

function cloneNorm(norm) {
  return {
    ...norm,
    completed: [...norm.completed],
    in_progress: [...norm.in_progress],
    terms: norm.terms.map((t) => ({ ...t, entries: t.entries.map((e) => ({ ...e })) })),
    options: { ...norm.options },
  };
}

function applyFix(norm, fix) {
  const out = cloneNorm(norm);
  const termEntry = (term) => {
    let t = out.terms.find((x) => x.term === term);
    if (!t) {
      t = { term, entries: [], other_hours: 0 };
      out.terms.push(t);
      out.terms.sort((a, b) => compareTerms(a.term, b.term));
    }
    return t;
  };
  if (fix.type === 'move' || fix.type === 'remove') {
    const from = out.terms.find((x) => x.term === fix.from);
    const i = from ? from.entries.findIndex((e) => e.course === fix.course) : -1;
    if (i === -1) return out;
    const [entry] = from.entries.splice(i, 1);
    if (fix.type === 'move') termEntry(fix.to).entries.push(entry);
  } else if (fix.type === 'add') {
    termEntry(fix.to).entries.push({ course: fix.course, hours: fix.hours });
  }
  out.terms = out.terms.filter((t) => t.entries.length || t.other_hours);
  return out;
}

function fixText(fix) {
  if (fix.type === 'move') return `Move ${fix.course} from ${termLabel(fix.from)} to ${termLabel(fix.to)}.`;
  if (fix.type === 'add') return `Add ${fix.course} in ${termLabel(fix.to)}.`;
  return `Remove ${fix.course} from ${termLabel(fix.from)}.`;
}

/** Candidate fixes for one issue, before they are tried. */
function candidates(ctx, norm, issue) {
  const out = [];
  const termsOf = (id) => norm.terms.filter((t) => t.entries.some((e) => e.course === id)).map((t) => t.term);
  const window = ctx.axis.terms;
  const moves = (id, from) => window.filter((t) => t !== from).map((to) => ({ type: 'move', course: id, from, to }));
  const adds = (id) => {
    const def = ctx.catalog.courses[id];
    if (!def) return [];
    return window.map((to) => ({ type: 'add', course: id, to, hours: minCredits(def) }));
  };
  switch (issue.kind) {
    case 'already_completed':
    case 'duplicate_course':
      out.push({ type: 'remove', course: issue.course, from: issue.term });
      break;
    case 'missing_prerequisite':
      out.push(...moves(issue.course, issue.term));
      for (const p of issue.courses) {
        const at = termsOf(p);
        if (at.length) out.push(...moves(p, at[0]));
        else if (!norm.completed.includes(p) && !norm.in_progress.includes(p)) out.push(...adds(p));
      }
      break;
    case 'class_standing':
    case 'not_offered':
    case 'rarely_offered':
    case 'not_yet_offered':
      out.push(...moves(issue.course, issue.term));
      break;
    case 'overloaded_term':
    case 'light_term':
    case 'time_conflict':
      for (const id of issue.courses) out.push(...moves(id, issue.term));
      break;
    case 'missing_requirement':
    case 'milestone_not_planned':
      out.push(...adds(issue.course));
      break;
    case 'elective_hours': {
      const req = ctx.catalog.requirements.find((r) => r.id === issue.requirement);
      const inPlan = new Set(issue.courses);
      if (issue.hours_short > 0) {
        for (const id of req?.options ?? []) {
          const def = ctx.catalog.courses[id];
          if (!def || inPlan.has(id)) continue;
          const { min, max } = creditRange(def);
          const hours = Math.min(max, issue.hours_short);
          if (hours < min) continue;
          out.push(...window.map((to) => ({ type: 'add', course: id, to, hours })));
        }
      } else {
        for (const id of issue.courses) for (const from of termsOf(id)) out.push({ type: 'remove', course: id, from });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function fixCost(ctx, fix) {
  const n = (term) => ctx.axis.index.get(term) ?? 99;
  if (fix.type === 'remove') return 0;
  if (fix.type === 'add') return n(fix.to) * 0.01;
  const d = n(fix.to) - n(fix.from);
  return Math.abs(d) + (d > 0 ? 0.25 : 0); // prefer moving earlier on a tie: it does not delay graduation
}

function lastTermOf(norm) {
  return norm.terms.length ? norm.terms[norm.terms.length - 1].term : null;
}

function findFixes(ctx, norm, issue, baseline, run) {
  const before = new Set(baseline.filter((i) => i.severity === 'error').map((i) => i.id));
  const tried = new Set();
  const accepted = [];
  const partial = [];
  const pool = candidates(ctx, norm, issue);
  pool.sort((a, b) => fixCost(ctx, a) - fixCost(ctx, b));
  for (const fix of pool) {
    const key = JSON.stringify(fix);
    if (tried.has(key)) continue;
    tried.add(key);
    const changed = applyFix(norm, fix);
    const after = run(changed, issue.kind === 'time_conflict');
    const still = after.find((i) => i.id === issue.id);
    // A fix that only shrinks an overload or an hour count is kept as a partial fix: one step toward the answer.
    const shrinks = still && Number.isFinite(issue.amount) && Number.isFinite(still.amount) && still.amount < issue.amount;
    if (still && !shrinks) continue;
    const added = after.filter((i) => i.severity === 'error' && !before.has(i.id) && i.id !== issue.id);
    if (added.length) continue;
    const delays = lastTermOf(changed) && lastTermOf(norm) && compareTerms(lastTermOf(changed), lastTermOf(norm)) > 0;
    const entry = {
      ...fix,
      text: fixText(fix) + (delays ? ` This adds a term: the plan then ends in ${termLabel(lastTermOf(changed))}.` : ''),
      delays_graduation: !!delays,
      partial: !!still,
      ...(fix.from ? { from_label: termLabel(fix.from) } : {}),
      ...(fix.to ? { to_label: termLabel(fix.to) } : {}),
    };
    if (still) {
      entry.text += ` This is a first step. After it, the check still finds: ${still.message}`;
      if (partial.length < ctx.opts.max_fixes) partial.push(entry);
    } else accepted.push(entry);
    if (accepted.length >= ctx.opts.max_fixes) break;
  }
  return [...accepted, ...partial].slice(0, ctx.opts.max_fixes);
}

// -------------------------------------------------------------- readiness

/**
 * Push one course later and carry the change forward: every planned course that depends on it moves to the first
 * term where its prerequisites are met and it runs. Credit limits are ignored. Returns the new ordinal of each course.
 */
function propagate(ctx, place, push) {
  const pos = new Map(place.at);
  if (push) pos.set(push.course, push.ordinal);
  const termOf = (id) => {
    if (place.done.has(id)) return -Infinity;
    if (place.doing.has(id)) return -1;
    return pos.has(id) ? pos.get(id) : Infinity;
  };
  const n = ctx.axis.terms.length;
  for (let round = 0; round < 50; round += 1) {
    let changed = false;
    for (const [id, t] of pos) {
      const def = ctx.catalog.courses[id];
      if (!def) continue;
      let next = Math.max(t, readyOrdinal(def.prereqs, termOf));
      while (next < n && (!runsIn(ctx, id, ctx.axis.terms[next]) || !availableIn(ctx, id, ctx.axis.terms[next]))) next += 1;
      if (next >= n) next = Infinity;
      if (next !== t && next > t) { pos.set(id, next); changed = true; }
    }
    if (!changed) break;
  }
  return pos;
}

function nextRunningTerm(ctx, id, from) {
  for (let t = from; t < ctx.axis.terms.length; t += 1) {
    const term = ctx.axis.terms[t];
    if (runsIn(ctx, id, term) && availableIn(ctx, id, term)) return t;
  }
  return Infinity;
}

/**
 * Senior design readiness for each milestone in the catalog.
 * Returns [{ id, label, courses, status, planned_term, ready_term, missing, at_risk, message }] where
 *   status: 'done', 'ready', 'not_ready', or 'not_planned'
 *   ready_term: the first term the plan lets the milestone start (its prerequisites met and the course running)
 *   missing: prerequisites not met at the planned term
 *   at_risk: planned prerequisites with no room to slip, and how far one slip would move the start
 */
export function seniorDesignReadiness(ctx, norm) {
  const { catalog } = ctx;
  const place = placementsOf(ctx, norm);
  const out = [];
  for (const m of catalog.milestones ?? []) {
    const ids = (m.courses ?? []).filter((id) => catalog.courses[id]);
    if (!ids.length) continue;
    const firstId = ids[0];
    const def = catalog.courses[firstId];
    const label = m.label;
    if (ids.every((id) => place.done.has(id))) {
      out.push({ id: m.id, label, courses: ids, status: 'done', planned_term: null, ready_term: null, missing: [], at_risk: [], message: `${label} is finished.` });
      continue;
    }
    if (!ctx.axis) {
      out.push({ id: m.id, label, courses: ids, status: 'not_planned', planned_term: null, ready_term: null, missing: [], at_risk: [], message: `${label} is not in the plan.` });
      continue;
    }
    const readyAt = nextRunningTerm(ctx, firstId, Math.max(0, readyOrdinal(def.prereqs, place.termOf)));
    const readyTerm = Number.isFinite(readyAt) ? ctx.axis.terms[readyAt] : null;
    const plannedAt = place.doing.has(firstId) ? -1 : place.at.get(firstId);
    if (plannedAt === undefined) {
      const notPlanned = unmetLeaves(def.prereqs, place.termOf, ctx.axis.terms.length).map((l) => l.course);
      out.push({
        id: m.id, label, courses: ids, status: 'not_planned', planned_term: null, ready_term: readyTerm,
        missing: notPlanned, at_risk: [],
        message: readyTerm
          ? `${label} is not in the plan. The plan's courses would let ${firstId} start in ${termLabel(readyTerm)}.`
          : `${label} is not in the plan, and the plan does not yet hold everything ${firstId} needs: ${list(notPlanned)}.`,
      });
      continue;
    }

    const missing = unmetLeaves(def.prereqs, place.termOf, plannedAt).map((l) => l.course);

    // Courses on the way to senior design that cannot slip one term without moving the start.
    const atRisk = [];
    if (plannedAt >= 0 && missing.length === 0) {
      const baseStart = propagate(ctx, place, null).get(firstId);
      for (const [id, t] of place.at) {
        if (id === firstId || ids.includes(id) || t > plannedAt) continue;
        const slipTo = nextRunningTerm(ctx, id, t + 1);
        const moved = propagate(ctx, place, { course: id, ordinal: slipTo });
        const start = moved.get(firstId);
        if (start > baseStart) {
          const delay = Number.isFinite(start) ? start - baseStart : null;
          atRisk.push({
            course: id,
            term: ctx.axis.terms[t],
            delay_terms: delay,
            new_start_term: Number.isFinite(start) ? ctx.axis.terms[start] : null,
            message: Number.isFinite(start)
              ? `If ${id} slips from ${termLabel(ctx.axis.terms[t])} to its next offering, ${label.toLowerCase()} starts in ${termLabel(ctx.axis.terms[start])}, ${termsWord(delay)} later.`
              : `If ${id} slips from ${termLabel(ctx.axis.terms[t])}, ${label.toLowerCase()} cannot start inside the plan.`,
          });
        }
      }
      atRisk.sort((a, b) => compareTerms(a.term, b.term) || a.course.localeCompare(b.course));
    }

    const plannedTerm = plannedAt >= 0 ? ctx.axis.terms[plannedAt] : null;
    let status = missing.length ? 'not_ready' : 'ready';
    let message;
    if (status === 'not_ready') {
      message = `${label} is planned for ${termLabel(plannedTerm)}, but ${firstId} still needs ${list(missing)} by then.`
        + (readyTerm ? ` With the plan as written, the earliest start is ${termLabel(readyTerm)}.` : '');
    } else {
      message = plannedTerm ? `Ready for ${label.toLowerCase()} in ${termLabel(plannedTerm)}.` : `${label} is in progress.`;
      if (readyTerm && plannedTerm && compareTerms(readyTerm, plannedTerm) < 0) {
        message += ` The plan's courses would allow a start as early as ${termLabel(readyTerm)}.`;
      }
      if (atRisk.length) {
        const names = atRisk.map((r) => r.course);
        message += ` ${list(names)} ${names.length === 1 ? 'has' : 'have'} no room to slip.`;
      }
    }
    out.push({ id: m.id, label, courses: ids, status, planned_term: plannedTerm, ready_term: readyTerm, missing, at_risk: atRisk, message });
  }
  return out;
}

// -------------------------------------------------------------------- public

/**
 * Check a plan. See normalizePlan for the plan shape.
 * `schedules` maps a term id to a schedule file; terms with a schedule get a time conflict check.
 * Returns {
 *   ok,                // true when there are no errors
 *   summary,           // one sentence for the top of the page
 *   counts: { error, warning, info },
 *   issues: [{ id, kind, severity, course, term, term_label, courses, message, detail, fixes: [{ type, course, from, to, hours, text, delays_graduation }] }],
 *   terms: [{ term, label, hours, capacity, courses, status }],
 *   readiness: [...],  // see seniorDesignReadiness
 *   last_term, last_term_label,
 * }
 */
export function checkPlan({ catalog, offerings = null, schedules = {}, plan, fixes = true, replan = true } = {}) {
  const norm = normalizePlan(catalog, plan);
  const ctx = buildContext(catalog, offerings, norm);
  const run = (n, withTimes) => findIssues({ ...ctx, norm: n }, n, { timetables: withTimes, schedules });
  const issues = findIssues(ctx, norm, { timetables: true, schedules });
  if (fixes && ctx.axis) {
    const quick = run(norm, false);
    for (const issue of issues) {
      if (issue.severity === 'info') continue;
      issue.fixes = findFixes(ctx, norm, issue, issue.kind === 'time_conflict' ? issues : quick, run);
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]
    || (a.term && b.term ? compareTerms(a.term, b.term) : a.term ? -1 : b.term ? 1 : 0)
    || String(a.course).localeCompare(String(b.course)));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity] += 1;

  const readiness = seniorDesignReadiness(ctx, norm);
  const byTerm = new Map();
  for (const i of issues) if (i.term) byTerm.set(i.term, [...(byTerm.get(i.term) ?? []), i]);
  const terms = norm.terms.map((t) => {
    const list2 = byTerm.get(t.term) ?? [];
    return {
      term: t.term,
      label: termLabel(t.term),
      hours: t.entries.reduce((s, e) => s + e.hours, 0) + t.other_hours,
      other_hours: t.other_hours,
      capacity: capacityOf(norm.options, t.term),
      courses: t.entries.map((e) => ({
        course: e.course, hours: e.hours,
        issues: list2.filter((i) => i.course === e.course || i.courses.includes(e.course)).map((i) => i.id),
      })),
      status: list2.some((i) => i.severity === 'error') ? 'error' : list2.some((i) => i.severity === 'warning') ? 'warning' : 'ok',
    };
  });

  let summary;
  if (!norm.terms.length) summary = 'The plan has no terms yet.';
  else if (counts.error === 0 && counts.warning === 0) summary = 'The plan has no problems.';
  else {
    const parts = [];
    if (counts.error) parts.push(`${counts.error} ${counts.error === 1 ? 'problem' : 'problems'} to fix`);
    if (counts.warning) parts.push(`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`);
    summary = `The plan has ${list(parts)}.`;
  }
  const sd = readiness.find((r) => r.id === 'senior-design') ?? readiness[0];
  if (sd) summary += ` ${sd.message}`;
  const last = lastTermOf(norm);
  const stuck = issues.some((i) => i.severity === 'error' && i.fixes.length === 0);
  return {
    replan: fixes && replan && stuck ? suggestReplan({ catalog, offerings, plan }) : null,
    ok: counts.error === 0,
    summary,
    counts,
    issues,
    terms,
    readiness,
    last_term: last,
    last_term_label: last ? termLabel(last) : null,
  };
}

/**
 * A whole new plan from the planner, for when no single move fixes a problem. It starts in the plan's first term,
 * keeps the plan's finished courses, courses in progress, credit limit, and elective picks, and lists how it differs.
 * Returns { plan, last_term, last_term_label, readiness, moved: [{ course, from, to }], message } or null.
 */
export function suggestReplan({ catalog, offerings = null, plan }) {
  const norm = normalizePlan(catalog, plan);
  if (!norm.terms.length) return null;
  const choices = {};
  for (const req of catalog.requirements ?? []) {
    if (req.type === 'choose_hours') choices[req.id] = electivePicksInPlan(catalog, norm, req);
    if (req.type === 'choose') choices[req.id] = (req.options ?? []).filter((c) => norm.terms.some((t) => t.entries.some((e) => e.course === c)));
  }
  const student = {
    start_term: norm.terms[0].term,
    completed: norm.completed,
    in_progress: norm.in_progress,
    choices,
    options: { max_credits: norm.options.max_credits, summer_allowed: norm.options.summer_allowed },
  };
  const made = planTerms({ catalog, offerings, student });
  const next = planFromPlanner(made, student);
  next.options = { ...norm.options };
  const where = (n) => {
    const m = new Map();
    for (const t of n.terms) for (const e of t.entries) if (!m.has(e.course)) m.set(e.course, t.term);
    return m;
  };
  const a = where(norm);
  const b = where(normalizePlan(catalog, next));
  const moved = [...new Set([...a.keys(), ...b.keys()])].sort()
    .filter((c) => a.get(c) !== b.get(c))
    .map((c) => ({ course: c, from: a.get(c) ?? null, to: b.get(c) ?? null }));
  const ctx = buildContext(catalog, offerings, normalizePlan(catalog, next));
  const readiness = seniorDesignReadiness(ctx, ctx.norm);
  const sd = readiness.find((r) => r.id === 'senior-design') ?? readiness[0];
  const lastTerm = made.graduation_term;
  return {
    plan: next,
    last_term: lastTerm,
    last_term_label: lastTerm ? termLabel(lastTerm) : null,
    readiness,
    moved,
    message: lastTerm
      ? `A rebuilt plan moves ${moved.length} ${moved.length === 1 ? 'course' : 'courses'} and finishes in ${termLabel(lastTerm)}.${sd?.planned_term ? ` Senior design starts in ${termLabel(sd.planned_term)}.` : ''}`
      : 'The planner could not build a complete plan inside the planning window.',
  };
}

/** Apply one fix from a checkPlan result to a plan and return the new plan (in the input shape). */
export function applyPlanFix(catalog, plan, fix) {
  return denormalizePlan(applyFix(normalizePlan(catalog, plan), fix));
}

