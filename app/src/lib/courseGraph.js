// Course labels, prerequisite links, and the plain-word text the Explore panel shows.

import { prereqs as P, terms as T } from './engine.js';
import { prereqSentences, seasonsText } from './planModel.js';

/** The label for a course: a lecture with its lab reads "PHYS 2110/2111". */
export function tileLabel(catalog, id) {
  const comps = catalog.courses[id]?.components ?? [id];
  if (comps.length <= 1) return id;
  return `${comps[0]}/${comps.slice(1).map((c) => c.split(' ')[1]).join('/')}`;
}

/** Courses that name this course as a prerequisite, with whether they allow taking it in the same semester. */
export function directUnlocks(catalog, id) {
  const out = [];
  for (const [other, def] of Object.entries(catalog.courses)) {
    const leaf = P.prereqLeaves(def.prereqs).find((l) => l.course === id);
    if (leaf) out.push({ id: other, together: leaf.concurrent_ok === true });
  }
  return out.sort((a, b) => (P.suggestedPositionOf(catalog, a.id) ?? 99) - (P.suggestedPositionOf(catalog, b.id) ?? 99) || a.id.localeCompare(b.id));
}

export function offeredText(catalog, offerings, id) {
  const def = catalog.courses[id];
  const { seasons } = P.effectiveSeasons(catalog, id, offerings);
  let text = seasonsText(seasons);
  if (def.available_from) text += `, starting ${T.termLabel(def.available_from)}`;
  return text;
}

export function needText(catalog, id) {
  const def = catalog.courses[id];
  const lines = prereqSentences(def.prereqs);
  if (def.standing) {
    const need = catalog.standing_hours?.[def.standing] ?? 0;
    lines.push(`You also need ${def.standing} standing (${need} credit hours finished).`);
  }
  return lines;
}
