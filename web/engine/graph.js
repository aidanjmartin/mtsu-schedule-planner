// Course data model and the prerequisite and corequisite graph.
//
// A prerequisite must be finished in an earlier term. A corequisite is a course the catalog lets a student take in
// the same term or earlier (`concurrent_ok` in the catalog file). A lecture and its required lab form one planning
// unit, so the lab never appears as its own node: it is listed in the unit's `components`.
//
// Everything returned here is plain data that survives JSON.stringify, so the interface can cache it or pass it to a
// worker. The helper functions take that data and return new values.

import { parseSuggested, suggestedLabel } from './terms.js';
import {
  normalizePrereqs, describePrereqs, creditRange, isRepeatable, effectiveSeasons, courseRequirementMap,
  suggestedPositionOf, isChoice,
} from './prereqs.js';

/** Edge kinds. */
export const PREREQUISITE = 'prerequisite';
export const COREQUISITE = 'corequisite';

/**
 * One record per catalog course with every field the interface needs to show or reason about it.
 * Returns { catalog_year, program, total_hours, standing_hours, milestones, requirements, courses }.
 * `courses` maps a course id to:
 *   id, subject, number, level (1000, 2000, ...), title, description, credits { min, max }, repeatable,
 *   components, prereqs (normalized expression), prereq_text, standing, standing_hours, seasons, season_source,
 *   regular_seasons, occasional_seasons, available_from, suggested_term, suggested_label, suggested_position,
 *   requirement (id), role ('required' | 'elective' | 'other'), first_semester, proposed, needs_check, notes.
 */
export function buildCourseModel(catalog, offerings = null) {
  const owners = courseRequirementMap(catalog);
  const reqById = new Map((catalog.requirements ?? []).map((r) => [r.id, r]));
  const courses = {};
  for (const [id, def] of Object.entries(catalog.courses ?? {})) {
    const [subject, number] = id.split(' ');
    const seasons = effectiveSeasons(catalog, id, offerings);
    const requirement = (owners.get(id) ?? [])[0] ?? null;
    const reqType = requirement ? reqById.get(requirement)?.type : null;
    const position = suggestedPositionOf(catalog, id);
    const notes = typeof def.notes === 'string' ? def.notes : '';
    courses[id] = {
      id,
      subject,
      number,
      level: Number.isFinite(Number(number?.slice(0, 1))) ? Number(number.slice(0, 1)) * 1000 : null,
      title: def.title,
      description: def.description ?? null,
      credits: creditRange(def),
      repeatable: isRepeatable(def),
      components: def.components?.length ? [...def.components] : [id],
      prereqs: normalizePrereqs(def.prereqs),
      prereq_text: describePrereqs(def.prereqs),
      standing: def.standing ?? null,
      standing_hours: def.standing ? catalog.standing_hours?.[def.standing] ?? null : null,
      seasons: [...seasons.seasons],
      season_source: seasons.source,
      regular_seasons: seasons.regular,
      occasional_seasons: seasons.occasional,
      available_from: def.available_from ?? null,
      suggested_term: def.suggested_term ?? null,
      suggested_label: def.suggested_term ? suggestedLabel(def.suggested_term) : null,
      suggested_position: position,
      requirement,
      role: reqType === 'all' ? 'required' : isChoice({ type: reqType }) ? 'elective' : 'other',
      first_semester: def.first_semester === true,
      proposed: /proposed/i.test(notes) && /not in the published/i.test(notes),
      needs_check: notes.startsWith('CHECK:'),
      notes,
    };
  }
  return {
    catalog_year: catalog.catalog_year,
    program: catalog.program,
    total_hours: catalog.total_hours,
    standing_hours: { ...(catalog.standing_hours ?? {}) },
    milestones: (catalog.milestones ?? []).map((m) => ({ ...m, courses: [...(m.courses ?? [])] })),
    requirements: (catalog.requirements ?? []).map((r) => JSON.parse(JSON.stringify(r))),
    courses,
  };
}

/**
 * The prerequisite and corequisite graph.
 * Each edge runs from the course that must come first (`from`) to the course that needs it (`to`).
 *   kind: 'prerequisite' (an earlier term) or 'corequisite' (the same term or earlier)
 *   optional: true when the edge sits inside an any-of group, so another course can satisfy it instead
 *   group: an id shared by the edges of one any-of group, or null
 *   min_grade: the grade the catalog asks for, recorded but not enforced
 * Edges that name a course outside the catalog are listed in `unknown` and left out of `edges`.
 */
export function buildPrereqGraph(catalog) {
  const nodes = Object.keys(catalog.courses ?? {});
  const known = new Set(nodes);
  const edges = [];
  const unknown = [];
  let groupCounter = 0;
  for (const id of nodes) {
    const walk = (node, group, optional) => {
      if (!node) return;
      if (node.type === 'course') {
        const edge = {
          from: node.course,
          to: id,
          kind: node.concurrent_ok ? COREQUISITE : PREREQUISITE,
          optional,
          group,
          min_grade: node.min_grade ?? null,
        };
        if (known.has(node.course)) edges.push(edge);
        else unknown.push(edge);
        return;
      }
      if (node.type === 'any' && node.items.length > 1) {
        groupCounter += 1;
        const g = `${id}#any${groupCounter}`;
        node.items.forEach((child) => walk(child, g, true));
      } else {
        node.items.forEach((child) => walk(child, group, optional));
      }
    };
    walk(normalizePrereqs(catalog.courses[id].prereqs), null, false);
  }
  return { nodes, edges, unknown };
}

/** Edges into a course: what it needs. */
export function prerequisitesOf(graph, id) {
  return graph.edges.filter((e) => e.to === id);
}

/** Edges out of a course: what it opens up. */
export function dependentsOf(graph, id) {
  return graph.edges.filter((e) => e.from === id);
}

function reach(graph, start, next, { includeOptional = true } = {}) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    for (const e of next(current)) {
      if (!includeOptional && e.optional) continue;
      const other = e.from === current ? e.to : e.from;
      if (!seen.has(other) && other !== start) { seen.add(other); stack.push(other); }
    }
  }
  return [...seen].sort();
}

/** Every course a student must have before `id`, following every link. `includeOptional: false` skips any-of links. */
export function ancestors(graph, id, options) {
  return reach(graph, id, (c) => prerequisitesOf(graph, c), options);
}

/** Every course that needs `id`, directly or through other courses. */
export function descendants(graph, id, options) {
  return reach(graph, id, (c) => dependentsOf(graph, c), options);
}

/**
 * The fewest terms needed to reach each course from a clean start: a course with no prerequisites sits at level 0,
 * a prerequisite adds one level, and a corequisite adds none. Any-of groups follow their lowest alternative.
 * Courses inside a prerequisite cycle get level null.
 */
export function levels(catalog) {
  const memo = new Map();
  const visiting = new Set();
  const levelOf = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return null;
    const def = catalog.courses[id];
    if (!def) return null;
    visiting.add(id);
    const value = (node) => {
      if (!node) return 0;
      if (node.type === 'course') {
        const l = levelOf(node.course);
        return l === null ? null : l + (node.concurrent_ok ? 0 : 1);
      }
      if (node.items.length === 0) return 0;
      const vals = node.items.map(value);
      if (node.type === 'all') return vals.some((v) => v === null) ? null : Math.max(...vals);
      const ok = vals.filter((v) => v !== null);
      return ok.length ? Math.min(...ok) : null;
    };
    const result = value(normalizePrereqs(def.prereqs));
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  return Object.fromEntries(Object.keys(catalog.courses ?? {}).map((id) => [id, levelOf(id)]));
}

/**
 * The longest run of strict prerequisites that ends at `id` (any-of groups follow their lowest alternative),
 * listed from the first course to `id`. Corequisite links join the chain without adding a term.
 */
export function longestChain(catalog, id) {
  const lv = levels(catalog);
  const chain = [id];
  let current = id;
  const seen = new Set([id]);
  while (true) {
    const norm = normalizePrereqs(catalog.courses[current]?.prereqs);
    const leaves = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === 'course') { leaves.push(node); return; }
      if (node.type === 'all') { node.items.forEach(walk); return; }
      const best = [...node.items].sort((a, b) => leafLevel(a) - leafLevel(b))[0];
      if (best) walk(best);
    };
    const leafLevel = (node) => (node.type === 'course' ? (lv[node.course] ?? 0) + (node.concurrent_ok ? 0 : 1) : 0);
    walk(norm);
    const next = leaves
      .filter((l) => catalog.courses[l.course] && !seen.has(l.course))
      .sort((a, b) => leafLevel(b) - leafLevel(a) || a.course.localeCompare(b.course))[0];
    if (!next) break;
    chain.unshift(next.course);
    seen.add(next.course);
    current = next.course;
  }
  return chain;
}

/** The academic map position of a course as a number (year * 3 + season), or null. */
export function mapPosition(catalog, id) {
  const def = catalog.courses[id];
  return def?.suggested_term ? parseSuggested(def.suggested_term) : suggestedPositionOf(catalog, id);
}
