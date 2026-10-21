import React, { useMemo, useState } from 'react';
import { computeResult, LOADS } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';
import ClassTimes, { useClassTimes } from './ClassTimes.jsx';
import { listText, plural } from '../lib/format.js';

const STATUS = {
  'on-track': { label: 'On track', pill: 'pill-ok' },
  attention: { label: 'Needs attention', pill: 'pill-warn', text: 'Read the notes below before you register.' },
  delayed: { label: 'Delayed', pill: 'pill-bad', text: 'Your plan finishes later than the academic map.' },
};

function Summary({ result, answers }) {
  const status = STATUS[result.status];
  const sd = result.seniorDesign;
  // The academic map statement appears only when every remaining course sits in its map semester.
  const note = result.status === 'on-track' ? (result.matchesMap ? 'Your plan matches the academic map.' : '') : status.text;
  return (
    <section className="summary" aria-labelledby="summary-h">
      <div className="summary-top">
        <h2 id="summary-h">Your plan at a glance</h2>
        <span className={`pill ${status.pill}`}>{status.label}</span>
      </div>
      <div className="titleblock">
        <div className="tb-cell tb-big">
          <span className="tb-label">You graduate</span>
          <span className="tb-value">{result.graduationLabel ?? 'Not yet known'}</span>
          <span className="tb-note">
            {result.graduation ? `${plural(result.terms.length + (result.inProgress ? 1 : 0), 'semester')} from ${result.inProgress ? result.inProgress.label : result.terms[0]?.label}` : 'Some courses do not fit yet.'}
          </span>
        </div>
        <div className="tb-cell tb-big">
          <span className="tb-label">Senior design starts</span>
          <span className="tb-value">{sd ? sd.startLabel : 'Not yet known'}</span>
          <span className="tb-note">{sd ? `ENGR 4580 in ${sd.startLabel}, then ENGR 4590 in ${sd.endLabel}` : 'We could not place ENGR 4580.'}</span>
        </div>
        <div className="tb-cell">
          <span className="tb-label">Your electives</span>
          <span className="tb-text">{result.electives.length ? result.electives.map((id) => <span key={id} className="tb-line">{id}</span>) : 'None chosen'}</span>
        </div>
        <div className="tb-cell">
          <span className="tb-label">Credit load</span>
          <span className="tb-text">{LOADS[result.loadKey].label}</span>
          <span className="tb-note">{LOADS[result.loadKey].range} a semester</span>
        </div>
      </div>
      {note && <p className="summary-note">{note}</p>}
    </section>
  );
}

function Alerts({ result }) {
  if (result.alerts.length === 0) return null;
  const klass = { bad: 'notice-bad', warn: 'notice-warn', info: 'notice-info' };
  return (
    <section className="results-section" aria-labelledby="alerts-h">
      <h2 id="alerts-h">Things to know</h2>
      {result.alerts.map((a) => (
        <div key={a.text} className={`notice ${klass[a.severity] ?? 'notice-info'}`} role={a.severity === 'bad' ? 'alert' : undefined}>
          <p>{a.text}</p>
        </div>
      ))}
    </section>
  );
}

function CourseRow({ c }) {
  const senior = c.kind === 'senior-design';
  return (
    <li className={`sem-course${senior ? ' is-senior' : ''}`}>
      <span className="sem-id">{c.course}</span>
      <span className="sem-title">{c.title}{senior && <span className="tag-senior">Senior design</span>}</span>
      <span className="sem-hr">{c.credits} hr</span>
    </li>
  );
}

function SemesterCard({ term, last, inProgress }) {
  const hasSenior = term.courses.some((c) => c.kind === 'senior-design');
  return (
    <article className={`semester${hasSenior ? ' has-senior' : ''}${inProgress ? ' is-current' : ''}`}>
      <header className="semester-head">
        <h3>{term.label}</h3>
        <span className="semester-hours">{term.hours} hours</span>
      </header>
      {inProgress && <p className="semester-tag">You are taking these now</p>}
      {last && !inProgress && <p className="semester-tag">Last semester</p>}
      <ul className="sem-list">{term.courses.map((c) => <CourseRow key={c.course} c={c} />)}</ul>
      {!inProgress && (
        <p className={`open-hours${term.open === 0 ? ' is-none' : ''}`}>
          {term.open === 0 ? 'No open hours for general education' : `${term.open} open hours for general education`}
        </p>
      )}
    </article>
  );
}

export default function Results({ catalog, offerings, scheduleTerms, answers, onEdit, onStartOver }) {
  const result = useMemo(
    () => computeResult(catalog, offerings, answers),
    [catalog, offerings, answers],
  );
  const info = useClassTimes(catalog, result, scheduleTerms);
  const [pick, setPick] = useState(0);
  const [name, setName] = useState('');
  const [exporting, setExporting] = useState('idle');
  const [confirm, setConfirm] = useState(false);

  const exportPdf = async () => {
    setExporting('working');
    try {
      const { downloadPlanPdf } = await import('./exportPdf.js');
      const chosen = info.times?.options?.[Math.min(pick, (info.times.options.length || 1) - 1)] ?? null;
      await downloadPlanPdf({
        catalog, answers, result, name: name.trim(),
        classTimes: info.times ? { term: info.target, used: info.load.used, option: chosen, noSections: info.times.no_sections } : null,
      });
      setExporting('done');
    } catch (error) {
      console.error(error);
      setExporting('error');
    }
  };

  const genEd = result.genEd;
  return (
    <div className="results">
      <Summary result={result} answers={answers} />
      <Alerts result={result} />

      <section className="results-section" aria-labelledby="sems-h">
        <h2 id="sems-h">Semester by semester</h2>
        <p className="muted">
          Each semester leaves room for general education courses, so you can add them as you register.
          {genEd.remaining > 0 ? ` You still need about ${genEd.remaining} hours of general education. Your plan leaves ${genEd.open} open hours.` : ''}
        </p>
        <div className="semesters">
          {result.inProgress && <SemesterCard term={result.inProgress} inProgress />}
          {result.terms.map((t, i) => <SemesterCard key={t.term} term={t} last={i === result.terms.length - 1} />)}
        </div>
      </section>

      <ClassTimes catalog={catalog} result={result} info={info} pick={pick} setPick={setPick} />

      <section className="results-section actions" aria-labelledby="export-h">
        <h2 id="export-h">Save your plan</h2>
        <div className="field name-field">
          <label htmlFor="prepared-for">Name for the PDF (optional)</label>
          <input id="prepared-for" className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} />
          <span className="field-note">We print this on the first page as "Prepared for." We never save or send it.</span>
        </div>
        <div className="action-row">
          <button type="button" className="btn btn-primary" onClick={exportPdf} disabled={exporting === 'working'}>
            {exporting === 'working' ? 'Making your PDF...' : 'Export PDF'}
          </button>
          <button type="button" className="btn" onClick={onEdit}>Edit answers</button>
          {!confirm ? (
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(true)}>Start over</button>
          ) : (
            <span className="confirm-row" role="alert">
              <span>Clear all your answers?</span>
              <button type="button" className="btn btn-small" onClick={onStartOver}>Yes, start over</button>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirm(false)}>Keep my answers</button>
            </span>
          )}
        </div>
        <p className="field-note" role="status" aria-live="polite">
          {exporting === 'done' && 'Your PDF downloaded.'}
          {exporting === 'error' && 'We could not make the PDF. Try again, or take a screenshot of this page.'}
        </p>
      </section>
    </div>
  );
}
