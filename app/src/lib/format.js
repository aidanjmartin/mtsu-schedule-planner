export function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function meetingText(m) {
  return `${m.days} ${formatTime(m.start)} to ${formatTime(m.end)}`;
}

export const DAY_NAMES = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat' };
export const DAY_FULL = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday', S: 'Saturday' };

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function listText(items, joiner = 'and') {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${joiner} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${joiner} ${items[items.length - 1]}`;
}

/** A proposed course has no official catalog description yet, so it has no class times either. */
export function isNewCourse(catalog, id) {
  const def = catalog?.courses?.[id];
  return !!def && (!def.description || !!def.description_unofficial);
}

/** Sentence for new courses that have no published class times. */
export function newCourseTimesText(ids) {
  if (ids.length === 0) return '';
  const names = ids.length === 1 ? ids[0] : ids.length === 2 ? `${ids[0]} and ${ids[1]}` : `${ids.slice(0, -1).join(', ')}, and ${ids[ids.length - 1]}`;
  return ids.length === 1
    ? `${names} is a new course, so its class times aren't published yet.`
    : `${names} are new courses, so their class times aren't published yet.`;
}
