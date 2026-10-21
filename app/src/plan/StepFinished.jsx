import React, { useMemo, useState } from 'react';
import CourseChecklist from './CourseChecklist.jsx';
import { semesterGroups, requiredCourses, closeFinished, closeTaking, mapPosition, positionLabel } from '../lib/planModel.js';
import { prereqs as P } from '../lib/engine.js';
import { listText } from '../lib/format.js';
import { tileLabel } from '../lib/courseGraph.js';

export default function StepFinished({ catalog, answers, setAnswers }) {
  const [message, setMessage] = useState('');
  const required = useMemo(() => requiredCourses(catalog), [catalog]);
  const groups = useMemo(() => semesterGroups(catalog, required).map((g) => ({
    label: g.label,
    rows: g.courses.map((id) => ({
      id, label: tileLabel(catalog, id), title: catalog.courses[id].title, credits: catalog.courses[id].credits,
      checked: answers.finished.includes(id),
    })),
  })), [catalog, required, answers.finished]);

  const toggle = (id, on) => {
    setAnswers((a) => {
      let finished = a.finished;
      let note = '';
      if (on) {
        const needed = [...P.ancestorsOf(catalog, id)].filter((c) => required.includes(c) && !finished.includes(c));
        finished = [...finished, id, ...needed];
        if (needed.length) note = `We also checked ${listText(needed)}, because you need ${needed.length === 1 ? 'it' : 'them'} before ${id}.`;
      } else {
        const closed = closeFinished(catalog, finished.filter((c) => c !== id));
        const dropped = closed.removed;
        finished = [...closed];
        if (dropped.length) note = `We also unchecked ${listText(dropped)}, because ${dropped.length === 1 ? 'it needs' : 'they need'} ${id}.`;
      }
      setMessage(note);
      const wasTaking = a.taking.filter((c) => !finished.includes(c));
      const taking = closeTaking(catalog, finished, wasTaking);
      const lost = wasTaking.filter((c) => !taking.includes(c));
      if (lost.length) {
        note = `${note ? `${note} ` : ''}We also removed ${listText(lost)} from this semester, because ${lost.length === 1 ? 'it needs' : 'they need'} a course you have not finished.`;
        setMessage(note);
      }
      return { ...a, finished, taking };
    });
  };

  const position = mapPosition(answers);
  return (
    <div className="step-body">
      <p className="step-hint">
        {answers.firstSemester
          ? 'You are starting your first semester, so we left every course unchecked. Check any course you already have credit for, such as an AP or dual enrollment course.'
          : `We checked the courses most students have finished by now (before ${positionLabel(position)}). Uncheck any you haven't taken.`}
      </p>
      <p className="step-aside" role="status" aria-live="polite">{message}</p>
      <CourseChecklist groups={groups} onToggle={toggle} idPrefix="fin" />
    </div>
  );
}
