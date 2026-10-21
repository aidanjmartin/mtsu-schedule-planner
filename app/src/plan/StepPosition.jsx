import React from 'react';
import { currentTermFor, firstSemesterOptions, firstTermFor, hasPosition } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';

const YEARS = [[1, '1st year'], [2, '2nd year'], [3, '3rd year'], [4, '4th year'], [5, '5th year or later']];

export default function StepPosition({ answers, setPosition }) {
  const current = hasPosition(answers) ? T.termLabel(currentTermFor(answers)) : null;
  const options = firstSemesterOptions();
  const chosen = firstTermFor(answers);
  return (
    <div className="step-body">
      <label className={`choice-card choice-wide${answers.firstSemester ? ' is-on' : ''}`}>
        <input
          type="radio" name="place" checked={answers.firstSemester}
          onChange={() => setPosition({ firstSemester: true, firstTerm: chosen, year: null, season: null })}
        />
        <span>
          <strong>I'm starting my first semester</strong>
          <span className="choice-note">You have not taken any Mechatronics courses yet.</span>
        </span>
      </label>

      {answers.firstSemester && (
        <fieldset className="fieldset fieldset-after-card">
          <legend>Which semester do you start?</legend>
          <div className="seg seg-two" role="radiogroup">
            {options.terms.map((term) => (
              <label key={term} className={`seg-item${chosen === term ? ' is-on' : ''}`}>
                <input
                  type="radio" name="first-term" checked={chosen === term}
                  onChange={() => setPosition({ firstSemester: true, firstTerm: term })}
                />
                <span>{T.termLabel(term)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="or-line"><span>or tell us where you are now</span></p>

      <fieldset className="fieldset">
        <legend>Which year are you in?</legend>
        <div className="seg" role="radiogroup">
          {YEARS.map(([value, label]) => (
            <label key={value} className={`seg-item${answers.year === value && !answers.firstSemester ? ' is-on' : ''}`}>
              <input
                type="radio" name="year" checked={answers.year === value && !answers.firstSemester}
                onChange={() => setPosition({ firstSemester: false, year: value })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="step-aside" aria-live="polite">
        {current
          ? (answers.firstSemester
            ? `Your plan starts in ${current} and assumes you have not finished any courses.`
            : `We count ${current} as your current semester and plan the semesters after it.`)
          : ''}
      </p>
    </div>
  );
}
