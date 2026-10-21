import React, { useState } from 'react';
import { SUBJECTS } from '../lib/exploreModel.js';

/** The legend at the top left of the map: subject colors and the two arrow styles. A phone keeps it folded away. */
export default function MapLegend({ narrow }) {
  const [shown, setShown] = useState(null);
  const open = narrow ? (shown ?? false) : true;
  return (
    <div className={`iris-legend${open ? ' is-open' : ''}${narrow ? ' is-overlay' : ' is-column'}`}>
      {narrow ? (
        <button type="button" className="legend-toggle" aria-expanded={open} aria-controls="legend-body" onClick={() => setShown(!open)}>
          Legend
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" /></svg>
        </button>
      ) : <h2 className="legend-title">Legend</h2>}
      <div id="legend-body" className="legend-body" hidden={!open}>
        <ul className="legend-subjects">
          {SUBJECTS.map((s) => (
            <li key={s.key}><span className="dot" style={{ '--c': `var(--g-${s.css})` }} aria-hidden="true" />{s.label}</li>
          ))}
        </ul>
        <ul className="legend-arrows">
          <li>
            <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dash" /><path d="M31 2.2L40 6l-9 3.8 2.4-3.8z" className="lg-head" /></svg>
            <span>Points to the course that needs it</span>
          </li>
          <li>
            <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dashdot" /><path d="M31 2.2L40 6l-9 3.8 2.4-3.8z" className="lg-head" /></svg>
            <span>May be taken the same semester</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
