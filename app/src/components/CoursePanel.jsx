import React from 'react';
import { offeredText, needText, tileLabel } from '../lib/courseGraph.js';
import { AREA_BY_ID, AREA_OF, SUBJECT_OF, linksFor, mapPositionOf, semesterLabel, hoursText } from '../lib/exploreModel.js';
import { prereqs as P } from '../lib/engine.js';

function Chips({ catalog, items, onSelect, label }) {
  return (
    <ul className="chip-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button" className="chip" onClick={() => onSelect(item.id)} style={{ '--c': `var(--g-${SUBJECT_OF[item.id].css})` }}
            aria-label={`${tileLabel(catalog, item.id)}, ${catalog.courses[item.id].title}${item.together ? '. You may take it in the same semester.' : ''}`}
          >
            <span className="chip-dot" aria-hidden="true" />
            <span className="chip-id">{tileLabel(catalog, item.id)}</span>
            {item.together && <span className="chip-note">same semester</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the elective rule says about this course: the 10 hours, and the combined limit for internship and research. */
function electiveNote(catalog, id) {
  const req = catalog.requirements.find((r) => r.type === 'choose_hours' && r.options.includes(id));
  if (!req) return 'Elective.';
  const limit = (req.limits ?? []).find((l) => l.courses.includes(id));
  const base = `Elective. Choose ${req.hours} hours of electives.`;
  return limit ? `${base} ${limit.courses.join(' and ')} together count for at most ${limit.max_hours} hours.` : base;
}

/** Details for the selected course. On a phone this is a bottom sheet. */
export default function CoursePanel({ catalog, offerings, courseId, onSelect, onClose }) {
  if (!courseId) {
    return (
      <div className="panel-empty">
        <h2>Course details</h2>
        <p>Select a course to see its catalog description, what to take first, and what it opens up.</p>
        <p className="muted">Open an area first if you do not see any courses.</p>
      </div>
    );
  }
  const def = catalog.courses[courseId];
  const subject = SUBJECT_OF[courseId];
  const area = AREA_BY_ID[AREA_OF[courseId]];
  const needs = needText(catalog, courseId);
  const links = linksFor(catalog, courseId);
  const position = mapPositionOf(catalog, courseId);
  return (
    <div className="panel-body" style={{ '--c': `var(--g-${subject.css})` }}>
      <div className="panel-head">
        <div>
          <p className="panel-group"><span className="swatch" aria-hidden="true" />{subject.label}</p>
          <h2 id="course-title">{tileLabel(catalog, courseId)}</h2>
          <p className="panel-title">{def.title}</p>
        </div>
        <button type="button" className="btn btn-quiet btn-small panel-close" onClick={onClose} aria-label="Close course details">Close</button>
      </div>

      <dl className="facts">
        <div><dt>Credit hours</dt><dd>{hoursText(def)}{P.hasVariableCredits(def) ? ' a semester' : ''}{P.isRepeatable(def) ? ', repeatable' : ''}</dd></div>
        <div><dt>Runs in</dt><dd>{offeredText(catalog, offerings, courseId)}</dd></div>
        <div>
          <dt>Academic map</dt>
          <dd>{area.semesters && position !== null ? semesterLabel(position) : electiveNote(catalog, courseId)}</dd>
        </div>
      </dl>

      <section aria-labelledby="about-h">
        <h3 id="about-h">About this course</h3>
        <p>{def.description ?? 'Proposed course. Description coming soon.'}</p>
      </section>

      <section aria-labelledby="need-h">
        <h3 id="need-h">What you need first</h3>
        {needs.length === 0 ? <p>Nothing. You can take this course any semester it runs.</p> : needs.map((line) => <p key={line}>{line}</p>)}
        {links.needs.length > 0 && <Chips catalog={catalog} items={links.needs} onSelect={onSelect} label="Courses you need first" />}
      </section>

      <section aria-labelledby="open-h">
        <h3 id="open-h">What it opens up</h3>
        {links.opens.length === 0 ? <p>No other course needs this one.</p> : <Chips catalog={catalog} items={links.opens} onSelect={onSelect} label="Courses this one opens up" />}
      </section>
    </div>
  );
}
