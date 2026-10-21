// Turns the student's answers into the inputs the planning engine needs, and turns the engine's output into
// the plan the Results page shows. Everything here is a pure function, so it runs in Node tests as well as
// in the browser. The engine itself (web/engine) is imported unchanged through ./engine.js.

import { terms as T, prereqs as P, critical as C, planner as PL, timetable as TT } from './engine.js';

// ------------------------------------------------------------------ constants

export const CATALOG_YEAR = '2026-27';
export const ELECTIVE_REQUIREMENT = 'engr-elective';
export const ELECTIVE_COUNT = 3;
export const FIRST_TERM = '2026FA';
/** The earliest "current semester" the planner uses. The 2026-27 catalog starts in Fall 2026. */
const EARLIEST_CURRENT = '2026SP';

/** Credit load choices. `max` is the most hours the planner puts in one semester. */
export const LOADS = {
  light: { key: 'light', label: 'Light', range: '12 to 14 hours', max: 14 },
  standard: { key: 'standard', label: 'Standard', range: '15 to 17 hours', max: 17 },
  heavy: { key: 'heavy', label: 'Heavy', range: '18 hours', max: 18 },
};
export const LOAD_ORDER = ['light', 'standard', 'heavy'];

const SEMESTER_LABEL = { 0: 'fall', 1: 'spring' };
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];

export function emptyAnswers() {
  return {
    firstSemester: false,
    firstTerm: null,
    year: null,
    season: null,
    finished: [],
    taking: [],
    electives: [],
    electivesDone: [],
    load: 'standard',
    seededFor: null,
  };
}

// ---------------------------------------------------------------------- terms

/**
 * The student's current semester, from today's date. August through December is fall, and January through May is
 * spring. June and July count as preparation for the coming fall, so the current semester is the spring that just
 * ended and the next semester is fall. Never earlier than Spring 2026, so the plan never starts before Fall 2026.
 */
export function referenceTerm(today = new Date()) {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const term = month >= 8 ? `${year}FA` : `${year}SP`;
  return T.compareTerms(term, EARLIEST_CURRENT) < 0 ? EARLIEST_CURRENT : term;
}

/**
 * The two semesters a first-semester student can choose from: the two after the current semester.
 * The fall semester comes first and is the default.
 */
export function firstSemesterOptions(today = new Date()) {
  const next = T.nextTerm(referenceTerm(today), { summer: false });
  const later = T.nextTerm(next, { summer: false });
  const fall = T.seasonOf(next) === 'fall' ? next : later;
  const spring = fall === next ? later : next;
  return { terms: [fall, spring], default: fall };
}

/** The semester a first-semester student starts: their choice when it is still available, otherwise the default. */
export function firstTermFor(answers, today = new Date()) {
  const { terms, default: fall } = firstSemesterOptions(today);
  return terms.includes(answers.firstTerm) ? answers.firstTerm : fall;
}

/** The season of the student's current semester, from today's date. */
export function currentSeason(today = new Date()) {
  return T.seasonOf(referenceTerm(today));
}

/**
 * Set when the semester the student chose in step 1 is not the semester today's date puts them in.
 * Returns { season, label } for the semester we expect, or null when the answer fits.
 */
export function seasonMismatch(answers, today = new Date()) {
  if (answers.firstSemester || answers.season === null) return null;
  const current = referenceTerm(today);
  return T.seasonOf(current) === answers.season ? null : { season: T.seasonOf(current), term: current, label: T.termLabel(current) };
}

/**
 * The semester the student is in. A first-semester student has not started, so this is the semester they start.
 * Everyone else is in the semester today's date puts them in.
 */
export function currentTermFor(answers, today = new Date()) {
  return answers.firstSemester ? firstTermFor(answers, today) : referenceTerm(today);
}

/** The first semester the plan schedules: the chosen first semester, or the semester after the current one. */
export function planStartTerm(answers, today = new Date()) {
  const current = currentTermFor(answers, today);
  return answers.firstSemester ? current : T.nextTerm(current, { summer: false });
}

export function advance(term, count) {
  let t = term;
  for (let i = 0; i < count; i += 1) t = T.nextTerm(t, { summer: false });
  return t;
}

/** Position on the academic map: 3 per year (fall, spring, unused summer). */
export function mapPosition(answers) {
  if (answers.firstSemester) return 0;
  const year = Math.min(Math.max(answers.year ?? 1, 1), 5);
  return (year - 1) * 3 + (answers.season === 'spring' ? 1 : 0);
}

/**
 * The academic map position of the first semester the plan schedules. Courses the map places earlier than this
 * are catch-up courses, and the planner takes them as early as it can.
 */
export function startPosition(answers, today = new Date()) {
  if (answers.firstSemester) return T.seasonOf(firstTermFor(answers, today)) === 'spring' ? 1 : 0;
  const position = mapPosition(answers);
  return position + (answers.season === 'spring' ? 2 : 1);
}

export function positionLabel(position) {
  const year = Math.floor(position / 3);
  const season = SEMESTER_LABEL[position % 3] ?? 'summer';
  return `${ORDINAL[year] ?? `${year + 1}th`} year, ${season}`;
}

export function seedKey(answers) {
  return answers.firstSemester ? 'first' : `${answers.year}-${answers.season}`;
}

/** Whether the answers to step 1 are complete. */
export function hasPosition(answers) {
  return answers.firstSemester || (answers.year !== null && answers.season !== null);
}

export function seasonsText(seasons) {
  const list = ['fall', 'spring', 'summer'].filter((s) => seasons.includes?.(s) ?? seasons.has(s));
  if (list.length === 0) return 'No semester';
  const words = list.map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s));
  if (words.length === 1) return `${words[0]} only`;
  return words.join(' and ');
}

export function delayText(delta) {
  if (delta === 1) return 'one semester';
  if (delta === 2) return 'one year';
  if (delta === 3) return 'a year and a semester';
  if (delta === 4) return 'two years';
  return `${delta} semesters`;
}

/** Terms later than `from` by whole semesters (no summers), or null when a term is missing. */
export function semestersBetween(from, to) {
  if (!from || !to) return null;
  return T.termDistance(from, to, { summer: false });
}

// -------------------------------------------------------------------- catalog

export function electiveOptions(catalog) {
  return catalog.requirements.find((r) => r.id === ELECTIVE_REQUIREMENT)?.options ?? [];
}

/** Courses every student must take, in academic map order. The elective options are not included. */
export function requiredCourses(catalog) {
  const ids = catalog.requirements.filter((r) => r.type === 'all').flatMap((r) => r.courses);
  return [...new Set(ids)].sort(
    (a, b) => (P.suggestedPositionOf(catalog, a) ?? 99) - (P.suggestedPositionOf(catalog, b) ?? 99) || a.localeCompare(b),
  );
}

export function generalEducation(catalog) {
  return catalog.requirements
    .filter((r) => r.type === 'placeholder')
    .map((r) => ({ id: r.id, label: r.label, hours: r.hours, position: Math.max(...r.suggested_terms.map(T.parseSuggested)) }));
}

/** General education blocks the academic map places at or before the student's current semester. */
export function genEdDone(catalog, position) {
  return generalEducation(catalog).filter((g) => g.position <= position);
}

/** Checklist groups for step 2 and step 3: required courses by academic map semester. */
export function semesterGroups(catalog, ids = requiredCourses(catalog)) {
  const groups = new Map();
  for (const id of ids) {
    const pos = P.suggestedPositionOf(catalog, id) ?? 99;
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push(id);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, courses]) => ({ position, label: position === 99 ? 'Other courses' : positionLabel(position), courses }));
}

export function courseKind(catalog, id) {
  if ((catalog.milestones ?? []).some((m) => m.id === 'senior-design' && m.courses.includes(id))) return 'senior-design';
  if (electiveOptions(catalog).includes(id)) return 'elective';
  return 'core';
}

// -------------------------------------------------------------- default answers

/** Courses the map places before the student's current semester, and the ones it places in it. */
export function defaultsFor(catalog, answers) {
  const position = mapPosition(answers);
  const required = requiredCourses(catalog);
  const at = (id) => P.suggestedPositionOf(catalog, id) ?? 99;
  return {
    finished: closeFinished(catalog, required.filter((id) => at(id) < position)),
    taking: required.filter((id) => at(id) === position),
  };
}

/** Put the map's defaults into the answers when the student's position changes. */
export function seedAnswers(catalog, answers) {
  const key = seedKey(answers);
  if (answers.seededFor === key) return answers;
  const defaults = answers.firstSemester ? { finished: [], taking: [] } : defaultsFor(catalog, answers);
  return {
    ...answers,
    finished: defaults.finished,
    taking: answers.firstSemester ? [] : closeTaking(catalog, defaults.finished, defaults.taking, { hours: 9999 }),
    seededFor: key,
  };
}

// ------------------------------------------------------------ prerequisite math

/** Remove finished courses whose prerequisites are no longer finished. Returns { finished, removed }. */
export function closeFinished(catalog, finished) {
  const keep = new Set(finished);
  const removed = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...keep]) {
      const before = new Set([...keep].filter((x) => x !== id));
      const result = P.evaluatePrereqs(catalog.courses[id]?.prereqs ?? null, { before, same: keep });
      if (!result.ok) {
        keep.delete(id);
        removed.push(id);
        changed = true;
      }
    }
  }
  const list = [...finished].filter((id) => keep.has(id));
  return Object.assign(list, { removed });
}

export function finishedHours(catalog, completed, position) {
  let hours = 0;
  for (const id of completed) hours += catalog.courses[id]?.credits ?? 0;
  for (const g of genEdDone(catalog, position - 1)) hours += g.hours;
  return hours;
}

/**
 * Can the student take this course this semester?
 * Returns { ok, reasons } with plain-language reasons when not.
 */
export function canTakeNow(catalog, id, { finished, taking = [], hours = 0 }) {
  const def = catalog.courses[id];
  const reasons = [];
  const result = P.evaluatePrereqs(def.prereqs, { before: new Set(finished), same: new Set(taking) });
  if (!result.ok) reasons.push(`Needs ${result.missing.join(' and ')} first.`);
  if (def.standing) {
    const need = catalog.standing_hours?.[def.standing] ?? 0;
    if (hours < need) reasons.push(`Needs ${def.standing} standing (${need} credit hours finished).`);
  }
  return { ok: reasons.length === 0, reasons };
}

/** Remove "taking now" courses whose prerequisites are not finished or taken together. */
export function closeTaking(catalog, finished, taking, { hours = 9999 } = {}) {
  const keep = new Set(taking.filter((id) => !finished.includes(id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...keep]) {
      const others = [...keep].filter((x) => x !== id);
      if (!canTakeNow(catalog, id, { finished, taking: others, hours }).ok) {
        keep.delete(id);
        changed = true;
      }
    }
  }
  return taking.filter((id) => keep.has(id));
}

/**
 * The step 3 lists: the map's courses for this semester (some may be blocked), and other courses the student
 * could take this semester.
 */
export function takingChoices(catalog, offerings, answers, today = new Date()) {
  const position = mapPosition(answers);
  const current = currentTermFor(answers, today);
  const season = T.seasonOf(current);
  const hours = finishedHours(catalog, answers.finished, position);
  const finished = new Set(answers.finished);
  const required = requiredCourses(catalog);
  const at = (id) => P.suggestedPositionOf(catalog, id) ?? 99;
  const opts = { finished: answers.finished, taking: answers.taking, hours };

  const onMap = required.filter((id) => !finished.has(id) && at(id) === position)
    .map((id) => ({ id, ...canTakeNow(catalog, id, opts) }));
  const more = required.filter((id) => {
    if (finished.has(id) || at(id) === position) return false;
    const def = catalog.courses[id];
    if (def.available_from && T.compareTerms(def.available_from, current) > 0) return false;
    if (!P.effectiveSeasons(catalog, id, offerings).seasons.has(season)) return false;
    return canTakeNow(catalog, id, opts).ok;
  }).map((id) => ({ id, ok: true, reasons: [] }));
  return { onMap, more, current, hours };
}

// ----------------------------------------------------------------- electives

/** Plain-language sentences for a prerequisite expression. */
export function prereqSentences(expr) {
  const norm = P.normalizePrereqs(expr);
  if (!norm) return [];
  const label = (leaf) => (leaf.min_grade ? `${leaf.course} (grade of ${leaf.min_grade} or better)` : leaf.course);
  const join = (items) => (items.length <= 1 ? items.join('') : items.length === 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`);
  const orJoin = (items) => (items.length <= 1 ? items.join('') : items.length === 2 ? items.join(' or ') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`);
  const sentences = [];
  const strict = [];
  const together = [];
  const walk = (node, top) => {
    if (node.type === 'course') {
      (node.concurrent_ok ? together : strict).push(node);
    } else if (node.type === 'all') {
      node.items.forEach((item) => walk(item, top));
    } else {
      const names = node.items.map((i) => (i.type === 'course' ? label(i) : '(a group of courses)'));
      sentences.push(`Take one of these first: ${orJoin(names)}.`);
    }
  };
  walk(norm, true);
  if (strict.length) sentences.unshift(`Take ${join(strict.map(label))} first.`);
  for (const leaf of together) sentences.push(`${label(leaf)} can be taken the same semester.`);
  return sentences;
}

const DESCRIPTIONS = {
  'ENGR 3915': 'Learn to plan an engineering project, keep it on schedule, and work well with a team.',
  'ENGR 3970': 'Compare the costs and benefits of engineering choices, such as which design is worth building.',
  'ENGR 4550': 'Study how robot arms and mobile robots move, sense their surroundings, and follow commands.',
  'ENGR 4560': 'Write programs for the small computers built into machines, sensors, and smart devices.',
  'ENGR 4540': 'Study how heat and energy move through engines, power systems, and machines.',
  'ENGR 4570': 'Use cameras and artificial intelligence so machines can see, inspect parts, and guide automation.',
  'ENGR 4600': 'Earn credit for engineering work experience with an employer.',
  'ENGR 4610': 'Join a faculty research project and earn credit for the work.',
};

export const ELECTIVE_GROUPS = [
  { id: 'systems', label: 'Systems Engineering & Management', blurb: 'For students headed toward leading projects and teams.', courses: ['ENGR 3915', 'ENGR 3970'] },
  { id: 'robotics', label: 'Robotics & Embedded Systems', blurb: 'For students headed toward robots, controllers, and smart devices.', courses: ['ENGR 4550', 'ENGR 4560'] },
  { id: 'advanced', label: 'Advanced Study', blurb: 'For students headed toward graduate school or specialized technical work.', courses: ['ENGR 4540', 'ENGR 4570'] },
  { id: 'internship', label: 'Internship & Research', blurb: 'For students who want real-world or lab experience for credit.', courses: ['ENGR 4600', 'ENGR 4610'] },
];

export function electiveDescription(id) {
  return DESCRIPTIONS[id] ?? '';
}

/** The set of courses the engine treats as finished: finished, taking now, finished electives, and general education the map covers. */
export function completedIds(catalog, answers) {
  const position = mapPosition(answers);
  const gen = answers.firstSemester ? [] : genEdDone(catalog, position).map((g) => g.id);
  return [...new Set([...answers.finished, ...answers.taking, ...answers.electivesDone, ...gen])];
}

export function engineStudent(catalog, answers, loadKey, today = new Date(), extra = {}) {
  const load = LOADS[loadKey ?? answers.load] ?? LOADS.standard;
  const chosen = [...new Set([...answers.electivesDone, ...answers.electives])];
  return {
    start_term: planStartTerm(answers, today),
    start_position: startPosition(answers, today),
    completed: completedIds(catalog, answers),
    in_progress: [],
    choices: { [ELECTIVE_REQUIREMENT]: chosen },
    options: { max_credits: load.max, summer_allowed: false, ...extra },
  };
}

/**
 * Information for each elective card: what it needs, when it runs, and when this student can first take it.
 */
export function electiveCards(catalog, offerings, answers, today = new Date()) {
  const student = engineStudent(catalog, answers, answers.load, today);
  const start = student.start_term;
  const analysis = C.analyzeCriticalPath({ catalog, offerings, student });
  const completed = new Set(student.completed);
  const hours = finishedHours(catalog, [...completed].filter((id) => catalog.courses[id]), mapPosition(answers) + 1);
  return electiveOptions(catalog).map((id) => {
    const def = catalog.courses[id];
    const info = analysis.courses[id];
    const seasons = [...P.effectiveSeasons(catalog, id, offerings).seasons];
    const earliest = info.earliest_term;
    const reasons = [];
    const missing = P.evaluatePrereqs(def.prereqs, { before: completed });
    if (!missing.ok) reasons.push(`Finish ${missing.missing.join(' and ')} first.`);
    if (def.standing) {
      const need = catalog.standing_hours?.[def.standing] ?? 0;
      if (hours < need) reasons.push(`It needs ${def.standing} standing (${need} credit hours finished).`);
    }
    if (def.available_from && T.compareTerms(def.available_from, start) > 0) {
      reasons.push(`It is first offered in ${T.termLabel(def.available_from)}.`);
    }
    const now = earliest === start;
    if (!now && reasons.length === 0) reasons.push(`It runs in ${seasonsText(seasons).toLowerCase()}.`);
    return {
      id,
      title: def.title,
      credits: def.credits,
      description: electiveDescription(id),
      seasons,
      requires: prereqSentences(def.prereqs),
      standing: def.standing,
      earliest,
      canTakeNow: now,
      reasons: now ? [] : reasons,
      done: answers.electivesDone.includes(id),
    };
  });
}

// ------------------------------------------------------------------- the plan

function termOrdinal(plan, term) {
  return plan.terms.findIndex((t) => t.term === term);
}

/** The semester the academic map would have the student start senior design and graduate. */
export function mapPace(answers, today = new Date()) {
  // A first semester that starts in spring begins mid-year on the map, so there is no fixed pace to compare with.
  if (answers.firstSemester && T.seasonOf(firstTermFor(answers, today)) === 'spring') return null;
  const position = mapPosition(answers);
  const semester = Math.floor(position / 3) * 2 + (position % 3);
  if (semester > 7) return null;
  const current = currentTermFor(answers, today);
  return { seniorDesignStart: advance(current, 6 - semester), graduation: advance(current, 7 - semester) };
}

/** Run the planner for the answers and one credit load. */
export function runPlan(catalog, offerings, answers, loadKey, today = new Date()) {
  const student = engineStudent(catalog, answers, loadKey, today);
  return { raw: PL.planTerms({ catalog, offerings, student }), student };
}

function lastCourseTerm(raw) {
  return raw.last_course_term;
}

function shape(catalog, raw, answers, load, today) {
  const sd = raw.milestones.find((m) => m.id === 'senior-design') ?? null;
  const last = lastCourseTerm(raw);
  const lastOrdinal = last ? termOrdinal(raw, last) : -1;
  const planned = raw.terms.slice(0, lastOrdinal + 1).map((t) => {
    const courses = t.courses.map((c) => ({
      course: c.course, title: c.title, credits: c.credits, critical: c.critical, kind: courseKind(catalog, c.course),
    }));
    courses.sort((a, b) => (P.suggestedPositionOf(catalog, a.course) ?? 99) - (P.suggestedPositionOf(catalog, b.course) ?? 99) || a.course.localeCompare(b.course));
    const hours = courses.reduce((sum, c) => sum + c.credits, 0);
    return { term: t.term, label: t.label, season: t.season, courses, hours, capacity: t.capacity, open: Math.max(0, t.capacity - hours) };
  });
  return { sd, planned, last };
}

/** Hours of general education the plan has room for, compared with what the student still needs. */
export function generalEducationRoom(catalog, answers, planned) {
  const position = mapPosition(answers);
  const done = answers.firstSemester ? [] : genEdDone(catalog, position);
  const doneIds = new Set(done.map((g) => g.id));
  const remaining = generalEducation(catalog).filter((g) => !doneIds.has(g.id)).reduce((sum, g) => sum + g.hours, 0);
  const open = planned.reduce((sum, t) => sum + t.open, 0);
  return { remaining, open, shortfall: Math.max(0, remaining - open), doneHours: done.reduce((sum, g) => sum + g.hours, 0) };
}

function plainReason(reason) {
  if (!reason) return 'No semester works for its prerequisites and the semesters it runs.';
  if (reason.startsWith('Blocked:')) return 'It needs a course that also has no open semester.';
  return 'No semester works for its prerequisites and the semesters it runs.';
}

function slipAlerts(catalog, offerings, answers, loadKey, today, base, shapedBase) {
  const alerts = [];
  const raw = base.raw;
  const baseSd = shapedBase.sd?.start_term ?? null;
  const baseGrad = shapedBase.last;
  const candidates = raw.analysis.critical.filter((id) => raw.placements[id] && catalog.courses[id]);
  for (const id of candidates) {
    const placed = raw.placements[id];
    const copy = JSON.parse(JSON.stringify(catalog));
    copy.courses[id].available_from = T.nextTerm(placed, { summer: false });
    let slipped;
    try {
      slipped = PL.planTerms({ catalog: copy, offerings, student: engineStudent(catalog, answers, loadKey, today) });
    } catch {
      continue;
    }
    const sd = slipped.milestones.find((m) => m.id === 'senior-design')?.start_term ?? null;
    const grad = slipped.last_course_term;
    const sdDelay = semestersBetween(baseSd, sd);
    const gradDelay = semestersBetween(baseGrad, grad);
    if (slipped.unplaced.length) continue;
    if (sdDelay !== null && sdDelay >= 2) {
      alerts.push({ order: T.termIndex(placed), course: id, severity: 'warn', text: `${id} must be taken by ${T.termLabel(placed)}, or senior design moves to ${T.termLabel(sd)}.` });
    } else if (gradDelay !== null && gradDelay >= 2) {
      alerts.push({ order: T.termIndex(placed), course: id, severity: 'warn', text: `${id} must be taken by ${T.termLabel(placed)}, or graduation moves to ${T.termLabel(grad)}.` });
    }
  }
  alerts.sort((a, b) => a.order - b.order || a.course.localeCompare(b.course));
  return alerts.slice(0, 5);
}

/**
 * Everything the Results page needs for one set of answers.
 * `loadKey` defaults to the load the student chose.
 */
export function computeResult(catalog, offerings, answers, { loadKey = answers.load, today = new Date(), withSlips = true } = {}) {
  const load = LOADS[loadKey] ?? LOADS.standard;
  const base = runPlan(catalog, offerings, answers, loadKey, today);
  const raw = base.raw;
  const shaped = shape(catalog, raw, answers, load, today);
  const currentTerm = currentTermFor(answers, today);
  const startTerm = planStartTerm(answers, today);
  const unplaced = raw.unplaced;
  const graduation = unplaced.length ? null : shaped.last;
  const sd = shaped.sd;
  const position = mapPosition(answers);
  const pace = mapPace(answers, today);

  const inProgress = answers.firstSemester || answers.taking.length === 0 ? null : {
    term: currentTerm,
    label: T.termLabel(currentTerm),
    courses: answers.taking.map((id) => ({
      course: id, title: catalog.courses[id].title, credits: catalog.courses[id].credits, critical: false, kind: courseKind(catalog, id),
    })),
  };
  if (inProgress) {
    inProgress.hours = inProgress.courses.reduce((sum, c) => sum + c.credits, 0);
    inProgress.capacity = load.max;
    inProgress.open = Math.max(0, load.max - inProgress.hours);
  }

  const genEd = generalEducationRoom(catalog, answers, shaped.planned);
  const alerts = [];

  // Unplaced courses
  for (const u of unplaced) {
    alerts.push({ severity: 'bad', course: u.course, text: `We could not find a semester for ${u.course}. ${plainReason(u.reason)}` });
  }

  // Later than the map
  const sdDelay = pace && sd?.start_term ? semestersBetween(pace.seniorDesignStart, sd.start_term) : null;
  const gradDelay = pace && graduation ? semestersBetween(pace.graduation, graduation) : null;
  let behind = [];
  if (pace && ((sdDelay ?? 0) > 0 || (gradDelay ?? 0) > 0)) {
    const defaults = answers.firstSemester ? { finished: [], taking: [] } : defaultsFor(catalog, answers);
    const have = new Set([...answers.finished, ...answers.taking]);
    behind = [...defaults.finished, ...defaults.taking].filter((id) => !have.has(id));
    const behindSet = new Set(behind);
    const roots = behind.filter((id) => P.prereqCourses(catalog.courses[id].prereqs).every((p) => !behindSet.has(p)));
    const chain = (raw.drivers.milestones['senior-design'] ?? []).map((s) => s.course);
    const onChain = roots.filter((id) => chain.includes(id));
    const named = onChain.length ? onChain : roots.length ? roots : behind;
    const parts = [];
    if ((sdDelay ?? 0) > 0) parts.push(`Senior design starts in ${T.termLabel(sd.start_term)}, ${delayText(sdDelay)} after the academic map's ${T.termLabel(pace.seniorDesignStart)}.`);
    if ((gradDelay ?? 0) > 0) parts.push(`You graduate in ${T.termLabel(graduation)}, ${delayText(gradDelay)} after the map's ${T.termLabel(pace.graduation)}.`);
    if (named.length) {
      const names = named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
      alerts.push({
        severity: 'bad', course: named[0], courses: named,
        text: `${names} ${named.length === 1 ? 'is' : 'are'} holding up your plan. ${parts.join(' ')} Take ${named.length === 1 ? 'it' : 'them'} as soon as ${named.length === 1 ? 'it is' : 'they are'} offered.`,
      });
    } else {
      alerts.push({
        severity: 'bad',
        text: `${parts.join(' ')} A credit load of up to ${load.max} hours a semester adds time. A heavier load can bring the dates back.`,
      });
    }
  }

  // Courses that must not slip
  if (withSlips && !unplaced.length) {
    for (const a of slipAlerts(catalog, offerings, answers, loadKey, today, base, shaped)) alerts.push(a);
  }

  // Electives that are not offered yet
  for (const id of [...new Set([...answers.electivesDone, ...answers.electives])]) {
    const def = catalog.courses[id];
    if (def?.available_from && T.compareTerms(def.available_from, startTerm) > 0 && !answers.electivesDone.includes(id)) {
      alerts.push({ severity: 'info', course: id, text: `${id} is first offered in ${T.termLabel(def.available_from)}.` });
    }
  }

  // General education
  if (genEd.shortfall > 0 && graduation) {
    const advice = loadKey === 'heavy' ? 'Add a summer course to fit the rest.' : 'Add a summer course or choose a heavier semester to fit the rest.';
    alerts.push({
      severity: 'warn',
      text: `You still need ${genEd.remaining} hours of general education, but your plan has ${genEd.open} open hours before graduation. ${advice}`,
    });
  }

  // The plan matches the academic map when every remaining course sits in its map semester for this student.
  const matchesMap = !unplaced.length && (raw.off_map ?? []).length === 0;

  let status = 'on-track';
  if (alerts.some((a) => a.severity === 'warn' && !a.course) || unplaced.length) status = 'attention';
  if (((sdDelay ?? 0) > 0) || ((gradDelay ?? 0) > 0)) status = 'delayed';
  if (unplaced.length) status = 'attention';

  return {
    loadKey, load, student: base.student, raw,
    currentTerm, startTerm, position, pace,
    inProgress,
    terms: shaped.planned,
    graduation,
    graduationLabel: graduation ? T.termLabel(graduation) : null,
    seniorDesign: sd && sd.start_term ? {
      start: sd.start_term, end: sd.end_term,
      startLabel: T.termLabel(sd.start_term), endLabel: T.termLabel(sd.end_term),
    } : null,
    electives: [...new Set([...answers.electivesDone, ...answers.electives])],
    genEd, alerts, status, unplaced, behind,
    sdDelay, gradDelay, matchesMap, offMap: raw.off_map ?? [],
  };
}

/** Compare the three credit loads for step 5. */
export function compareLoads(catalog, offerings, answers, today = new Date()) {
  return LOAD_ORDER.map((key) => {
    const result = computeResult(catalog, offerings, answers, { loadKey: key, today, withSlips: false });
    return {
      key, load: LOADS[key],
      graduation: result.graduation, graduationLabel: result.graduationLabel,
      seniorDesign: result.seniorDesign, unplaced: result.unplaced,
    };
  });
}

// ------------------------------------------------------------ class times

/** The terms to try for class times: the planned term first, then the same season in earlier years. */
export function scheduleCandidates(term) {
  const year = Number(term.slice(0, 4));
  const code = term.slice(4);
  return [term, ...[1, 2, 3, 4].map((back) => `${year - back}${code}`)];
}

/** Pick section combinations for one planned semester from a schedule file. */
export function classTimes(catalog, result, term, schedule) {
  return TT_termTimetable(catalog, result.raw, term, schedule);
}

function TT_termTimetable(catalog, raw, term, schedule) {
  const planned = raw.terms.find((t) => t.term === term);
  const courses = planned ? planned.courses.map((c) => c.course) : [];
  const out = TT.planTimetables({
    courses, catalog, schedule, limit: 8,
    movable: TT.movableFromAnalysis(raw.analysis, term),
  });
  const pairs = out.available ? TT.incompatiblePairs({ courses, catalog, schedule }) : [];
  return { term, courses, ...out, pairs };
}
