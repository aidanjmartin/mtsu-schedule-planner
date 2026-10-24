import React, { useId, useMemo, useState } from 'react';
import { planForCheck, plannedCourses, moveTargets, moveCourse, applyFix, planChanges, checkChanges } from '../lib/planCheck.js';
import { plural } from '../lib/format.js';

/** One conflict: what is wrong, and each fix the checker confirmed, with a button that applies it. */
function ConflictCard({ conflict, onApply }) {
  const error = conflict.severity === 'error';
  return (
    <li className={`conflict notice ${error ? 'notice-bad' : 'notice-warn'}`}>
      <div className="conflict-head">
        <span className={`pill ${error ? 'pill-bad' : 'pill-warn'}`}>{error ? 'Conflict' : 'Warning'}</span>
        <h4>{conflict.title}</h4>
      </div>
      <p>{conflict.message}</p>
      {conflict.fixes.length > 0 ? (
        <>
          <p className="conflict-fix-lead">{conflict.fixes.length === 1 ? 'Fix' : 'Fixes'}, each checked against the whole plan:</p>
          <ul className="conflict-fixes">
            {conflict.fixes.map((f) => (
              <li key={f.text}>
                <span>{f.text}{f.partial ? ' This helps but does not clear the conflict.' : ''}</span>
                <button type="button" className={`btn btn-small${f.delays ? '' : ' btn-primary'}`} onClick={() => onApply(f.fix)}>
                  Apply fix
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="conflict-fix-lead">No single move clears this. Undo your change, or ask your advisor.</p>
      )}
    </li>
  );
}

/** The changed plan, one row per semester, with the courses that have a conflict marked. */
function ChangedPlan({ terms }) {
  return (
    <ol className="changed-plan" aria-label="Your changed plan">
      {terms.map((t) => (
        <li key={t.term} className={`changed-term is-${t.status}`}>
          <span className="changed-label">{t.label}</span>
          <span className="changed-courses">
            {t.courses.length === 0 && <span className="muted">No courses</span>}
            {t.courses.map((c) => (
              <span key={c.course} className={`chip${c.flagged ? ' is-flagged' : ''}`}>
                {c.course}{c.flagged && <span className="visually-hidden"> (has a conflict)</span>}
              </span>
            ))}
          </span>
          <span className="changed-hours">{t.hours} hr</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "Check a change." The student moves a course to another semester. The plan checker checks the whole plan and
 * lists each conflict with its fixes. Applying a fix updates the plan and checks it again.
 */
export default function CheckPlan({ catalog, offerings, result }) {
  const base = useMemo(() => planForCheck(result), [result]);
  const [plan, setPlan] = useState(base);
  const [course, setCourse] = useState('');
  const [to, setTo] = useState('');
  const ids = useId();

  // A new recommended plan (the student edited the answers) starts the check over.
  const [seen, setSeen] = useState(base);
  if (seen !== base) { setSeen(base); setPlan(base); setCourse(''); setTo(''); }

  const report = useMemo(() => checkChanges(catalog, offerings, plan), [catalog, offerings, plan]);
  const changes = useMemo(() => planChanges(base, plan), [base, plan]);
  const courses = useMemo(() => plannedCourses(plan), [plan]);
  const targets = useMemo(() => moveTargets(plan), [plan]);
  const current = courses.find((c) => c.course === course) ?? null;

  const move = (e) => {
    e.preventDefault();
    if (!current || !to || to === current.term) return;
    setPlan(moveCourse(plan, course, to));
    setCourse('');
    setTo('');
  };

  return (
    <section className="results-section check-plan" aria-labelledby="check-h">
      <h2 id="check-h">Check a change</h2>
      <p className="muted">
        Thinking about taking a course in a different semester? Move it here. We check the whole plan again and show each
        conflict with a fix you can apply. Your recommended plan above stays as it is.
      </p>

      <form className="move-form" onSubmit={move}>
        <div className="field">
          <label htmlFor={`${ids}-course`}>Course</label>
          <select id={`${ids}-course`} className="select" value={course} onChange={(e) => { setCourse(e.target.value); setTo(''); }}>
            <option value="">Choose a course</option>
            {courses.map((c) => <option key={c.course} value={c.course}>{c.course}, now {c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${ids}-to`}>Move to</label>
          <select id={`${ids}-to`} className="select" value={to} onChange={(e) => setTo(e.target.value)} disabled={!current}>
            <option value="">Choose a semester</option>
            {targets.filter((t) => t.term !== current?.term).map((t) => <option key={t.term} value={t.term}>{t.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={!current || !to}>Move course</button>
      </form>

      {changes.length > 0 && (
        <div className="check-changes">
          <h3>Your changes</h3>
          <ul className="plain-list">
            {changes.map((c) => <li key={c.course}>{c.course}: {c.fromLabel} to {c.toLabel}</li>)}
          </ul>
          <button type="button" className="btn btn-small" onClick={() => setPlan(base)}>Undo all changes</button>
        </div>
      )}

      <div className="check-result" role="status" aria-live="polite">
        {report.ok ? (
          <div className="notice notice-ok">
            <p>
              <strong>{changes.length ? 'No conflicts. This plan works.' : 'Your plan has no conflicts.'}</strong>{' '}
              Every course has its prerequisites, runs in its semester, and fits your credit load.
              {changes.length && report.lastLabel ? ` You graduate in ${report.lastLabel}.` : ''}
            </p>
          </div>
        ) : (
          <p className="check-count">
            <strong>{plural(report.conflicts.length, 'conflict')}</strong> to fix.
            {report.seniorDesign?.plannedLabel ? ` Senior design is planned for ${report.seniorDesign.plannedLabel}.` : ''}
          </p>
        )}
      </div>

      {report.conflicts.length > 0 && (
        <ul className="conflicts">
          {report.conflicts.map((c) => <ConflictCard key={c.id} conflict={c} onApply={(fix) => setPlan(applyFix(catalog, plan, fix))} />)}
        </ul>
      )}

      {changes.length > 0 && (
        <>
          <ChangedPlan terms={report.terms} />
          <p className="field-note">Hours include the room each semester keeps for general education.</p>
        </>
      )}
    </section>
  );
}
