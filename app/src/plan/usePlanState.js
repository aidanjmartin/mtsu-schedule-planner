import { useCallback, useEffect, useState } from 'react';
import { emptyAnswers, seedAnswers, hasPosition, LOADS, ELECTIVE_COUNT } from '../lib/planModel.js';
import { storageGet, storageSet, storageRemove } from '../lib/storage.js';

const KEY = 'mtsu-mechatronics-plan-v1';
export const STEP_COUNT = 6;

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/** Read saved answers. Anything that does not look right is dropped, so old or edited data cannot break the page. */
function readSaved(catalog) {
  const text = storageGet(KEY);
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    const base = emptyAnswers();
    const known = (id) => Boolean(catalog.courses[id]);
    const answers = {
      ...base,
      firstSemester: raw.answers?.firstSemester === true,
      firstTerm: typeof raw.answers?.firstTerm === 'string' && /^\d{4}(FA|SP)$/.test(raw.answers.firstTerm) ? raw.answers.firstTerm : null,
      year: Number.isInteger(raw.answers?.year) && raw.answers.year >= 1 && raw.answers.year <= 5 ? raw.answers.year : null,
      season: ['fall', 'spring'].includes(raw.answers?.season) ? raw.answers.season : null,
      finished: list(raw.answers?.finished).filter(known),
      taking: list(raw.answers?.taking).filter(known),
      electives: list(raw.answers?.electives).filter(known).slice(0, ELECTIVE_COUNT),
      electivesDone: list(raw.answers?.electivesDone).filter(known).slice(0, ELECTIVE_COUNT),
      load: LOADS[raw.answers?.load] ? raw.answers.load : 'standard',
      seededFor: typeof raw.answers?.seededFor === 'string' ? raw.answers.seededFor : null,
    };
    const step = Number.isInteger(raw.step) ? Math.min(Math.max(raw.step, 0), STEP_COUNT - 1) : 0;
    return { answers, step: hasPosition(answers) ? step : 0 };
  } catch {
    return null;
  }
}

/** The student's answers and current step, saved in this browser. */
export default function usePlanState(catalog) {
  const [state, setState] = useState(() => readSaved(catalog) ?? { answers: emptyAnswers(), step: 0 });

  useEffect(() => {
    storageSet(KEY, JSON.stringify(state));
  }, [state]);

  const setStep = useCallback((step) => setState((s) => ({ ...s, step })), []);
  const setAnswers = useCallback((change) => setState((s) => {
    const next = typeof change === 'function' ? change(s.answers) : { ...s.answers, ...change };
    return { ...s, answers: next };
  }), []);

  /** Change the student's place in the program and refill the finished and taking lists from the map. */
  const setPosition = useCallback((patch) => setState((s) => {
    const moved = { ...s.answers, ...patch };
    return { ...s, answers: hasPosition(moved) ? seedAnswers(catalog, moved) : { ...moved, seededFor: null } };
  }), [catalog]);

  const reset = useCallback(() => {
    storageRemove(KEY);
    setState({ answers: emptyAnswers(), step: 0 });
  }, []);

  return { answers: state.answers, step: state.step, setStep, setAnswers, setPosition, reset };
}
