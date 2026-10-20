// Prerequisite expressions, offering seasons, and degree requirements.
// All functions here are pure: they read their arguments and return new values.

import { parseSuggested, positionSeason } from './terms.js';

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
    if (req.type === 'choose' && req.options?.includes(courseId) && req.suggested_term) {
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
    const list = req.type === 'all' ? req.courses : req.type === 'choose' ? req.options : [];
    for (const course of list ?? []) {
      if (!map.has(course)) map.set(course, []);
      map.get(course).push(req.id);
    }
  }
  return map;
}

/**
 * Work out which courses a student must take.
 *   - Every course in an "all" requirement.
 *   - For a "choose" requirement: the options the student picked, topped up with options already completed,
 *     then with the first unpicked options in catalog order.
 *   - Placeholders reserve hours only. A student marks one done by putting its id in `completed`.
 */
export function resolveRequirements(catalog, { completed = [], choices = {} } = {}) {
  const done = new Set(completed);
  const required = new Set();
  const chooseInfo = [];
  const placeholders = [];
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
  return { required, choose: chooseInfo, placeholders };
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
