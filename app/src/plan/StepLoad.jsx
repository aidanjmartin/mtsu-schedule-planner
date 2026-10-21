import React, { useMemo } from 'react';
import { compareLoads, LOAD_ORDER } from '../lib/planModel.js';
import { semestersBetween, delayText } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';

const BLURB = {
  light: 'A lighter schedule leaves time for work, family, or a tough course. It can add semesters.',
  standard: 'The usual load for a full-time student. It fits most students.',
  heavy: 'The most hours a semester allows. It can shorten your plan, but it asks the most of you.',
};

export default function StepLoad({ catalog, offerings, answers, setAnswers }) {
  const results = useMemo(
    () => compareLoads(catalog, offerings, answers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, offerings, answers.finished, answers.taking, answers.electives, answers.electivesDone, answers.firstSemester, answers.year, answers.season],
  );
  const best = results.reduce((a, b) => (a.graduation && b.graduation && T.compareTerms(b.graduation, a.graduation) < 0 ? b : a), results[0]);

  return (
    <div className="step-body">
      <p className="step-hint">Pick the number of credit hours you want to take each semester. Each choice shows when you would graduate.</p>
      <div className="load-list" role="radiogroup" aria-label="Credit hours per semester">
        {LOAD_ORDER.map((key, i) => {
          const r = results[i];
          const later = r.graduation && best.graduation ? semestersBetween(best.graduation, r.graduation) : 0;
          return (
            <label key={key} className={`choice-card load-card${answers.load === key ? ' is-on' : ''}`}>
              <input type="radio" name="load" checked={answers.load === key} onChange={() => setAnswers({ load: key })} />
              <span className="load-main">
                <span className="load-name"><strong>{r.load.label}</strong><span className="load-range">{r.load.range} a semester</span></span>
                <span className="choice-note">{BLURB[key]}</span>
                <span className="load-result">
                  {r.graduation
                    ? <>You graduate in <strong>{r.graduationLabel}</strong>{r.seniorDesign ? <>, and senior design starts in <strong>{r.seniorDesign.startLabel}</strong></> : null}.{later > 0 ? ` That is ${delayText(later)} later than the ${best.load.label.toLowerCase()} load.` : ''}</>
                    : 'This load leaves some courses without a semester. Choose a heavier load.'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
