// Elective optimization for a career track.
//
// A career track (data/career-tracks.json) gives each elective a weight from 0 (no help toward the track) to 3
// (central to the track). The optimizer lists every set of electives that meets the hour requirement exactly and
// stays inside its limits, scores each set by how well it fits the track, and then plans the best-scoring sets to
// see when each one lets the student graduate and start senior design.
//
// Ranking rule, in order:
//   1. earliest graduation term (a set that adds a term ranks below every set that does not)
//   2. earliest senior design start
//   3. highest track fit: the sum of weight times hours, divided by 3 times the required hours
//   4. fewest extra prerequisite courses the set pulls in
//   5. fewest hours of variable-hour credit (internship and research), which depend on an employer or a faculty project
//   6. fewest courses
// Courses the student finished, or asks to keep, are in every set. Courses the student asks to avoid are in none.

import { planTerms } from './planner.js';
import { creditRange, hasVariableCredits, isRepeatable, limitUsage, minCredits } from './prereqs.js';
import { termDistance, termLabel } from './terms.js';

export const MAX_WEIGHT = 3;
const WEIGHT_WORDS = ['does not help', 'helps a little', 'helps', 'is central'];

const list = (items, joiner = 'and') => {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${joiner} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${joiner} ${items[items.length - 1]}`;
};

/** The requirement a tracks file applies to: the one it names, or the catalog's first choose_hours requirement. */
export function trackRequirement(catalog, tracksFile = null) {
  const reqs = catalog.requirements ?? [];
  return reqs.find((r) => r.id === tracksFile?.requirement) ?? reqs.find((r) => r.type === 'choose_hours') ?? null;
}

/** Check a tracks file against a catalog. Returns { errors, warnings } as lists of messages. */
export function validateTracks(catalog, tracksFile) {
  const errors = [];
  const warnings = [];
  const req = trackRequirement(catalog, tracksFile);
  if (!req) errors.push('The catalog has no elective hour requirement for the tracks to use.');
  if (tracksFile?.requirement && req?.id !== tracksFile.requirement) errors.push(`The tracks name the requirement "${tracksFile.requirement}", which is not in the catalog.`);
  const ids = new Set();
  for (const track of tracksFile?.tracks ?? []) {
    if (!track.id || ids.has(track.id)) errors.push(`Track ids must be present and unique ("${track.id}").`);
    ids.add(track.id);
    if (!track.label) errors.push(`Track "${track.id}" needs a label.`);
    for (const [course, w] of Object.entries(track.weights ?? {})) {
      if (!catalog.courses[course]) errors.push(`Track "${track.id}" weights ${course}, which is not in the catalog.`);
      else if (req && !req.options.includes(course)) warnings.push(`Track "${track.id}" weights ${course}, which is not an elective option.`);
      if (!(Number.isInteger(w) && w >= 0 && w <= MAX_WEIGHT)) errors.push(`Track "${track.id}" gives ${course} the weight ${w}. Use a whole number from 0 to ${MAX_WEIGHT}.`);
    }
    for (const option of req?.options ?? []) {
      if (!(option in (track.weights ?? {}))) warnings.push(`Track "${track.id}" has no weight for ${option}, so it counts as 0.`);
    }
  }
  return { errors, warnings };
}

/** Ways to take a course with a range of hours for `total` hours: the fewest semesters, at most `max` each. */
function splitHours(def, total) {
  const { min, max } = creditRange(def);
  if (!isRepeatable(def)) return total >= min && total <= max ? [total] : null;
  const out = [];
  let left = total;
  while (left > 0) {
    const h = Math.min(max, left);
    out.push(h);
    left -= h;
  }
  if (out.length && out[out.length - 1] < min) return null;
  return out;
}

/**
 * Every set of options that adds up to exactly the required hours and stays inside every limit.
 * Each set is a list of { course, hours } where `hours` lists the hours for each semester.
 * `keep` courses are in every set; `avoid` courses are in none.
 */
export function electiveSets(catalog, req, { keep = [], avoid = [], maxSets = 20000 } = {}) {
  const options = (req.options ?? []).filter((c) => catalog.courses[c] && !avoid.includes(c));
  const sets = [];
  const chosen = [];
  const walk = (i, total) => {
    if (sets.length >= maxSets) return;
    if (total === req.hours) {
      if (keep.every((k) => chosen.some((c) => c.course === k)) && !limitUsage(req, chosen).some((l) => l.over)) {
        sets.push(chosen.map((c) => ({ course: c.course, hours: [...c.hours] })));
      }
      return;
    }
    if (i >= options.length || total > req.hours) return;
    const course = options[i];
    const def = catalog.courses[course];
    const ways = [];
    if (hasVariableCredits(def)) {
      const { min, max } = creditRange(def);
      const top = isRepeatable(def) ? req.hours - total : Math.min(max, req.hours - total);
      for (let h = top; h >= min; h -= 1) {
        const split = splitHours(def, h);
        if (split) ways.push(split);
      }
    } else if (total + minCredits(def) <= req.hours) {
      ways.push([minCredits(def)]);
    }
    for (const hours of ways) {
      chosen.push({ course, hours });
      walk(i + 1, total + hours.reduce((a, b) => a + b, 0));
      chosen.pop();
    }
    if (!keep.includes(course)) walk(i + 1, total);
  };
  walk(0, 0);
  return sets;
}

/** How well a set fits a track: { points, max, fit } with fit from 0 to 1. */
export function trackFit(track, picks, requiredHours) {
  const points = picks.reduce((sum, p) => sum + (track.weights?.[p.course] ?? 0) * p.hours.reduce((a, b) => a + b, 0), 0);
  const max = MAX_WEIGHT * requiredHours;
  return { points, max, fit: max ? points / max : 0 };
}

function describePick(catalog, track, pick) {
  const weight = track.weights?.[pick.course] ?? 0;
  const total = pick.hours.reduce((a, b) => a + b, 0);
  return {
    course: pick.course,
    title: catalog.courses[pick.course]?.title ?? pick.course,
    hours: [...pick.hours],
    total_hours: total,
    weight,
    weight_text: WEIGHT_WORDS[weight] ?? WEIGHT_WORDS[0],
    why: track.why?.[pick.course] ?? null,
  };
}

function explanation(track, picks, rec, baseline) {
  const central = picks.filter((p) => p.weight === MAX_WEIGHT).map((p) => p.course);
  const helps = picks.filter((p) => p.weight > 0 && p.weight < MAX_WEIGHT).map((p) => p.course);
  const none = picks.filter((p) => p.weight === 0).map((p) => p.course);
  const parts = [`Fits ${track.label.toLowerCase()} at ${rec.fit_percent}%.`];
  if (central.length) parts.push(`${list(central)} ${central.length === 1 ? 'is' : 'are'} central to the track.`);
  if (helps.length) parts.push(`${list(helps)} ${helps.length === 1 ? 'helps' : 'help'}.`);
  if (none.length) parts.push(`${list(none)} ${none.length === 1 ? 'fills' : 'fill'} the remaining hours.`);
  if (rec.graduation_term && baseline?.graduation_term) {
    if (rec.delay_terms > 0) parts.push(`Graduation moves to ${termLabel(rec.graduation_term)}, ${rec.delay_terms} ${rec.delay_terms === 1 ? 'term' : 'terms'} later than with the default electives.`);
    else if (rec.delay_terms < 0) parts.push(`Graduation moves up to ${termLabel(rec.graduation_term)}.`);
    else parts.push(`Graduation stays in ${termLabel(rec.graduation_term)}.`);
  } else if (!rec.graduation_term) {
    parts.push('The planner could not fit every course inside the planning window with this set.');
  }
  if (rec.added_prereqs.length) parts.push(`It also adds ${list(rec.added_prereqs)} as needed prerequisites.`);
  return parts.join(' ');
}

/**
 * Recommend elective sets for a career track.
 *   catalog, offerings
 *   tracks: the career tracks file; track: a track id (or a track object)
 *   student: a planner student state (start_term, completed, in_progress, options, start_position)
 *   keep, avoid: course ids to force in or out
 *   limit: how many recommendations to return; evaluate: how many top-scoring sets to plan
 * Returns { track, requirement, baseline, considered, recommendations: [...] } where each recommendation is
 *   { rank, picks: [{ course, title, hours, total_hours, weight, weight_text, why }], choices, total_hours,
 *     fit, fit_percent, graduation_term, graduation_label, senior_design_start, delay_terms, added_prereqs,
 *     unplaced, explanation }
 * `choices` drops straight into a planner student state.
 */
export function optimizeElectives({
  catalog, offerings = null, tracks = null, track, student, keep = [], avoid = [], limit = 5, evaluate = 25,
}) {
  const trackObj = typeof track === 'object' && track ? track : (tracks?.tracks ?? []).find((t) => t.id === track);
  if (!trackObj) throw new Error(`There is no career track "${track}".`);
  const req = trackRequirement(catalog, tracks);
  if (!req) throw new Error('The catalog has no elective hour requirement.');
  const done = new Set([...(student.completed ?? []), ...(student.in_progress ?? [])]);
  const mustKeep = [...new Set([...keep, ...(req.options ?? []).filter((c) => done.has(c))])];
  const sets = electiveSets(catalog, req, { keep: mustKeep, avoid });

  const scored = sets.map((picks) => ({ picks, ...trackFit(trackObj, picks, req.hours) }));
  const variableHours = (picks) => picks
    .filter((p) => hasVariableCredits(catalog.courses[p.course]))
    .reduce((sum, p) => sum + p.hours.reduce((x, y) => x + y, 0), 0);
  scored.sort((a, b) => b.fit - a.fit || variableHours(a.picks) - variableHours(b.picks) || a.picks.length - b.picks.length
    || a.picks.map((p) => p.course).join().localeCompare(b.picks.map((p) => p.course).join()));

  const plan = (choices) => planTerms({ catalog, offerings, student: { ...student, choices: { ...(student.choices ?? {}), [req.id]: choices } } });
  const msStart = (p) => p.milestones.find((m) => m.id === 'senior-design')?.start_term ?? p.milestones[0]?.start_term ?? null;
  const basePlan = plan([]);
  const baseline = {
    picks: basePlan.choices.find((c) => c.id === req.id)?.picks ?? [],
    graduation_term: basePlan.graduation_term,
    senior_design_start: msStart(basePlan),
  };

  const summer = !!student.options?.summer_allowed;
  const evaluated = scored.slice(0, Math.max(evaluate, limit)).map((s) => {
    const choices = s.picks.map((p) => (hasVariableCredits(catalog.courses[p.course]) ? { course: p.course, hours: p.hours } : { course: p.course }));
    const p = plan(choices);
    const grad = p.graduation_term;
    const sd = msStart(p);
    return {
      s, choices, grad, sd,
      delay: grad && baseline.graduation_term ? termDistance(baseline.graduation_term, grad, { summer }) : null,
      sdDelay: sd && baseline.senior_design_start ? termDistance(baseline.senior_design_start, sd, { summer }) : null,
      added: p.added_prereqs ?? [],
      unplaced: p.unplaced.map((u) => u.course),
    };
  });
  const big = 1e6;
  evaluated.sort((a, b) => (a.delay ?? big) - (b.delay ?? big)
    || (a.sdDelay ?? big) - (b.sdDelay ?? big)
    || b.s.fit - a.s.fit
    || a.added.length - b.added.length
    || variableHours(a.s.picks) - variableHours(b.s.picks)
    || a.s.picks.length - b.s.picks.length);

  const recommendations = evaluated.slice(0, limit).map((e, n) => {
    const picks = e.s.picks.map((p) => describePick(catalog, trackObj, p));
    const rec = {
      rank: n + 1,
      picks,
      choices: { [req.id]: e.choices },
      total_hours: picks.reduce((sum, p) => sum + p.total_hours, 0),
      fit: e.s.fit,
      fit_percent: Math.round(e.s.fit * 100),
      graduation_term: e.grad,
      graduation_label: e.grad ? termLabel(e.grad) : null,
      senior_design_start: e.sd,
      delay_terms: e.delay,
      added_prereqs: e.added,
      unplaced: e.unplaced,
    };
    rec.explanation = explanation(trackObj, picks, rec, baseline);
    return rec;
  });

  return {
    track: { id: trackObj.id, label: trackObj.label, description: trackObj.description ?? '' },
    requirement: { id: req.id, label: req.label ?? req.id, hours: req.hours },
    kept: mustKeep,
    avoided: [...avoid],
    baseline,
    considered: sets.length,
    planned: evaluated.length,
    recommendations,
  };
}
