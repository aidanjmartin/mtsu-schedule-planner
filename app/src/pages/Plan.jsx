import React, { useEffect, useRef, useState } from 'react';
import { useData } from '../lib/DataContext.jsx';
import { hasPosition, ELECTIVE_COUNT } from '../lib/planModel.js';
import usePlanState, { STEP_COUNT } from '../plan/usePlanState.js';
import ProgressBar, { STEP_NAMES } from '../plan/ProgressBar.jsx';
import StepPosition from '../plan/StepPosition.jsx';
import StepFinished from '../plan/StepFinished.jsx';
import StepTaking from '../plan/StepTaking.jsx';
import StepElectives from '../plan/StepElectives.jsx';
import StepLoad from '../plan/StepLoad.jsx';
import Results from '../plan/Results.jsx';

const TITLES = [
  'Where are you in the program?',
  'Which courses have you finished?',
  'What are you taking this semester?',
  'Pick your electives',
  'How many credit hours per semester?',
  'Your plan',
];

export default function Plan() {
  const { core } = useData();
  const { catalog, offerings, scheduleTerms } = core;
  const { answers, step, setStep, setAnswers, setPosition, reset } = usePlanState(catalog);
  const [reached, setReached] = useState(step);
  const headingRef = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    setReached((r) => Math.max(r, step));
    if (first.current) { first.current = false; return; }
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  const canContinue = step === 0 ? hasPosition(answers) : step === 3 ? answers.electives.length === ELECTIVE_COUNT : true;
  const hint = step === 0 && !canContinue ? 'Choose where you are to continue.'
    : step === 3 && !canContinue ? `Choose ${ELECTIVE_COUNT} electives to continue.` : '';
  const onResults = step === STEP_COUNT - 1;

  const props = { catalog, offerings, answers, setAnswers };
  const startOver = () => { reset(); setReached(0); };

  return (
    <div className="page plan">
      <ProgressBar step={step} reachable={reached} onGo={setStep} />

      <section className={`step-card${onResults ? ' step-card-wide' : ''}`} aria-labelledby="step-title">
        <header className="step-head">
          <h1 id="step-title" tabIndex={-1} ref={headingRef}>{TITLES[step]}</h1>
          <p className="visually-hidden">Step {step + 1} of {STEP_COUNT}: {STEP_NAMES[step]}</p>
        </header>

        {step === 0 && <StepPosition answers={answers} setPosition={setPosition} />}
        {step === 1 && <StepFinished {...props} />}
        {step === 2 && <StepTaking {...props} />}
        {step === 3 && <StepElectives {...props} />}
        {step === 4 && <StepLoad {...props} />}
        {step === 5 && (
          <Results
            catalog={catalog} offerings={offerings} scheduleTerms={scheduleTerms} answers={answers}
            onEdit={() => setStep(0)} onStartOver={startOver}
          />
        )}

        <footer className={`step-nav${onResults ? " is-static" : ""}`}>
          <div className="step-nav-inner">
            <button type="button" className="btn" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</button>
            {hint && <p className="nav-hint" role="status">{hint}</p>}
            {!onResults && (
              <button
                type="button" className="btn btn-primary"
                aria-disabled={!canContinue} onClick={() => canContinue && setStep(step + 1)}
              >
                Continue
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
