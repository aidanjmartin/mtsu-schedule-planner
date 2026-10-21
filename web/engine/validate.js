// Validation: catalog structure, prerequisite cycles, unknown courses, unsatisfiable requirements,
// and a prerequisite check for any course-to-term placement (including the academic map's suggested schedule).

import { isSuggested, parseSuggested } from './terms.js';
import {
  normalizePrereqs, evaluatePrereqs, resolveRequirements, courseRequirementMap, creditRange, minCredits, isRepeatable, isChoice,
} from './prereqs.js';

const STANDING_LEVELS = ['sophomore', 'junior', 'senior'];

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

/** Leaves of an expression with a flag for leaves that sit inside an any-group. */
function leavesWithOptional(node, inAny = false, out = []) {
  if (!node) return out;
  if (node.type === 'course') out.push({ course: node.course, concurrent: node.concurrent_ok, optional: inAny });
  else node.items.forEach((child) => leavesWithOptional(child, inAny || node.type === 'any', out));
  return out;
}

/** Strongly connected groups of the prerequisite graph (Tarjan). */
function findCycles(edges) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const groups = [];
  let counter = 0;
  const connect = (v) => {
    index.set(v, counter); low.set(v, counter); counter += 1;
    stack.push(v); onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w.to)) {
        connect(w.to);
        low.set(v, Math.min(low.get(v), low.get(w.to)));
      } else if (onStack.has(w.to)) {
        low.set(v, Math.min(low.get(v), index.get(w.to)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const group = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); group.push(w); } while (w !== v);
      const selfLoop = (edges.get(v) ?? []).some((e) => e.to === v);
      if (group.length > 1 || selfLoop) groups.push(group);
    }
  };
  for (const v of edges.keys()) if (!index.has(v)) connect(v);
  return groups;
}

/** Check a choose_hours requirement: known options, a positive total, sensible limits, and a way to reach the total. */
function checkChooseHours(req, courses, errors) {
  if (!(Number.isInteger(req.hours) && req.hours > 0)) {
    errors.push(issue('unsatisfiable_requirement', `Requirement "${req.id}" needs a whole number of hours above 0.`));
    return;
  }
  const options = req.options ?? [];
  for (const c of options) {
    if (!courses[c]) errors.push(issue('unknown_course', `Requirement "${req.id}" lists the option ${c}, which is not in the catalog.`, { ref: c }));
  }
  const known = options.filter((c) => courses[c]);
  if (req.suggested_term && !isSuggested(req.suggested_term)) {
    errors.push(issue('bad_suggested_term', `Requirement "${req.id}" has the suggested term "${req.suggested_term}".`));
  }
  for (const c of req.defaults ?? []) {
    if (!options.includes(c)) errors.push(issue('bad_default', `Requirement "${req.id}" lists the default ${c}, which is not one of its options.`, { ref: c }));
  }
  const limits = req.limits ?? [];
  for (const limit of limits) {
    if (!(Number.isInteger(limit.max_hours) && limit.max_hours >= 0)) {
      errors.push(issue('bad_limit', `A limit in requirement "${req.id}" needs max_hours of 0 or more.`));
    }
    for (const c of limit.courses ?? []) {
      if (!options.includes(c)) errors.push(issue('bad_limit', `A limit in requirement "${req.id}" lists ${c}, which is not one of its options.`, { ref: c }));
    }
  }
  // Can some mix of options add up to exactly the required hours, inside every limit? Search over whole-hour choices.
  const rules = limits.map((l) => ({ courses: new Set(l.courses ?? []), max: l.max_hours }));
  const reachable = new Set([JSON.stringify([0, ...rules.map(() => 0)])]);
  for (const c of known) {
    const { min, max } = creditRange(courses[c]);
    const sizes = []; for (let h = min; h <= max; h += 1) sizes.push(h);
    const times = isRepeatable(courses[c]) ? Math.ceil(req.hours / min) : 1;
    for (let round = 0; round < times; round += 1) {
      for (const state of [...reachable]) {
        const [total, ...used] = JSON.parse(state);
        for (const h of sizes) {
          if (total + h > req.hours) continue;
          const next = used.map((u, i) => u + (rules[i].courses.has(c) ? h : 0));
          if (next.some((u, i) => u > rules[i].max)) continue;
          reachable.add(JSON.stringify([total + h, ...next]));
        }
      }
    }
  }
  if (![...reachable].some((state) => JSON.parse(state)[0] === req.hours)) {
    errors.push(issue('unsatisfiable_requirement', `Requirement "${req.id}" asks for ${req.hours} hours, but no mix of its options adds up to that inside its limits.`));
  }
}

/**
 * Check a catalog file against the rules in DATA_FORMAT.md.
 * Returns { errors, warnings, checks }. `checks` lists every note that starts with "CHECK:".
 */
export function validateCatalog(catalog) {
  const errors = [];
  const warnings = [];
  const courses = catalog.courses ?? {};
  const ids = Object.keys(courses);

  if (!catalog.catalog_year) errors.push(issue('missing_field', 'The catalog needs a catalog_year.'));
  if (!Number.isFinite(catalog.total_hours)) errors.push(issue('missing_field', 'The catalog needs total_hours.'));
  if (!catalog.standing_hours) errors.push(issue('missing_field', 'The catalog needs standing_hours.'));

  // Per-course fields and prerequisites
  const edges = new Map(ids.map((id) => [id, []]));
  for (const id of ids) {
    const def = courses[id];
    if (!/^[A-Z]{2,5} \d{4}[A-Z]?$/.test(id)) {
      warnings.push(issue('course_id_format', `"${id}" does not look like a course id such as "ENGR 3540".`, { course: id }));
    }
    if (typeof def.title !== 'string' || !def.title) errors.push(issue('missing_field', `${id} needs a title.`, { course: id }));
    const range = def.credits;
    if (range && typeof range === 'object') {
      const whole = (n) => Number.isInteger(n) && n > 0;
      if (!(whole(range.min) && whole(range.max) && range.min <= range.max)) {
        errors.push(issue('bad_credits', `${id} needs credits like { "min": 1, "max": 3 }, with whole numbers and min no larger than max.`, { course: id }));
      }
    } else if (!(typeof range === 'number' && range > 0)) {
      errors.push(issue('bad_credits', `${id} needs a positive number of credits.`, { course: id }));
    }
    if (def.repeatable !== undefined && typeof def.repeatable !== 'boolean') {
      errors.push(issue('bad_field', `${id} has a repeatable value that is not true or false.`, { course: id }));
    }
    if (def.first_semester !== undefined && typeof def.first_semester !== 'boolean') {
      errors.push(issue('bad_field', `${id} has a first_semester value that is not true or false.`, { course: id }));
    }
    if (!Array.isArray(def.components) || def.components.length === 0) {
      errors.push(issue('missing_components', `${id} needs at least one component.`, { course: id }));
    } else if (!def.components.includes(id)) {
      warnings.push(issue('components_without_course', `${id} does not list itself as a component.`, { course: id }));
    }
    if (def.suggested_term !== null && def.suggested_term !== undefined && !isSuggested(def.suggested_term)) {
      errors.push(issue('bad_suggested_term', `${id} has the suggested term "${def.suggested_term}". Use a form like junior-fall.`, { course: id }));
    }
    if (def.standing !== null && def.standing !== undefined) {
      if (!STANDING_LEVELS.includes(def.standing)) {
        errors.push(issue('bad_standing', `${id} has the standing "${def.standing}". Use null, sophomore, junior, or senior.`, { course: id }));
      } else if (!(catalog.standing_hours && def.standing in catalog.standing_hours)) {
        errors.push(issue('bad_standing', `${id} needs ${def.standing} standing, but standing_hours has no ${def.standing} entry.`, { course: id }));
      }
    }
    let norm = null;
    try {
      norm = normalizePrereqs(def.prereqs);
    } catch (e) {
      errors.push(issue('bad_prereq', `${id}: ${e.message}`, { course: id }));
    }
    for (const leaf of leavesWithOptional(norm)) {
      if (!courses[leaf.course]) {
        errors.push(issue('unknown_course', `${id} lists the prerequisite ${leaf.course}, which is not in the catalog.`, { course: id, ref: leaf.course }));
      } else {
        edges.get(id).push({ to: leaf.course, concurrent: leaf.concurrent, optional: leaf.optional });
      }
    }
  }

  // Cycles. First look at links every student must follow (not inside an any-of choice).
  // A loop there is an error, unless every link allows taking the courses together.
  // Then look at all links: a loop that exists only through an any-of choice is a warning to check.
  const hardEdges = new Map(ids.map((id) => [id, edges.get(id).filter((e) => !e.optional)]));
  const hardGroups = findCycles(hardEdges);
  for (const group of hardGroups) {
    const inside = new Set(group);
    const internal = group.flatMap((v) => hardEdges.get(v).filter((e) => inside.has(e.to)));
    const text = group.join(', ');
    if (internal.every((e) => e.concurrent)) {
      warnings.push(issue('concurrent_cycle', `These courses require each other, but every link allows taking them together: ${text}.`, { courses: group }));
    } else {
      errors.push(issue('cycle', `Prerequisite cycle: ${text}.`, { courses: group }));
    }
  }
  const reported = new Set(hardGroups.map((g) => [...g].sort().join('|')));
  for (const group of findCycles(edges)) {
    if (reported.has([...group].sort().join('|'))) continue;
    if (hardGroups.some((g) => g.every((v) => group.includes(v)) && g.length === group.length)) continue;
    warnings.push(issue('possible_cycle', `These courses may require each other through an any-of choice: ${group.join(', ')}. Check that another alternative breaks the loop.`, { courses: group }));
  }

  // Milestones
  for (const m of catalog.milestones ?? []) {
    for (const c of m.courses ?? []) {
      if (!courses[c]) errors.push(issue('unknown_course', `Milestone "${m.id}" lists ${c}, which is not in the catalog.`, { ref: c }));
    }
  }

  // Requirements
  const seenIds = new Set();
  let hoursLow = 0;
  let hoursHigh = 0;
  for (const req of catalog.requirements ?? []) {
    if (seenIds.has(req.id)) errors.push(issue('duplicate_requirement', `The requirement id "${req.id}" appears twice.`));
    seenIds.add(req.id);
    if (req.type === 'all') {
      if (!req.courses?.length) errors.push(issue('unsatisfiable_requirement', `Requirement "${req.id}" lists no courses.`));
      for (const c of req.courses ?? []) {
        if (!courses[c]) errors.push(issue('unknown_course', `Requirement "${req.id}" lists ${c}, which is not in the catalog.`, { ref: c }));
        else { hoursLow += minCredits(courses[c]); hoursHigh += creditRange(courses[c]).max; }
      }
    } else if (req.type === 'choose') {
      const known = (req.options ?? []).filter((c) => courses[c]);
      for (const c of req.options ?? []) {
        if (!courses[c]) errors.push(issue('unknown_course', `Requirement "${req.id}" lists the option ${c}, which is not in the catalog.`, { ref: c }));
      }
      if (!(Number.isInteger(req.count) && req.count >= 1)) {
        errors.push(issue('unsatisfiable_requirement', `Requirement "${req.id}" needs a count of at least 1.`));
      } else if (known.length < req.count) {
        errors.push(issue('unsatisfiable_requirement', `Requirement "${req.id}" asks for ${req.count} course(s) but only ${known.length} known option(s) exist, so no student can satisfy it.`));
      } else {
        const credits = known.map((c) => minCredits(courses[c])).sort((a, b) => a - b);
        hoursLow += credits.slice(0, req.count).reduce((a, b) => a + b, 0);
        hoursHigh += credits.slice(-req.count).reduce((a, b) => a + b, 0);
      }
      if (req.suggested_term && !isSuggested(req.suggested_term)) {
        errors.push(issue('bad_suggested_term', `Requirement "${req.id}" has the suggested term "${req.suggested_term}".`));
      }
    } else if (req.type === 'choose_hours') {
      checkChooseHours(req, courses, errors);
      if (Number.isFinite(req.hours) && req.hours > 0) { hoursLow += req.hours; hoursHigh += req.hours; }
    } else if (req.type === 'placeholder') {
      if (!(typeof req.hours === 'number' && req.hours > 0)) {
        errors.push(issue('unsatisfiable_requirement', `Placeholder "${req.id}" needs a positive number of hours.`));
      } else { hoursLow += req.hours; hoursHigh += req.hours; }
      for (const t of req.suggested_terms ?? []) {
        if (!isSuggested(t)) errors.push(issue('bad_suggested_term', `Placeholder "${req.id}" has the suggested term "${t}".`));
      }
    } else {
      errors.push(issue('bad_requirement', `Requirement "${req.id}" has the unknown type "${req.type}".`));
    }
  }

  // Each course appears in exactly one requirement
  const owners = courseRequirementMap(catalog);
  for (const id of ids) {
    const list = owners.get(id) ?? [];
    if (list.length === 0) errors.push(issue('no_requirement', `${id} does not appear in any requirement.`, { course: id }));
    if (list.length > 1) errors.push(issue('many_requirements', `${id} appears in more than one requirement: ${list.join(', ')}.`, { course: id }));
  }

  if (Number.isFinite(catalog.total_hours) && hoursLow > 0 && (catalog.total_hours < hoursLow || catalog.total_hours > hoursHigh)) {
    const range = hoursLow === hoursHigh ? `${hoursLow}` : `${hoursLow} to ${hoursHigh}`;
    warnings.push(issue('total_hours', `total_hours is ${catalog.total_hours}, but the requirements add up to ${range} hours.`));
  }

  const checks = ids
    .filter((id) => typeof courses[id].notes === 'string' && courses[id].notes.startsWith('CHECK:'))
    .map((id) => ({ course: id, note: courses[id].notes }));

  return { errors, warnings, checks };
}

// ------------------------------------------------------------ placement check

/**
 * The academic map as a placement: course -> position (year * 3 + season).
 * Courses in a "choose" requirement without a suggested term of their own use the requirement's term.
 * `counted` lists the courses whose hours count toward standing: required courses and the default picks.
 */
export function suggestedPlacement(catalog) {
  const placement = {};
  const counted = new Set();
  const { required } = resolveRequirements(catalog, {});
  for (const [id, def] of Object.entries(catalog.courses)) {
    if (def.suggested_term) placement[id] = parseSuggested(def.suggested_term);
  }
  for (const req of catalog.requirements ?? []) {
    if (isChoice(req)) {
      for (const id of req.options ?? []) {
        if (placement[id] === undefined && req.suggested_term) placement[id] = parseSuggested(req.suggested_term);
      }
    }
  }
  for (const id of required) counted.add(id);
  return { placement, counted };
}

/**
 * Check a placement (course -> position number) against prerequisites and standing hours.
 * A strict prerequisite must sit in an earlier position. A concurrent prerequisite may share the position.
 * Returns an array of violations; an empty array means the placement is valid.
 */
export function checkPlacement(catalog, placement, { counted = null } = {}) {
  const violations = [];
  const placeholderChunks = [];
  for (const req of catalog.requirements ?? []) {
    if (req.type !== 'placeholder') continue;
    const terms = req.suggested_terms ?? [];
    terms.forEach((t, n) => {
      const base = Math.floor(req.hours / terms.length);
      placeholderChunks.push({ pos: parseSuggested(t), hours: base + (n < req.hours % terms.length ? 1 : 0) });
    });
  }
  for (const [id, pos] of Object.entries(placement)) {
    const def = catalog.courses[id];
    if (!def) {
      violations.push({ kind: 'unknown_course', course: id, message: `${id} is not in the catalog.` });
      continue;
    }
    const before = new Set();
    const same = new Set();
    for (const [other, p] of Object.entries(placement)) {
      if (p < pos) before.add(other);
      else if (p === pos && other !== id) same.add(other);
    }
    const result = evaluatePrereqs(def.prereqs, { before, same });
    if (!result.ok) {
      violations.push({
        kind: 'prerequisite', course: id, position: pos,
        message: `${id} needs ${result.missing.join('; ')} in an earlier term.`,
      });
    }
    if (def.standing) {
      const need = catalog.standing_hours?.[def.standing] ?? 0;
      let hours = 0;
      for (const [other, p] of Object.entries(placement)) {
        if (p < pos && (!counted || counted.has(other))) hours += minCredits(catalog.courses[other]) ?? 0;
      }
      for (const chunk of placeholderChunks) if (chunk.pos < pos) hours += chunk.hours;
      if (hours < need) {
        violations.push({
          kind: 'standing', course: id, position: pos,
          message: `${id} needs ${def.standing} standing (${need} hours), but only ${hours} hours come before it.`,
        });
      }
    }
  }
  return violations;
}

/** Acceptance check 2: does the academic map's own schedule pass the prerequisite check? */
export function checkSuggestedSchedule(catalog) {
  const { placement, counted } = suggestedPlacement(catalog);
  return checkPlacement(catalog, placement, { counted });
}

// ------------------------------------------------------------ schedule check

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Basic shape check for a schedule file. Returns an array of problem messages. */
export function validateSchedule(schedule) {
  const problems = [];
  if (!schedule || !Array.isArray(schedule.sections)) return ['The schedule needs a sections list.'];
  for (const s of schedule.sections) {
    const label = `${s.course ?? '?'} section ${s.section ?? '?'} (CRN ${s.crn ?? '?'})`;
    if (!s.course) problems.push(`${label} has no course.`);
    for (const m of s.meetings ?? []) {
      if (!/^[MTWRFSU]+$/.test(m.days ?? '')) problems.push(`${label} has the days "${m.days}". Use the letters M, T, W, R, F, S, U.`);
      if (!TIME.test(m.start ?? '') || !TIME.test(m.end ?? '')) problems.push(`${label} has a time that is not 24-hour HH:MM.`);
      else if (m.end <= m.start) problems.push(`${label} ends before it starts.`);
    }
  }
  return problems;
}
