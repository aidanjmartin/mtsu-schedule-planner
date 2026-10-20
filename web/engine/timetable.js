// Section timetabling for the courses planned in one term.
//
// A planning unit is a catalog course with its components (for example a lecture and its lab). Each component
// needs one section. A component whose sections include both lecture-type and lab-type rows needs one of each.
// The search returns every combination without time overlaps, ranked by fewest campus days and then fewest
// classes that start before 9:00 a.m. When nothing fits, it names the smallest sets of courses that conflict.

import { seasonOf } from './terms.js';

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function datesOverlap(a, b) {
  if (!a.start_date || !a.end_date || !b.start_date || !b.end_date) return true;
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}

/** Two meetings overlap only when their days share a letter, their times overlap, and their date ranges overlap. */
export function meetingsOverlap(a, b) {
  if (!a.days || !b.days) return false;
  const sharedDay = [...a.days].some((d) => b.days.includes(d));
  if (!sharedDay) return false;
  if (!(toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end))) return false;
  return datesOverlap(a, b);
}

/** The first pair of overlapping meetings between two sections, or null. */
export function sectionsOverlap(s1, s2) {
  for (const a of s1.meetings ?? []) {
    for (const b of s2.meetings ?? []) {
      if (meetingsOverlap(a, b)) {
        const day = [...a.days].find((d) => b.days.includes(d));
        return { a, b, day };
      }
    }
  }
  return null;
}

function isOnline(section) {
  return /online|virtual|asynchronous/i.test(section.instructional_method ?? '')
    || /^online/i.test(section.schedule_type ?? '');
}

function kindOf(section) {
  return /^(lab|laboratory|recitation|discussion)/i.test(section.schedule_type ?? '') ? 'lab' : 'main';
}

/**
 * Build the choices for each planned course.
 * Returns { units, groups }. Each group is one pick: a section of one component of one course.
 */
export function buildUnits({ courses, catalog, schedule }) {
  const units = [];
  const groups = [];
  const sections = schedule?.sections ?? [];
  for (const course of courses) {
    const def = catalog.courses[course];
    const components = def?.components?.length ? def.components : [course];
    const unit = { course, title: def?.title ?? course, groups: [], missing: [] };
    for (const component of components) {
      const found = sections.filter((s) => s.course === component);
      if (found.length === 0) { unit.missing.push(component); continue; }
      for (const kind of ['main', 'lab']) {
        const subset = found.filter((s) => kindOf(s) === kind);
        if (subset.length === 0) continue;
        const group = { course, component, kind, sections: subset };
        unit.groups.push(group);
        groups.push(group);
      }
    }
    units.push(unit);
  }
  return { units, groups };
}

function summarize(section, course, component) {
  return {
    course,
    component,
    crn: section.crn,
    section: section.section,
    title: section.title,
    schedule_type: section.schedule_type,
    instructor: section.instructor ?? '',
    online: isOnline(section),
    meetings: section.meetings ?? [],
  };
}

/** Run the search over a list of groups. Returns every valid combination as arrays of section indexes. */
function enumerate(groups, { maxNodes = 1_000_000, maxSolutions = 200_000, stopAtFirst = false } = {}) {
  const ordered = [...groups].sort((a, b) => a.sections.length - b.sections.length);
  const memo = new Map();
  const conflicts = (a, b) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!memo.has(key)) memo.set(key, sectionsOverlap(flat[a], flat[b]) !== null);
    return memo.get(key);
  };
  const flat = [];
  const info = [];
  const levels = ordered.map((g) => g.sections.map((s) => {
    const idx = flat.length;
    flat.push(s);
    const campus = !isOnline(s);
    info.push({
      days: campus ? new Set((s.meetings ?? []).flatMap((m) => [...m.days])) : new Set(),
      early: (s.meetings ?? []).some((m) => toMinutes(m.start) < 9 * 60) ? 1 : 0,
    });
    return idx;
  }));

  const solutions = [];
  const chosen = [];
  let nodes = 0;
  let truncated = false;
  const walk = (level) => {
    if (truncated || (stopAtFirst && solutions.length)) return;
    if (level === levels.length) {
      const days = new Set();
      let early = 0;
      for (const idx of chosen) { info[idx].days.forEach((d) => days.add(d)); early += info[idx].early; }
      solutions.push({ picks: [...chosen], days: [...days], early });
      if (solutions.length >= maxSolutions) truncated = true;
      return;
    }
    for (const idx of levels[level]) {
      nodes += 1;
      if (nodes > maxNodes) { truncated = true; return; }
      if (chosen.some((other) => conflicts(idx, other))) continue;
      chosen.push(idx);
      walk(level + 1);
      chosen.pop();
    }
  };
  walk(0);
  return { ordered, flat, solutions, truncated };
}

const DAY_ORDER = 'MTWRFSU';

/**
 * Find conflict-free section combinations for the courses planned in one term.
 * `movable(course)` is optional and returns { can_move, to_term, slack } for the conflict report.
 */
export function planTimetables({ courses, catalog, schedule, limit = 10, movable = null, maxNodes }) {
  if (!schedule || !Array.isArray(schedule.sections)) {
    return { available: false, options: [], total: 0, truncated: false, no_sections: [], conflicts: [], units: [] };
  }
  const { units, groups } = buildUnits({ courses, catalog, schedule });
  const noSections = units.filter((u) => u.missing.length > 0)
    .map((u) => ({ course: u.course, missing: u.missing, title: u.title }));
  const usable = units.filter((u) => u.missing.length === 0 && u.groups.length > 0);
  const usableGroups = usable.flatMap((u) => u.groups);

  const result = {
    available: true, units: units.map((u) => u.course), no_sections: noSections,
    options: [], total: 0, truncated: false, conflicts: [],
  };
  if (usable.length === 0) return result;

  const run = enumerate(usableGroups, { maxNodes });
  result.truncated = run.truncated;
  result.total = run.solutions.length;

  if (run.solutions.length > 0) {
    const labelOf = (idx) => {
      const g = run.ordered.find((grp) => grp.sections.includes(run.flat[idx]));
      return summarize(run.flat[idx], g.course, g.component);
    };
    const ranked = run.solutions.map((s) => ({
      ...s,
      choices: s.picks.map(labelOf),
    }));
    for (const r of ranked) {
      r.choices.sort((a, b) => a.course.localeCompare(b.course) || a.component.localeCompare(b.component) || a.section.localeCompare(b.section));
      r.key = r.choices.map((c) => c.crn).join(',');
    }
    ranked.sort((a, b) => a.days.length - b.days.length || a.early - b.early || a.key.localeCompare(b.key));
    result.options = ranked.slice(0, limit).map((r) => ({
      campus_days: r.days.length,
      early_classes: r.early,
      days: [...r.days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
      choices: r.choices,
    }));
    return result;
  }

  result.conflicts = explainConflicts({ usable, movable, maxNodes });
  return result;
}

function combinations(list, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < list.length; i += 1) { acc.push(list[i]); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

function feasible(units, maxNodes) {
  const run = enumerate(units.flatMap((u) => u.groups), { maxNodes, stopAtFirst: true });
  return run.solutions.length > 0;
}

/**
 * Find the smallest sets of courses that cannot all fit, with the overlapping sections that cause it.
 * Every proper subset of a reported set does fit.
 */
export function explainConflicts({ usable, movable = null, maxNodes }) {
  const maxSize = Math.min(usable.length, 4);
  let sets = [];
  let minimal = true;
  for (let k = 1; k <= maxSize && sets.length === 0; k += 1) {
    sets = combinations(usable, k).filter((subset) => !feasible(subset, maxNodes)).slice(0, 10);
  }
  if (sets.length === 0) { sets = [usable]; minimal = false; }

  return sets.map((subset) => {
    const names = subset.map((u) => u.course);
    let reason;
    if (subset.length === 1) {
      reason = `${names[0]} cannot fit with itself: its lecture and lab sections always overlap.`;
    } else if (subset.length === 2) {
      reason = `Every section of ${names[0]} overlaps every section of ${names[1]}.`;
    } else {
      reason = `No combination of ${names.join(', ')} fits without an overlap.`;
    }
    if (!minimal) reason = `No combination of all ${names.length} courses fits, and no small group explains it. ${names.join(', ')}.`;

    const examples = [];
    if (subset.length <= 2) {
      const all = subset.flatMap((u) => u.groups.flatMap((g) => g.sections.map((s) => ({ s, g }))));
      for (let i = 0; i < all.length && examples.length < 6; i += 1) {
        for (let j = i + 1; j < all.length && examples.length < 6; j += 1) {
          if (all[i].g === all[j].g) continue;
          const hit = sectionsOverlap(all[i].s, all[j].s);
          if (hit) {
            examples.push({
              a: summarize(all[i].s, all[i].g.course, all[i].g.component),
              b: summarize(all[j].s, all[j].g.course, all[j].g.component),
              day: hit.day,
            });
          }
        }
      }
    }

    const resolutions = subset.map((unit) => {
      const info = movable ? movable(unit.course) : { can_move: false, to_term: null, slack: 0 };
      const rest = usable.filter((u) => u !== unit);
      const without = rest.length ? enumerate(rest.flatMap((u) => u.groups), { maxNodes, stopAtFirst: true }).solutions.length > 0 : true;
      return {
        course: unit.course,
        can_move: !!info.can_move,
        move_to: info.to_term ?? null,
        slack: info.slack ?? 0,
        fits_without: without,
      };
    });
    return { courses: names, minimal, reason, examples, resolutions };
  });
}

/**
 * Pairs of planned courses that can never fit together: every pairing of their sections overlaps.
 * Returns an array of [courseA, courseB].
 */
export function incompatiblePairs({ courses, catalog, schedule, maxNodes }) {
  if (!schedule || !Array.isArray(schedule.sections)) return [];
  const { units } = buildUnits({ courses, catalog, schedule });
  const usable = units.filter((u) => u.missing.length === 0 && u.groups.length > 0);
  return combinations(usable, 2)
    .filter((pair) => !feasible(pair, maxNodes))
    .map((pair) => pair.map((u) => u.course));
}

/**
 * Where a course can move without delaying graduation: the next term after `currentTerm` in which it is
 * offered and that is not later than its latest allowed term. Returns null when it cannot move.
 */
export function nextTermWithinSlack(analysis, course, currentTerm) {
  const info = analysis.courses[course];
  if (!info || info.latest === null || info.latest === undefined) return null;
  const current = analysis.terms.indexOf(currentTerm);
  for (let t = current + 1; t <= info.latest && t < analysis.terms.length; t += 1) {
    if (info.seasons.includes(seasonOf(analysis.terms[t]))) return analysis.terms[t];
  }
  return null;
}

/** Build the `movable` callback for planTimetables from an analysis. */
export function movableFromAnalysis(analysis, currentTerm) {
  return (course) => {
    const to = nextTermWithinSlack(analysis, course, currentTerm);
    return { can_move: to !== null, to_term: to, slack: analysis.courses[course]?.slack ?? 0 };
  };
}
