import React, { useState } from 'react';
import { SUBJECTS } from '../lib/exploreModel.js';

function Head() {
  return <path d="M31 2.2L40 6l-9 3.8 2.4-3.8z" className="lg-head" />;
}

/** Arrow styles for the Circle view: every arrow is dashed and points to the course that needs the other. */
function CircleLines() {
  return (
    <ul className="legend-arrows">
      <li>
        <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dash" /><Head /></svg>
        <span>Points to the course that needs it</span>
      </li>
      <li>
        <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dashdot" /><Head /></svg>
        <span>May be taken the same semester</span>
      </li>
    </ul>
  );
}

/** Line styles for the Flow view: solid lines lead back to what a course needs, dashed lines lead on to what it opens up. */
function FlowLines() {
  return (
    <ul className="legend-arrows">
      <li>
        <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-solid" /><Head /></svg>
        <span>A course you need first</span>
      </li>
      <li>
        <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dash" /><Head /></svg>
        <span>A course it opens up</span>
      </li>
      <li>
        <svg width="44" height="12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" className="lg-dashdot" /><Head /></svg>
        <span>May be taken the same semester</span>
      </li>
    </ul>
  );
}

/**
 * The legend. The Circle view shows subject colors and arrow styles in a column at the left of the map. The Flow view
 * labels each subject group on the chart, so its legend shows only the line styles, as a strip above the chart. A phone
 * folds the legend away behind a button.
 */
export default function MapLegend({ narrow, view = 'circle' }) {
  const [shown, setShown] = useState(null);
  const open = narrow ? (shown ?? false) : true;
  const layout = narrow ? 'is-overlay' : view === 'flow' ? 'is-strip' : 'is-column';
  return (
    <div className={`iris-legend${open ? ' is-open' : ''} ${layout}`}>
      {narrow ? (
        <button type="button" className="legend-toggle" aria-expanded={open} aria-controls="legend-body" onClick={() => setShown(!open)}>
          Legend
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" /></svg>
        </button>
      ) : layout === 'is-column' ? <h2 className="legend-title">Legend</h2> : null}
      <div id="legend-body" className="legend-body" hidden={!open}>
        {view !== 'flow' && (
          <ul className="legend-subjects">
            {SUBJECTS.map((s) => (
              <li key={s.key}><span className="dot" style={{ '--c': `var(--g-${s.css})` }} aria-hidden="true" />{s.label}</li>
            ))}
          </ul>
        )}
        {view === 'flow' ? <FlowLines /> : <CircleLines />}
      </div>
    </div>
  );
}
