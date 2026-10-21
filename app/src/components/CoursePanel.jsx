import React from 'react';
import { offeredText, needText, directUnlocks, tileLabel } from '../lib/courseGraph.js';
import { GROUP_BY_COURSE } from '../lib/mapLayout.js';
import { positionLabel } from '../lib/planModel.js';
import { prereqs as P } from '../lib/engine.js';

export default function CoursePanel({ catalog, offerings, courseId, onSelect, onClose }) {
  if (!courseId) {
    return (
      <div className="panel-empty">
        <h2>Pick a course</h2>
        <p>Select a course on the map to see what you need first and what it opens up.</p>
        <p className="muted">Drag the map to move it. Use the plus and minus buttons, a mouse wheel, or two fingers to zoom.</p>
      </div>
    );
  }
  const def = catalog.courses[courseId];
  const group = GROUP_BY_COURSE[courseId];
  const needs = needText(catalog, courseId);
  const unlocks = directUnlocks(catalog, courseId);
  const position = P.suggestedPositionOf(catalog, courseId);
  const elective = group.kind === 'elective';
  return (
    <div className="panel-body" style={{ '--g': `var(--g-${group.cssKey})`, '--gbg': `var(--g-${group.cssKey}-bg)` }}>
      <div className="panel-head">
        <div>
          <p className="panel-group"><span className="swatch" aria-hidden="true" />{group.short ?? group.label}</p>
          <h2 id="course-title">{tileLabel(catalog, courseId)}</h2>
          <p className="panel-title">{def.title}</p>
        </div>
        <button type="button" className="btn btn-quiet btn-small panel-close" onClick={onClose} aria-label="Close course details">Close</button>
      </div>

      <dl className="facts">
        <div><dt>Credit hours</dt><dd>{def.credits}</dd></div>
        <div><dt>Runs in</dt><dd>{offeredText(catalog, offerings, courseId)}</dd></div>
        <div>
          <dt>{elective ? 'Requirement' : 'On the academic map'}</dt>
          <dd>{elective ? 'Elective. Choose 3 of 8 electives.' : position !== null ? positionLabel(position) : 'Required'}</dd>
        </div>
      </dl>

      <section aria-labelledby="need-h">
        <h3 id="need-h">What you need first</h3>
        {needs.length === 0 ? <p>Nothing. You can take this course at any time it runs.</p> : needs.map((line) => <p key={line}>{line}</p>)}
      </section>

      <section aria-labelledby="open-h">
        <h3 id="open-h">What it opens up</h3>
        {unlocks.length === 0 ? (
          <p>No other course needs this one.</p>
        ) : (
          <ul className="unlock-list">
            {unlocks.map((u) => (
              <li key={u.id}>
                <button type="button" className="link-button" onClick={() => onSelect(u.id)}>
                  <strong>{tileLabel(catalog, u.id)}</strong> {catalog.courses[u.id].title}
                </button>
                {u.together && <span className="muted small"> (you can take it with {courseId})</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
