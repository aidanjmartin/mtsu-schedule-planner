import React, { useMemo } from 'react';
import CourseChecklist from './CourseChecklist.jsx';
import { takingChoices, closeTaking, mapPosition, positionLabel } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';
import { tileLabel } from '../lib/courseGraph.js';

export default function StepTaking({ catalog, offerings, answers, setAnswers }) {
  const choices = useMemo(() => takingChoices(catalog, offerings, answers), [catalog, offerings, answers]);

  if (answers.firstSemester) {
    return (
      <div className="step-body">
        <div className="notice notice-info">
          <p><strong>We choose your first classes for you.</strong></p>
          <p>Your plan starts with {T.termLabel(choices.current)}, so it includes your first semester. You will see those classes on your plan.</p>
        </div>
      </div>
    );
  }

  const row = (c) => ({
    id: c.id, label: tileLabel(catalog, c.id), title: catalog.courses[c.id].title, credits: catalog.courses[c.id].credits,
    checked: answers.taking.includes(c.id), blocked: c.ok ? null : c.reasons[0],
  });
  const toggle = (id, on) => setAnswers((a) => {
    const next = on ? [...a.taking, id] : a.taking.filter((c) => c !== id);
    return { ...a, taking: closeTaking(catalog, a.finished, next) };
  });

  const groups = [];
  if (choices.onMap.length) groups.push({ label: `On the academic map for ${positionLabel(mapPosition(answers))}`, rows: choices.onMap.map(row) });
  if (choices.more.length) groups.push({ label: 'Other courses you can take this semester', rows: choices.more.map(row) });

  return (
    <div className="step-body">
      <p className="step-hint">
        We checked the courses the academic map places in {T.termLabel(choices.current)}. Adjust the list to match your schedule.
        Courses you take now count as finished when we plan your next semester.
      </p>
      {groups.length === 0
        ? <div className="notice notice-info"><p>No required courses are left for this semester. Continue to choose electives.</p></div>
        : <CourseChecklist groups={groups} onToggle={toggle} idPrefix="now" />}
    </div>
  );
}
