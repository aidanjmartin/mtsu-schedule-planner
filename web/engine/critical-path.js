// Critical path and slack.
//
// A forward pass finds the earliest term each course can be taken. A backward pass finds the latest term
// each course can be taken without moving the target graduation term. Slack is the number of usable terms
// between the two. Courses with zero slack form the critical path.
//
// Both passes follow prerequisites, offered seasons, and standing hours. They ignore the credit limit,
// which the term-by-term planner applies afterward.

import {
  buildTermAxis, ordinalOf, parseSuggested, termIndex, termFromIndex,
} from './terms.js';
import {
  normalizePrereqs, readyOrdinal, dependencyLeaves, effectiveSeasons,
  resolveRequirements, closeOverPrereqs, suggestedPositionOf,
} from './prereqs.js';

export const DEFAULT_OPTIONS = {
  summer_allowed: false,
  max_credits: 18,
  summer_max_credits: 8,
  include_occasional: false,
  target_term: null,
};

export function withDefaults(options) {
  return { ...DEFAULT_OPTIONS, ...(options ?? {}) };
}

/**
 * Collect everything the passes and the planner need into one object.
 * `student` follows the student state in DATA_FORMAT.md, plus an optional `choices` map
 * from "choose" requirement ids to the options the student picked.
 */
export function buildModel({ catalog, offerings = null, student, horizon = 24 }) {
  const options = withDefaults(student.options);
  const axis = buildTermAxis(student.start_term, { summerAllowed: options.summer_allowed, count: horizon });
  const completedList = student.completed ?? [];
  const completed = new Set(completedList.filter((c) => catalog.courses[c]));
  const inProgress = new Set((student.in_progress ?? []).filter((c) => catalog.courses[c] && !completed.has(c)));
  const placeholderIds = new Set((catalog.requirements ?? []).filter((r) => r.type === 'placeholder').map((r) => r.id));
  const unknownCompleted = completedList.filter((c) => !catalog.courses[c] && !placeholderIds.has(c));

  const reqs = resolveRequirements(catalog, { completed: completedList, choices: student.choices ?? {} });
  const closed = closeOverPrereqs(catalog, reqs.required, [...completed, ...inProgress]);

  const courses = new Map();
  for (const [id, def] of Object.entries(catalog.courses)) {
    const seasonInfo = effectiveSeasons(catalog, id, offerings, { includeOccasional: options.include_occasional });
    let status = 'optional';
    if (completed.has(id)) status = 'completed';
    else if (inProgress.has(id)) status = 'in_progress';
    else if (closed.required.has(id)) status = 'todo';
    const pos = suggestedPositionOf(catalog, id);
    courses.set(id, {
      id,
      title: def.title,
      credits: def.credits,
      prereqs: normalizePrereqs(def.prereqs),
      standing: def.standing ?? null,
      seasons: seasonInfo.seasons,
      seasonSource: seasonInfo.source,
      regular: seasonInfo.regular,
      occasional: seasonInfo.occasional,
      suggestedPos: pos,
      added: closed.added.includes(id),
      status,
    });
  }
  const byPosition = (a, b) =>
    (courses.get(a).suggestedPos ?? 99) - (courses.get(b).suggestedPos ?? 99) || a.localeCompare(b);
  const todo = [...courses.values()].filter((c) => c.status === 'todo').map((c) => c.id).sort(byPosition);

  let completedHours = 0;
  for (const id of completed) completedHours += courses.get(id).credits;
  for (const p of reqs.placeholders) if (p.done) completedHours += p.hours;

  // Gen-ed placeholders: spread each one's hours across its preferred terms.
  const startIdx = termIndex(student.start_term);
  const suggestedOfTodo = [...todo, ...inProgress].map((c) => courses.get(c).suggestedPos).filter((p) => p !== null);
  const basePosition = suggestedOfTodo.length ? Math.min(...suggestedOfTodo) : 0;
  const warnings = [];
  const chunks = [];
  for (const p of reqs.placeholders) {
    if (p.done || p.hours <= 0) continue;
    const terms = p.suggested_terms.length ? p.suggested_terms : [null];
    const base = Math.floor(p.hours / terms.length);
    const extra = p.hours % terms.length;
    terms.forEach((suggested, n) => {
      const hours = base + (n < extra ? 1 : 0);
      if (hours <= 0) return;
      let ordinal = 0;
      if (suggested) {
        const pos = parseSuggested(suggested);
        let idx = startIdx + Math.max(0, pos - basePosition);
        while (((idx % 3) + 3) % 3 !== pos % 3) idx += 1;
        ordinal = ordinalOf(axis, termFromIndex(idx));
      }
      if (ordinal >= axis.terms.length) {
        warnings.push(`${p.label}: the preferred term falls after the planning window, so these hours are not reserved.`);
        return;
      }
      chunks.push({ id: p.id, label: p.label, ordinal, hours });
    });
  }

  const assumptions = [];
  const assumed = [...courses.values()].filter((c) => c.status === 'todo' && c.seasonSource === 'assumed');
  if (assumed.length) {
    assumptions.push(
      offerings?.courses
        ? `No offering data for ${assumed.map((c) => c.id).join(', ')}. The plan uses each course's suggested season.`
        : 'No offering data loaded. The plan treats every course as regularly offered in its suggested season.',
    );
  }
  if (unknownCompleted.length) {
    warnings.push(`Not in this catalog and ignored: ${unknownCompleted.join(', ')}.`);
  }
  if (closed.added.length) {
    assumptions.push(`Added as needed prerequisites: ${closed.added.join(', ')}.`);
  }

  return {
    catalog, axis, options, student, courses, todo,
    completed, inProgress, completedHours,
    choose: reqs.choose, placeholders: reqs.placeholders, chunks, basePosition,
    added: closed.added, warnings, assumptions, unknownCompleted,
  };
}

function seasonAllowed(model, id, ordinal) {
  return model.courses.get(id).seasons.has(model.axis.seasons[ordinal]);
}

/** Smallest usable ordinal at or after `from` where the course runs. */
export function firstOffered(model, id, from) {
  const n = model.axis.terms.length;
  for (let t = Math.max(from, 0); t < n; t += 1) if (seasonAllowed(model, id, t)) return t;
  return Infinity;
}

/** Largest usable ordinal at or before `bound` where the course runs. */
export function lastOffered(model, id, bound) {
  const n = model.axis.terms.length;
  for (let t = Math.min(bound, n - 1); t >= 0; t -= 1) if (seasonAllowed(model, id, t)) return t;
  return -Infinity;
}

function hoursBefore(model, earliest, t) {
  let hours = model.completedHours;
  if (t >= 1) for (const id of model.inProgress) hours += model.courses.get(id).credits;
  for (const id of model.todo) if (earliest.get(id) < t) hours += model.courses.get(id).credits;
  for (const chunk of model.chunks) if (chunk.ordinal < t) hours += chunk.hours;
  return hours;
}

function forwardPass(model) {
  const levels = Object.keys(model.catalog.standing_hours ?? {});
  let ready = Object.fromEntries(levels.map((l) => [l, 0]));
  let earliest = new Map();
  const cycles = new Set();
  for (let iteration = 0; iteration < 20; iteration += 1) {
    earliest = new Map();
    const visiting = new Set();
    const termOf = (id) => {
      const course = model.courses.get(id);
      if (!course) return Infinity;
      if (course.status === 'completed') return -Infinity;
      if (course.status === 'in_progress') return 0;
      if (earliest.has(id)) return earliest.get(id);
      if (visiting.has(id)) { cycles.add(id); return Infinity; }
      visiting.add(id);
      let from = Math.max(readyOrdinal(course.prereqs, termOf), 0);
      if (course.standing) from = Math.max(from, ready[course.standing] ?? 0);
      const t = from === Infinity ? Infinity : firstOffered(model, id, from);
      visiting.delete(id);
      earliest.set(id, t);
      return t;
    };
    for (const id of model.courses.keys()) termOf(id);

    const next = {};
    for (const level of levels) {
      const need = model.catalog.standing_hours[level];
      let found = Infinity;
      for (let t = 0; t < model.axis.terms.length; t += 1) {
        if (hoursBefore(model, earliest, t) >= need) { found = t; break; }
      }
      next[level] = found;
    }
    const same = levels.every((l) => next[l] === ready[l]);
    ready = next;
    if (same) break;
  }
  return { earliest, cycles };
}

/** Edges used by the backward pass: prerequisite -> course that needs it. */
function buildSuccessors(model, earliest) {
  const termOf = (id) => {
    const c = model.courses.get(id);
    if (!c) return Infinity;
    if (c.status === 'completed') return -Infinity;
    if (c.status === 'in_progress') return 0;
    return earliest.get(id) ?? Infinity;
  };
  const succ = new Map(model.todo.map((id) => [id, []]));
  for (const id of model.todo) {
    if (!Number.isFinite(earliest.get(id))) continue;
    for (const leaf of dependencyLeaves(model.courses.get(id).prereqs, termOf)) {
      if (succ.has(leaf.course)) succ.get(leaf.course).push({ to: id, concurrent: leaf.concurrent_ok });
    }
  }
  return succ;
}

function backwardPass(model, succ, seeds) {
  const latest = new Map();
  const visiting = new Set();
  const latestOf = (id) => {
    if (latest.has(id)) return latest.get(id);
    if (visiting.has(id)) return undefined;
    visiting.add(id);
    let bound = seeds.has(id) ? seeds.get(id) : Infinity;
    for (const edge of succ.get(id) ?? []) {
      const downstream = latestOf(edge.to);
      if (downstream === undefined) continue;
      bound = Math.min(bound, downstream - (edge.concurrent ? 0 : 1));
    }
    visiting.delete(id);
    const result = bound === Infinity ? undefined : lastOffered(model, id, bound);
    latest.set(id, result);
    return result;
  };
  for (const id of model.todo) latestOf(id);
  return latest;
}

function chainLengths(model, succ) {
  const memo = new Map();
  const visiting = new Set();
  const lengthOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const edge of succ.get(id) ?? []) best = Math.max(best, 1 + lengthOf(edge.to));
    visiting.delete(id);
    memo.set(id, best);
    return best;
  };
  for (const id of model.todo) lengthOf(id);
  return memo;
}

function diagnose(model, earliest, id) {
  const course = model.courses.get(id);
  if (course.seasons.size === 0) return 'Not offered in any season the plan can use. Check the offering data or allow occasional offerings.';
  const blockers = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'course') {
      const c = model.courses.get(node.course);
      if (!c) blockers.push(`${node.course} is not in this catalog`);
      else if (c.status === 'todo' && earliest.get(node.course) === Infinity) blockers.push(`${node.course} cannot be scheduled`);
    } else node.items.forEach(walk);
  };
  walk(course.prereqs);
  if (blockers.length) return `Blocked: ${blockers.join('; ')}.`;
  return 'No usable term inside the planning window satisfies the prerequisites, standing, and offered seasons.';
}

/**
 * Run both passes.
 * Returns plain objects keyed by course id, so the result can be saved or compared as JSON.
 */
export function analyze(model) {
  const { earliest, cycles } = forwardPass(model);
  const todoAndPinned = [...model.todo, ...model.inProgress];
  const finiteFinishes = todoAndPinned.map((id) => (model.courses.get(id).status === 'in_progress' ? 0 : earliest.get(id))).filter(Number.isFinite);
  const finish = finiteFinishes.length ? Math.max(...finiteFinishes) : 0;
  const blocked = model.todo
    .filter((id) => !Number.isFinite(earliest.get(id)))
    .map((id) => ({ course: id, reason: diagnose(model, earliest, id) }));

  let target = finish;
  if (model.options.target_term) target = ordinalOf(model.axis, model.options.target_term);

  const succ = buildSuccessors(model, earliest);
  const chains = chainLengths(model, succ);
  const graduationSeeds = new Map(model.todo.map((id) => [id, target]));
  const latest = backwardPass(model, succ, graduationSeeds);

  const termName = (t) => (Number.isFinite(t) && t >= 0 && t < model.axis.terms.length ? model.axis.terms[t] : null);
  const courses = {};
  for (const c of model.courses.values()) {
    const e = c.status === 'todo' || c.status === 'optional' ? earliest.get(c.id) : c.status === 'in_progress' ? 0 : null;
    const entry = {
      status: c.status,
      added: c.added,
      credits: c.credits,
      earliest: Number.isFinite(e) ? e : null,
      earliest_term: termName(e),
      latest: null, latest_term: null, slack: null, critical: false,
      chain: chains.get(c.id) ?? 0,
      seasons: [...c.seasons],
      season_source: c.seasonSource,
      blocked: c.status === 'todo' && !Number.isFinite(e),
    };
    if (c.status === 'todo') {
      const l = latest.get(c.id);
      if (Number.isFinite(l) && entry.earliest !== null) {
        entry.latest = l;
        entry.latest_term = termName(l);
        entry.slack = l - entry.earliest;
        entry.critical = entry.slack <= 0;
      } else if (l === -Infinity && entry.earliest !== null) {
        entry.slack = -(entry.earliest + 1);
        entry.critical = true;
      }
    } else if (c.status === 'in_progress') {
      entry.latest = 0; entry.latest_term = termName(0); entry.slack = 0;
    }
    courses[c.id] = entry;
  }

  // Slack toward each milestone, measured against that milestone's own earliest terms.
  const milestones = {};
  for (const m of model.catalog.milestones ?? []) {
    const members = (m.courses ?? []).filter((id) => model.courses.has(id));
    const open = members.filter((id) => model.courses.get(id).status === 'todo' && Number.isFinite(earliest.get(id)));
    const starts = members.map((id) => courses[id].earliest).filter((v) => v !== null);
    const seeds = new Map(open.map((id) => [id, earliest.get(id)]));
    const lat = backwardPass(model, succ, seeds);
    const slack = {};
    const critical = [];
    for (const id of model.todo) {
      const l = lat.get(id);
      if (Number.isFinite(l) && courses[id].earliest !== null) {
        slack[id] = l - courses[id].earliest;
        if (slack[id] <= 0) critical.push(id);
      }
    }
    milestones[m.id] = {
      label: m.label,
      courses: members,
      start: starts.length ? Math.min(...starts) : null,
      start_term: starts.length ? termName(Math.min(...starts)) : null,
      end: starts.length ? Math.max(...starts) : null,
      end_term: starts.length ? termName(Math.max(...starts)) : null,
      slack,
      critical,
    };
  }

  const critical = model.todo
    .filter((id) => courses[id].critical)
    .sort((a, b) => courses[a].earliest - courses[b].earliest || a.localeCompare(b));

  return {
    start_term: model.student.start_term,
    terms: model.axis.terms,
    feasible: blocked.length === 0,
    finish: todoAndPinned.length ? finish : null,
    finish_term: todoAndPinned.length ? termName(finish) : null,
    target,
    target_term: termName(target),
    courses,
    critical,
    milestones,
    blocked,
    cycles: [...cycles],
    warnings: [...model.warnings],
    assumptions: [...model.assumptions],
  };
}

/** Convenience wrapper: build the model, run both passes, return the analysis. */
export function analyzeCriticalPath({ catalog, offerings = null, student, horizon = 24 }) {
  return analyze(buildModel({ catalog, offerings, student, horizon }));
}

