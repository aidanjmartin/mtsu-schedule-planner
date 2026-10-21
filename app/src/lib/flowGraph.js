// Prerequisite lines for the Flow view.

import { prereqs as P } from './engine.js';
import { GROUP_BY_COURSE } from './mapLayout.js';

/** Lines from each prerequisite to the course that needs it. */
export function buildEdges(catalog) {
  const edges = [];
  for (const [id, def] of Object.entries(catalog.courses)) {
    if (!GROUP_BY_COURSE[id]) continue;
    for (const leaf of P.prereqLeaves(def.prereqs)) {
      if (!GROUP_BY_COURSE[leaf.course]) continue;
      edges.push({ id: `${leaf.course}->${id}`, from: leaf.course, to: id, together: leaf.concurrent_ok === true });
    }
  }
  return edges;
}

/** Everything reachable by following `edges` from `start` in one direction. */
function reach(start, edges, next) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const e of edges) {
      const n = next(e, id);
      if (n && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/** The courses before a course (all the way back), and the courses after it (all the way forward). */
export function chainsFor(id, edges) {
  return {
    before: reach(id, edges, (e, cur) => (e.to === cur ? e.from : null)),
    after: reach(id, edges, (e, cur) => (e.from === cur ? e.to : null)),
  };
}
