// Loads the catalog, the offering patterns, and class schedules. The files come from the `data/` folder
// that the build copies next to the page (see scripts/copy-data.mjs).

const BASE = import.meta.env.BASE_URL;
export const CATALOG_FILE = '2026-27';

async function fetchJson(path) {
  try {
    const response = await fetch(`${BASE}data/${path}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** The catalog, the offering patterns, and the list of terms that have a schedule file. */
export async function loadCore() {
  const [catalog, offerings, index] = await Promise.all([
    fetchJson(`catalogs/${CATALOG_FILE}.json`),
    fetchJson('offerings.json'),
    fetchJson('schedule/index.json'),
  ]);
  if (!catalog) throw new Error('The course catalog did not load.');
  const scheduleTerms = (index?.terms ?? []).map((t) => t.term);
  return { catalog, offerings, scheduleTerms };
}

const scheduleCache = new Map();

/** One term's class schedule, or null when the term has no file. */
export function loadSchedule(term) {
  if (!scheduleCache.has(term)) scheduleCache.set(term, fetchJson(`schedule/${term}.json`));
  return scheduleCache.get(term);
}

export async function loadSchedules(terms) {
  const loaded = await Promise.all(terms.map(loadSchedule));
  return Object.fromEntries(terms.map((t, i) => [t, loaded[i]]).filter(([, s]) => s));
}
