import React from 'react';

export const VIEWS = [['term', 'Term view'], ['circle', 'Circle view'], ['flow', 'Flow view']];

/** The switch between the map views. It is a group of radio buttons, so a keyboard moves between them with the arrow keys. */
export default function ViewSwitch({ view, onChange }) {
  const move = (e, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next = VIEWS[(index + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? VIEWS.length - 1 : 1)) % VIEWS.length][0];
    onChange(next);
    e.currentTarget.parentElement.querySelector(`[data-view="${next}"]`)?.focus();
  };
  return (
    <div className="view-switch" role="radiogroup" aria-label="Map view">
      {VIEWS.map(([key, label], i) => (
        <button
          key={key} type="button" role="radio" aria-checked={view === key} data-view={key}
          tabIndex={view === key ? 0 : -1} className={`view-opt${view === key ? ' is-on' : ''}`}
          onClick={() => onChange(key)} onKeyDown={(e) => move(e, i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
