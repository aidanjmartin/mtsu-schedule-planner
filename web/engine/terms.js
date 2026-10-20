// Term helpers. A term id is a four-digit year plus FA, SP, or SU: 2026FA, 2027SP, 2027SU.
// Terms run in this order inside one academic year: fall, spring, summer.
// Fall 2026, Spring 2027, and Summer 2027 belong to the same academic year.

export const SEASON_CODES = ['FA', 'SP', 'SU'];
export const SEASON_NAMES = { FA: 'fall', SP: 'spring', SU: 'summer' };
const CODE_BY_NAME = { fall: 'FA', spring: 'SP', summer: 'SU' };
const LABEL_BY_CODE = { FA: 'Fall', SP: 'Spring', SU: 'Summer' };
const YEAR_NAMES = ['freshman', 'sophomore', 'junior', 'senior'];

export function parseTerm(term) {
  const m = /^(\d{4})(FA|SP|SU)$/.exec(String(term));
  if (!m) throw new Error(`Invalid term "${term}". Use a year and FA, SP, or SU, for example 2026FA.`);
  return { year: Number(m[1]), code: m[2], season: SEASON_NAMES[m[2]] };
}

export function isTerm(term) {
  return /^\d{4}(FA|SP|SU)$/.test(String(term));
}

/** Position of a term on one continuous line: three terms per academic year. */
export function termIndex(term) {
  const { year, code } = parseTerm(term);
  const academicYear = code === 'FA' ? year : year - 1;
  return academicYear * 3 + SEASON_CODES.indexOf(code);
}

export function termFromIndex(index) {
  const academicYear = Math.floor(index / 3);
  const code = SEASON_CODES[((index % 3) + 3) % 3];
  return `${code === 'FA' ? academicYear : academicYear + 1}${code}`;
}

export function compareTerms(a, b) {
  return termIndex(a) - termIndex(b);
}

export function seasonOf(term) {
  return parseTerm(term).season;
}

export function termLabel(term) {
  const { year, code } = parseTerm(term);
  return `${LABEL_BY_CODE[code]} ${year}`;
}

/** Next term after `term`. Skips summer when summer is not allowed. */
export function nextTerm(term, { summer = true } = {}) {
  let i = termIndex(term) + 1;
  if (!summer && i % 3 === 2) i += 1;
  return termFromIndex(i);
}

/** Terms from `first` through `last`, inclusive. */
export function termRange(first, last, { summer = true } = {}) {
  const out = [];
  for (let i = termIndex(first); i <= termIndex(last); i += 1) {
    if (!summer && i % 3 === 2) continue;
    out.push(termFromIndex(i));
  }
  return out;
}

/** How many usable terms later `b` is than `a`. Negative when `b` is earlier. */
export function termDistance(a, b, { summer = true } = {}) {
  const ia = termIndex(a);
  const ib = termIndex(b);
  if (ia === ib) return 0;
  const sign = ib > ia ? 1 : -1;
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  let count = 0;
  for (let i = lo + 1; i <= hi; i += 1) {
    if (!summer && i % 3 === 2) continue;
    count += 1;
  }
  return sign * count;
}

/**
 * The list of terms a plan can use, in order.
 * Passes and plans work on positions in this list ("ordinals"), so a summer that
 * nobody can use never counts as a term.
 */
export function buildTermAxis(startTerm, { summerAllowed = false, count = 24 } = {}) {
  let i = termIndex(startTerm);
  if (!summerAllowed && i % 3 === 2) i += 1;
  const terms = [];
  while (terms.length < count) {
    if (summerAllowed || i % 3 !== 2) terms.push(termFromIndex(i));
    i += 1;
  }
  const seasons = terms.map(seasonOf);
  const index = new Map(terms.map((t, n) => [t, n]));
  return { terms, seasons, index, summerAllowed: !!summerAllowed };
}

/** Ordinal of `term` on the axis. A term the axis skips (an unused summer) maps to the next usable term. */
export function ordinalOf(axis, term) {
  if (axis.index.has(term)) return axis.index.get(term);
  const target = termIndex(term);
  for (let n = 0; n < axis.terms.length; n += 1) {
    if (termIndex(axis.terms[n]) >= target) return n;
  }
  return axis.terms.length;
}

// Academic map positions: "junior-fall" is year 2 (0-based), season 0. Three positions per year.

export function parseSuggested(value) {
  const m = /^(freshman|sophomore|junior|senior)-(fall|spring|summer)$/.exec(String(value));
  if (!m) throw new Error(`Invalid suggested term "${value}". Use a form like junior-fall.`);
  return YEAR_NAMES.indexOf(m[1]) * 3 + ['fall', 'spring', 'summer'].indexOf(m[2]);
}

export function isSuggested(value) {
  return /^(freshman|sophomore|junior|senior)-(fall|spring|summer)$/.test(String(value));
}

export function suggestedFromPosition(position) {
  const year = YEAR_NAMES[Math.floor(position / 3)] ?? `year${Math.floor(position / 3) + 1}`;
  return `${year}-${['fall', 'spring', 'summer'][((position % 3) + 3) % 3]}`;
}

export function suggestedLabel(value) {
  const [year, season] = String(value).split('-');
  return `${year[0].toUpperCase()}${year.slice(1)} ${season}`;
}

export function positionSeason(position) {
  return ['fall', 'spring', 'summer'][((position % 3) + 3) % 3];
}

export function seasonCode(name) {
  return CODE_BY_NAME[name];
}
