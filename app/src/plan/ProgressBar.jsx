import React from 'react';

export const STEP_NAMES = ['Your place', 'Finished', 'This semester', 'Electives', 'Credit load', 'Your plan'];

export default function ProgressBar({ step, reachable, onGo }) {
  return (
    <nav className="progress" aria-label="Plan steps">
      <p className="progress-now" aria-hidden="true">
        Step {step + 1} of {STEP_NAMES.length}: <strong>{STEP_NAMES[step]}</strong>
      </p>
      <ol className="progress-list">
        {STEP_NAMES.map((name, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo';
          const canGo = i <= reachable && i !== step;
          return (
            <li key={name} className={`progress-item is-${state}`} aria-current={i === step ? 'step' : undefined}>
              {canGo ? (
                <button type="button" className="progress-link" onClick={() => onGo(i)}>
                  <span className="progress-dot" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
                  <span className="progress-name">{name}</span>
                  <span className="visually-hidden">, go to step {i + 1}</span>
                </button>
              ) : (
                <span className="progress-link">
                  <span className="progress-dot" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
                  <span className="progress-name">{name}</span>
                  {i === step && <span className="visually-hidden"> (current step)</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
