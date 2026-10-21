// Prerequisite expressions, offering seasons, and degree requirements.
// All functions here are pure: they read their arguments and return new values.

import { parseSuggested, positionSeason } from './terms.js';

// -------------------------------------------------------------------- credits

/** The range of credit hours a course can carry: { min, max }. A plain number means min and max are equal. */
export function creditRange(def) {
  const c = def?.credits;
  if (c && typeof c === 'object') return { min: c.min, max: c.max };
  return { min: c, max: c };
}

/** Hours a course counts for when the student has not chosen: the fixed hours, or the smallest choice. */
export function minCredits(def) {
  return creditRange(def).min;
}

/** True when the course carries a range of hours (the student picks hours each semester). */
export function hasVariableCredits(def) {
  const { min, max } = creditRange(def);
  return min !== max;
}

/** True when a student may take the course in more than one semester. */
export function isRepeatable(def) {
  return def?.repeatable === true;
}

/** The requirement types that list their options in `options`. */
export function isChoice(req) {
  return req?.type === 'choose' || req?.type === 'choose_hours';
}

// ---------------------------------------------------------------- expressions

/**
 * Turn a catalog prerequisite expression into one shape:
 *   { type: 'course', course, concurrent_ok, min_grade }
 *   { type: 'all', items: [...] }
 *   { type: 'any', items: [...] }
 * Returns null when there is no prerequisite.
 */
export function normalizePrereqs(expr) {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'string') {
    return { type: 'course', course: expr, concurrent_ok: false, min_grade: null };
  }
  if (typeof expr === 'object' && !Array.isArray(expr)) {
    if (typeof expr.course === 'string') {
      return {
        type: 'course',
        course: expr.course,
        concurrent_ok: expr.concurrent_ok === true,
        min_grade: expr.min_grade ?? null,
      };
    }
    for (const key of ['all', 'any']) {
      if (Array.isArray(expr[key])) {
        const items = expr[key].map(normalizePrereqs).filter((x) => x !== null);
        return { type: key, items };
      }
    }
  }
  throw new Error(`Cannot read prerequisite expression ${JSON.stringify(expr)}.`);
}

function asNorm(expr) {
  // A normalized node carries a string `type`; a raw catalog expression never does.
  return expr && typeof expr === 'object' && typeof expr.type === 'string' ? expr : normalizePrereqs(expr);
}

/** Every course named in an expression, once each, in order of appearance. */
export function prereqCourses(expr) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'course') {
      if (!out.includes(node.course)) out.push(node.course);
    } else {
      node.items.forEach(walk);
    }
  };
  walk(asNorm(expr));
  return out;
}

/** Every course leaf in an expression, with its concurrent flag and the kind of group it sits in. */
export function prereqLeaves(expr) {
  const out = [];
  const walk = (node, group) => {
    if (!node) return;
    if (node.type === 'course') out.push({ ...node, group });
    else node.items.forEach((child) => walk(child, node.type));
  };
  walk(asNorm(expr), 'all');
  return out;
}

/** Plain-language text for an expression. */
export function describePrereqs(expr) {
  const render = (node, top) => {
    if (node.type === 'course') {
      return node.concurrent_ok ? `${node.course} (may be taken at the same time)` : node.course;
    }
    if (node.items.length === 0) return 'none';
    if (node.items.length === 1) return render(node.items[0], top);
    if (node.type === 'any') {
      const parts = node.items.map((i) => render(i, false));
      return top ? `one of: ${parts.join(', ')}` : `(${parts.join(' or ')})`;
    }
    const parts = node.items.map((i) => render(i, false));
    return top ? parts.join(' and ') : `(${parts.join(' and ')})`;
  };
  const norm = asNorm(expr);
  return norm ? render(norm, true) : 'None';
}

/**
 * Check an expression against what a student has done.
 * `before` holds courses finished in earlier terms. `same` holds courses taken in the same term.
 * Returns { ok, missing }, where `missing` lists plain-language descriptions of what is still needed.
 */
export function evaluatePrereqs(expr, { before = new Set(), same = new Set() } = {}) {
  const norm = asNorm(expr);
  const check = (node) => {
    if (node.type === 'course') {
      const ok = before.has(node.course) || (node.concurrent_ok && same.has(node.course));
      return { ok, missing: ok ? [] : [describePrereqs(node)] };
    }
    const results = node.items.map(check);
    if (node.type === 'all') {
      return { ok: results.every((r) => r.ok), missing: results.flatMap((r) => r.missing) };
    }
    if (results.length === 0) return { ok: true, missing: [] };
    const ok = results.some((r) => r.ok);
    return { ok, missing: ok ? [] : [describePrereqs(node)] };
  };
  return norm ? check(norm) : { ok: true, missing: [] };
}

/**
 * The earliest ordinal at which an expression is satisfied.
 * `termOf(course)` gives the ordinal where a course is taken: -Infinity if done already,
 * Infinity if it can never be taken. A strict prerequisite must come one term earlier.
 */
export function readyOrdinal(expr, termOf) {
  const norm = asNorm(expr);
  const ready = (node) => {
    if (node.type === 'course') return termOf(node.course) + (node.concurrent_ok ? 0 : 1);
    if (node.items.length === 0) return -Infinity;
    const values = node.items.map(ready);
    return node.type === 'all' ? Math.max(...values) : Math.min(...values);
  };
  return norm ? ready(norm) : -Infinity;
}

/**
 * The leaves that decide when an expression is satisfied: for an all-group, the latest items;
 * for an any-group, the earliest alternative (first listed on a tie).
 */
export function bindingLeaves(expr, termOf) {
  const norm = asNorm(expr);
  const ready = (node) => readyOrdinal(node, termOf);
  const pick = (node) => {
    if (node.type === 'course') return [node];
    if (node.items.length === 0) return [];
    if (node.type === 'any') {
      let best = node.items[0];
      let bestValue = ready(best);
      for (const item of node.items.slice(1)) {
        const value = ready(item);
        if (value < bestValue) { best = item; bestValue = value; }
      }
      return pick(best);
    }
    const values = node.items.map(ready);
    const max = Math.max(...values);
    return node.items.flatMap((item, n) => (values[n] === max ? pick(item) : []));
  };
  return norm ? pick(norm) : [];
}

/** Every leaf the planner treats as a real dependency (all-group leaves plus the best any-group alternative). */
export function dependencyLeaves(expr, termOf) {
  const norm = asNorm(expr);
  const out = [];
  const walk = (node) => {
    if (node.type === 'course') { out.push(node); return; }
    if (node.items.length === 0) return;
    if (node.type === 'all') { node.items.forEach(walk); return; }
    let best = node.items[0];
    let bestValue = readyOrdinal(best, termOf);
    for (const item of node.items.slice(1)) {
      const value = readyOrdinal(item, termOf);
      if (value < bestValue) { best = item; bestValue = value; }
    }
    walk(best);
  };
  if (norm) walk(norm);
  return out;
}

/** Courses a student would have finished before starting `course`, following the first alternative of each any-group. */
export function ancestorsOf(catalog, course) {
  const seen = new Set();
  const visit = (id) => {
    const def = catalog.courses[id];
    if (!def) return;
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'course') {
        if (!seen.has(node.course)) { seen.add(node.course); visit(node.course); }
      } else if (node.type === 'all') node.items.forEach(walk);
      else if (node.items.length) walk(node.items[0]);
    };
    walk(normalizePrereqs(def.prereqs));
  };
  visit(course);
  return seen;
}

// ------------------------------------------------------------------- seasons

/** The season a course is suggested in, from the academic map. Falls back to the requirement it sits in. */
export function suggestedPositionOf(catalog, courseId) {
  const def = catalog.courses[courseId];
  if (def?.suggested_term) return parseSuggested(def.suggested_term);
  for (const req of catalog.requirements ?? []) {
    if (isChoice(req) && req.options?.includes(courseId) && req.suggested_term) {
      return parseSuggested(req.suggested_term);
    }
  }
  return null;
}

/**
 * Seasons in which a course can be planned.
 * Order of precedence: a what-if override, then offering data, then the suggested season from the academic map.
 * A unit with several components is offered only in seasons where every component with data is offered.
 * Returns { seasons: Set, source: 'edit' | 'data' | 'assumed', regular, occasional }.
 */
export function effectiveSeasons(catalog, courseId, offerings, { includeOccasional = false } = {}) {
  const def = catalog.courses[courseId];
  if (def && Array.isArray(def.season_override)) {
    return { seasons: new Set(def.season_override), source: 'edit', regular: [...def.season_override], occasional: [] };
  }
  const components = def?.components?.length ? def.components : [courseId];
  const entries = offerings?.courses
    ? components.map((c) => offerings.courses[c]).filter(Boolean)
    : [];
  if (entries.length > 0) {
    const regular = intersect(entries.map((e) => e.regular_seasons ?? []));
    const occasional = intersect(entries.map((e) => [...(e.regular_seasons ?? []), ...(e.occasional_seasons ?? [])]))
      .filter((s) => !regular.includes(s));
    const seasons = new Set(includeOccasional ? [...regular, ...occasional] : regular);
    return { seasons, source: 'data', regular, occasional };
  }
  const pos = suggestedPositionOf(catalog, courseId);
  const fallback = pos === null ? ['fall', 'spring'] : [positionSeason(pos)];
  return { seasons: new Set(fallback), source: 'assumed', regular: fallback, occasional: [] };
}

function intersect(lists) {
  if (lists.length === 0) return [];
  return lists[0].filter((s) => lists.every((l) => l.includes(s)));
}

// -------------------------------------------------------------- requirements

/** Map from each course to the id of the requirement that lists it. */
export function courseRequirementMap(catalog) {
  const map = new Map();
  for (const req of catalog.requirements ?? []) {
    const list = req.type === 'all' ? req.courses : isChoice(req) ? req.options : [];
    for (const course of list ?? []) {
      if (!map.has(course)) map.set(course, []);
      map.get(course).push(req.id);
    }
  }
  return map;
}

/**
 * Read a student's picks for a choose_hours requirement into a list of { course, hours } entries.
 * A pick is a course id, or { course, hours } where `hours` lists the hours for each semester the student takes the
 * course. A course with fixed hours always counts for its credit hours once. A course with a range of hours and no
 * `hours` counts for its smallest choice once. Hours outside the range are moved inside it, and a course that is not
 * repeatable counts for one semester.
 */
export function readHourPicks(catalog, req, picks = []) {
  const options = req.options ?? [];
  const out = [];
  for (const pick of picks ?? []) {
    const course = typeof pick === 'string' ? pick : pick?.course;
    const def = catalog.courses[course];
    if (!def || !options.includes(course) || out.some((p) => p.course === course)) continue;
    const { min, max } = creditRange(def);
    let hours = [min];
    if (hasVariableCredits(def)) {
      const given = Array.isArray(pick?.hours) ? pick.hours.filter((h) => Number.isFinite(h)) : [];
      if (given.length) hours = given.map((h) => Math.min(max, Math.max(min, Math.round(h))));
      if (!isRepeatable(def)) hours = hours.slice(0, 1);
    }
    out.push({ course, hours });
  }
  return out;
}

/** Hours used by each limit of a choose_hours requirement, for a list of { course, hours } entries. */
export function limitUsage(req, picks) {
  return (req.limits ?? []).map((limit) => {
    const used = picks
      .filter((p) => limit.courses.includes(p.course))
      .reduce((sum, p) => sum + p.hours.reduce((a, b) => a + b, 0), 0);
    return { courses: limit.courses, max_hours: limit.max_hours, used, over: used > limit.max_hours };
  });
}

/**
 * Add up a student's picks for a choose_hours requirement.
 * Returns { total, hours, status, limits, picks }. `status` is 'exact', 'under', or 'over'. `limits` lists the hours
 * used against each limit.
 */
export function checkHourPicks(catalog, req, picks = []) {
  const read = readHourPicks(catalog, req, picks);
  const total = read.reduce((sum, p) => sum + p.hours.reduce((a, b) => a + b, 0), 0);
  const limits = limitUsage(req, read);
  const status = total === req.hours ? 'exact' : total < req.hours ? 'under' : 'over';
  return { total, hours: req.hours, status, limits, picks: read, ok: status === 'exact' && !limits.some((l) => l.over) };
}

/**
 * Fill a choose_hours requirement. The student's picks come first, in the order given. Then options the student has
 * already completed, then the requirement's `defaults`, then the other options in catalog order. Hours that would go
 * over the total or over a limit are skipped. A course with a range of hours is added last, at the hours that are left.
 */
function fillHours(catalog, req, picks, done) {
  const options = req.options ?? [];
  const entries = new Map();   // course -> hours for each semester, in the order added
  let total = 0;
  const used = (list) => [...entries]
    .filter(([c]) => list.includes(c))
    .reduce((sum, [, hs]) => sum + hs.reduce((a, b) => a + b, 0), 0);
  const fits = (course, hour) => total + hour <= req.hours
    && (req.limits ?? []).every((limit) => !limit.courses.includes(course) || used(limit.courses) + hour <= limit.max_hours);
  const put = (course, hour) => {
    entries.set(course, [...(entries.get(course) ?? []), hour]);
    total += hour;
  };
  for (const pick of picks) {
    for (const hour of pick.hours) if (fits(pick.course, hour)) put(pick.course, hour);
  }
  const addWhole = (course) => {
    if (entries.has(course) || !options.includes(course) || !catalog.courses[course]) return;
    const def = catalog.courses[course];
    if (hasVariableCredits(def)) return;
    const hour = creditRange(def).min;
    if (fits(course, hour)) put(course, hour);
  };
  options.filter((c) => done.has(c)).forEach(addWhole);
  (req.defaults ?? []).forEach(addWhole);
  options.forEach(addWhole);
  // A course with a range of hours fills what is left.
  for (const course of options) {
    if (total >= req.hours) break;
    const def = catalog.courses[course];
    if (!def || entries.has(course) || !hasVariableCredits(def)) continue;
    const { min, max } = creditRange(def);
    for (let hour = Math.min(max, req.hours - total); hour >= min; hour -= 1) {
      if (fits(course, hour)) { put(course, hour); break; }
    }
  }
  const order = (c) => { const i = picks.findIndex((p) => p.course === c); return i === -1 ? 1000 + options.indexOf(c) : i; };
  return [...entries].map(([course, hours]) => ({ course, hours })).sort((a, b) => order(a.course) - order(b.course));
}

/**
 * Work out which courses a student must take.
 *   - Every course in an "all" requirement.
 *   - For a "choose" requirement: the options the student picked, topped up with options already completed,
 *     then with the first unpicked options in catalog order.
 *   - For a "choose_hours" requirement: the student's picks, filled up to the required hours (see fillHours).
 *   - Placeholders reserve hours only. A student marks one done by putting its id in `completed`.
 * A "choose_hours" pick is a course id or { course, hours: [hours for each semester] }.
 */
export function resolveRequirements(catalog, { completed = [], choices = {} } = {}) {
  const done = new Set(completed);
  const required = new Set();
  const chooseInfo = [];
  const placeholders = [];
  const hourPicks = {};
  for (const req of catalog.requirements ?? []) {
    if (req.type === 'all') {
      (req.courses ?? []).forEach((c) => required.add(c));
    } else if (req.type === 'choose') {
      const options = req.options ?? [];
      const picked = [];
      for (const c of choices[req.id] ?? []) {
        if (options.includes(c) && !picked.includes(c) && picked.length < req.count) picked.push(c);
      }
      for (const c of options) {
        if (picked.length < req.count && done.has(c) && !picked.includes(c)) picked.push(c);
      }
      for (const c of options) {
        if (picked.length < req.count && !picked.includes(c)) picked.push(c);
      }
      picked.forEach((c) => required.add(c));
      chooseInfo.push({ id: req.id, count: req.count, options, selected: picked, suggested_term: req.suggested_term ?? null });
    } else if (req.type === 'choose_hours') {
      const picks = fillHours(catalog, req, readHourPicks(catalog, req, choices[req.id] ?? []), done);
      picks.forEach((p) => required.add(p.course));
      hourPicks[req.id] = picks;
      chooseInfo.push({
        id: req.id, hours: req.hours, options: req.options ?? [], selected: picks.map((p) => p.course), picks,
        total: picks.reduce((sum, p) => sum + p.hours.reduce((a, b) => a + b, 0), 0),
        suggested_term: req.suggested_term ?? null,
      });
    } else if (req.type === 'placeholder') {
      placeholders.push({
        id: req.id,
        label: req.label ?? req.id,
        hours: req.hours ?? 0,
        suggested_terms: req.suggested_terms ?? [],
        done: done.has(req.id),
      });
    }
  }
  return { required, choose: chooseInfo, placeholders, hourPicks };
}

/**
 * Add courses that the required courses need but the degree does not list as required.
 * An all-group adds every missing course. An any-group adds its first alternative when none is present.
 * Returns { required, added }.
 */
export function closeOverPrereqs(catalog, required, completed) {
  const done = new Set(completed);
  const all = new Set(required);
  const added = [];
  const present = (node) => {
    if (node.type === 'course') return done.has(node.course) || all.has(node.course);
    if (node.items.length === 0) return true;
    return node.type === 'all' ? node.items.every(present) : node.items.some(present);
  };
  const ensure = (node) => {
    if (node.type === 'course') {
      if (!done.has(node.course) && !all.has(node.course) && catalog.courses[node.course]) {
        all.add(node.course);
        added.push(node.course);
        visit(node.course);
      }
      return;
    }
    if (node.items.length === 0) return;
    if (node.type === 'all') { node.items.forEach(ensure); return; }
    if (!node.items.some(present)) ensure(node.items[0]);
  };
  const visit = (id) => {
    if (done.has(id)) return;
    const norm = normalizePrereqs(catalog.courses[id]?.prereqs);
    if (norm) ensure(norm);
  };
  [...required].forEach(visit);
  return { required: all, added };
}
