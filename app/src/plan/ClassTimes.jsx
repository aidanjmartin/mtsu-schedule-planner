import React, { useEffect, useMemo, useState } from 'react';
import WeekGrid from '../components/WeekGrid.jsx';
import { loadSchedule } from '../lib/data.js';
import { classTimes, scheduleCandidates } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';
import { meetingText, plural, isNewCourse, newCourseTimesText } from '../lib/format.js';

/** Finds the class schedule to use for a planned semester: its own, or the same season in an earlier year. */
export function useClassTimes(catalog, result, scheduleTerms) {
  const target = result.terms[0]?.term ?? null;
  const [load, setLoad] = useState({ status: 'loading', schedule: null, used: null });
  useEffect(() => {
    let live = true;
    if (!target) { setLoad({ status: 'none', schedule: null, used: null }); return undefined; }
    setLoad({ status: 'loading', schedule: null, used: null });
    const options = scheduleCandidates(target).filter((t) => scheduleTerms.includes(t));
    (async () => {
      for (const term of options) {
        const schedule = await loadSchedule(term);
        if (schedule) { if (live) setLoad({ status: 'ready', schedule, used: term }); return; }
      }
      if (live) setLoad({ status: 'none', schedule: null, used: null });
    })();
    return () => { live = false; };
  }, [target, scheduleTerms]);

  const times = useMemo(
    () => (load.status === 'ready' ? classTimes(catalog, result, target, load.schedule) : null),
    [load, catalog, result, target],
  );
  return { target, load, times };
}

export function pickSummary(option) {
  const days = plural(option.campus_days, 'day');
  const early = option.early_classes === 0 ? 'no classes before 9:00 a.m.' : `${plural(option.early_classes, 'class', 'classes')} before 9:00 a.m.`;
  return `${days} on campus, ${early}`;
}

export default function ClassTimes({ catalog, result, info, pick, setPick }) {
  const { target, load, times } = info;
  if (!target) return null;
  const termName = T.termLabel(target);
  const colorOf = times ? Object.fromEntries(times.courses.map((c, i) => [c, (i % 8) + 1])) : {};

  return (
    <section className="results-section" aria-labelledby="times-h">
      <h2 id="times-h">Class times for {termName}</h2>

      {load.status === 'loading' && <p className="muted" role="status">Loading class times...</p>}
      {load.status === 'none' && (
        <div className="notice notice-info"><p>We do not have class times for {termName} yet. Check the university schedule when registration opens.</p></div>
      )}

      {load.status === 'ready' && load.used !== target && (
        <div className="notice notice-warn">
          <p><strong>{termName} classes are not published yet.</strong> These times come from {T.termLabel(load.used)}, the same semester one year earlier. Real times may change.</p>
        </div>
      )}

      {times && (() => {
        const fresh = times.no_sections.filter((n) => isNewCourse(catalog, n.course));
        const missing = times.no_sections.filter((n) => !isNewCourse(catalog, n.course));
        return (
          <>
            {fresh.length > 0 && (
              <div className="notice">
                <p>{newCourseTimesText(fresh.map((n) => n.course))}</p>
              </div>
            )}
            {missing.length > 0 && (
              <div className="notice notice-warn">
                <p>These courses have no sections in the schedule we used, so they are left out of the calendar:</p>
                <ul className="plain-list">{missing.map((n) => <li key={n.course}><strong>{n.course}</strong> {n.title}</li>)}</ul>
              </div>
            )}
          </>
        );
      })()}

      {times && times.options.length > 0 && (() => {
        const chosen = times.options[Math.min(pick, times.options.length - 1)];
        return (
          <>
            <p className="times-lead">
              This set of sections has no time overlaps. It uses {pickSummary(chosen).replace(/\.$/, '')}.
              {times.options.length > 1 ? ' Other sets that fit are listed below.' : ''}
            </p>
            <WeekGrid option={chosen} colorOf={colorOf} />
            <ul className="section-list">
              {chosen.choices.map((c) => (
                <li key={`${c.crn}`}>
                  <span className={`swatch-chip c${colorOf[c.course]}`} aria-hidden="true" />
                  <span className="section-main">
                    <strong>{c.course}</strong> {c.title}{c.component !== c.course ? ` (${c.component})` : ''}
                    <span className="section-meta">
                      Section {c.section}, CRN {c.crn}. {c.meetings.length ? c.meetings.map(meetingText).join('; ') : (c.online ? 'Online, no set time.' : 'Time to be announced.')}
                      {c.instructor ? ` ${c.instructor}.` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {times.options.length > 1 && (
              <details className="alt-times">
                <summary>Other section sets that fit ({times.options.length - 1})</summary>
                <ul className="alt-list">
                  {times.options.map((o, i) => (
                    <li key={o.choices.map((c) => c.crn).join('-')}>
                      <label className={`check${i === pick ? ' is-on' : ''}`}>
                        <input type="radio" name="timeset" checked={i === pick} onChange={() => setPick(i)} />
                        <span><strong>{i === 0 ? 'Best fit: ' : `Set ${i + 1}: `}</strong>{pickSummary(o)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        );
      })()}

      {times && times.options.length === 0 && times.conflicts.length > 0 && (
        <div className="notice notice-bad">
          <p><strong>No set of sections fits without overlaps.</strong></p>
          <ul className="plain-list">
            {times.conflicts.map((c) => <li key={c.courses.join('+')}>{c.courses.join(' and ')} overlap in every section.</li>)}
          </ul>
          <p>Ask your advisor which course to move to a different semester.</p>
        </div>
      )}
    </section>
  );
}
