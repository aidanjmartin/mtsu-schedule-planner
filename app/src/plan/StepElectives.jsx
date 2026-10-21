import React, { useMemo, useState } from 'react';
import { electiveCards, electiveStatus, electiveRequirement, runPlan, ELECTIVE_GROUPS, ELECTIVE_HOURS, seasonsText } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';

const hourWord = (n) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
const sum = (list) => list.reduce((a, b) => a + b, 0);

export default function StepElectives({ catalog, offerings, answers, setAnswers }) {
  const cards = useMemo(
    () => electiveCards(catalog, offerings, answers),
    // The cards depend on what the student has finished, not on which electives they picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, offerings, answers.finished, answers.taking, answers.firstSemester, answers.year, answers.season, answers.electivesDone, answers.load],
  );
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  // The semesters the plan schedules each chosen elective.
  const planned = useMemo(
    () => (answers.electives.length ? runPlan(catalog, offerings, answers, answers.load).raw : null),
    [catalog, offerings, answers],
  );
  const status = electiveStatus(catalog, answers);
  const req = electiveRequirement(catalog);
  const limit = req.limits?.[0] ?? null;
  const chosen = answers.electives;
  const hoursOf = (id) => answers.electiveHours?.[id] ?? [byId[id].range.min];
  const limitUsed = limit ? sum(chosen.filter((id) => limit.courses.includes(id)).map((id) => sum(hoursOf(id)))) : 0;
  const [notice, setNotice] = useState('');

  const limitWords = limit ? `${limit.courses.join(' and ')} can add up to ${hourWord(limit.max_hours)} together` : '';
  /** True when adding `extra` hours to the limited courses would go over the limit. Says why when it does. */
  const blocked = (id, extra) => {
    if (!limit || !limit.courses.includes(id) || limitUsed + extra <= limit.max_hours) return false;
    setNotice(`${limitWords}. You have chosen ${hourWord(limitUsed)}, so you cannot add ${extra === 1 ? 'another hour' : `${extra} more ${extra === 1 ? 'hour' : 'hours'}`}.`);
    return true;
  };

  const toggle = (id, on) => {
    setNotice('');
    if (on && blocked(id, byId[id].range.min)) return;
    setAnswers((a) => {
      if (on) {
        const hours = { ...a.electiveHours };
        if (byId[id].variable) hours[id] = [byId[id].range.min];
        return { ...a, electives: [...a.electives, id], electiveHours: hours };
      }
      const hours = { ...a.electiveHours };
      delete hours[id];
      return { ...a, electives: a.electives.filter((c) => c !== id), electiveHours: hours, electivesDone: a.electivesDone.filter((c) => c !== id) };
    });
  };
  const markDone = (id, on) => setAnswers((a) => ({
    ...a, electivesDone: on ? [...new Set([...a.electivesDone, id])] : a.electivesDone.filter((c) => c !== id),
  }));
  const setSemesterHours = (id, index, value) => {
    const now = hoursOf(id)[index];
    if (value > now && blocked(id, value - now)) return;
    setNotice('');
    setAnswers((a) => {
      const list = [...(a.electiveHours?.[id] ?? [value])];
      list[index] = value;
      return { ...a, electiveHours: { ...a.electiveHours, [id]: list } };
    });
  };
  const addSemester = (id) => {
    const list = hoursOf(id);
    const next = list[list.length - 1];
    if (blocked(id, next)) return;
    setNotice('');
    setAnswers((a) => ({ ...a, electiveHours: { ...a.electiveHours, [id]: [...(a.electiveHours?.[id] ?? list), next] } }));
  };
  const removeSemester = (id, index) => {
    setNotice('');
    setAnswers((a) => ({ ...a, electiveHours: { ...a.electiveHours, [id]: (a.electiveHours?.[id] ?? []).filter((_, i) => i !== index) } }));
  };

  const tone = status.ok ? 'is-ok' : status.status === 'over' || status.limits.some((l) => l.over) ? 'is-over' : 'is-under';

  return (
    <div className="step-body">
      <div className={`counter-bar ${tone}`} role="status" aria-live="polite">
        <span className="counter">{status.total} of {ELECTIVE_HOURS} hours chosen</span>
        <span className="counter-note">{status.message}</span>
      </div>
      <p className="hours-help">
        Choose {ELECTIVE_HOURS} hours of electives in any mix, such as three 3-hour courses and ENGR 4500.
      </p>
      {notice && <div className="notice notice-warn cap-notice" role="alert"><p>{notice}</p></div>}

      {ELECTIVE_GROUPS.map((group) => (
        <section key={group.id} className="career" style={{ '--g': `var(--g-${group.id})`, '--gbg': `var(--g-${group.id}-bg)` }}>
          <header className="career-head">
            <h3>{group.label}</h3>
            <p>{group.blurb}</p>
          </header>
          {group.id === 'internship' && limit && (
            <p className="limit-line" aria-live="polite">
              {limit.courses.join(' and ')} together count for at most {hourWord(limit.max_hours)}.
              {' '}You have chosen {hourWord(limitUsed)} of them.
            </p>
          )}
          <div className="cards">
            {group.courses.map((id) => {
              const c = byId[id];
              const on = chosen.includes(id);
              const done = answers.electivesDone.includes(id);
              const rows = on && c.variable ? hoursOf(id) : [];
              const enrollments = planned?.enrollments?.[id] ?? [];
              return (
                <div key={id} className={`elective${on ? ' is-on' : ''}`}>
                  <label className="elective-main">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(id, e.target.checked)} />
                    <span className="elective-text">
                      <span className="elective-title"><strong>{id}</strong> {c.title}</span>
                      <span className="elective-desc">{c.description}</span>
                      <span className="elective-facts">
                        <span><b>Credit hours:</b> {c.creditsText}{c.repeatable ? ', and you can take it again' : ''}</span>
                        <span><b>Runs in:</b> {seasonsText(c.seasons)}{catalog.courses[id].available_from ? `, starting ${T.termLabel(catalog.courses[id].available_from)}` : ''}</span>
                        <span><b>Requires:</b> {c.requires.length || c.standing ? [...c.requires, c.standing ? `${c.standing} standing.` : null].filter(Boolean).join(' ') : 'No other courses.'}</span>
                      </span>
                      {on && !c.variable && enrollments[0] && !done && (
                        <span className="elective-planned"><b>Planned for {T.termLabel(enrollments[0].term)}.</b></span>
                      )}
                      {!on && !c.canTakeNow && c.earliest && (
                        <span className="elective-later">
                          <b>You can't take this yet.</b> {c.reasons.join(' ')} The earliest semester for you is {T.termLabel(c.earliest)}.
                        </span>
                      )}
                    </span>
                  </label>

                  {on && c.variable && (
                    <div className="hours-rows" role="group" aria-label={`Hours for ${id} each semester`}>
                      {rows.map((hours, i) => (
                        <div className="hours-row" key={i}>
                          <fieldset className="hours-pick">
                            <legend>{rows.length > 1 ? `Semester ${i + 1}` : 'Hours this semester'}</legend>
                            {Array.from({ length: c.range.max - c.range.min + 1 }, (_, k) => c.range.min + k).map((h) => {
                              const would = limitUsed - hours + h;
                              const over = limit && limit.courses.includes(id) && would > limit.max_hours;
                              return (
                                <label key={h} className={`hours-opt${hours === h ? ' is-picked' : ''}${over ? ' is-blocked' : ''}`}>
                                  <input
                                    type="radio" name={`hours-${id}-${i}`} value={h} checked={hours === h}
                                    aria-disabled={over || undefined}
                                    onChange={() => setSemesterHours(id, i, h)}
                                  />
                                  <span>{h} hr</span>
                                </label>
                              );
                            })}
                          </fieldset>
                          <span className="hours-when">
                            {enrollments[i] ? <b>Planned for {T.termLabel(enrollments[i].term)}</b> : null}
                          </span>
                          {rows.length > 1 && (
                            <button type="button" className="btn btn-quiet btn-small" onClick={() => removeSemester(id, i)} aria-label={`Remove semester ${i + 1} of ${id}`}>Remove</button>
                          )}
                        </div>
                      ))}
                      {c.repeatable && (
                        <button type="button" className="btn btn-small" onClick={() => addSemester(id)} aria-disabled={limit && limit.courses.includes(id) && limitUsed + rows[rows.length - 1] > limit.max_hours ? true : undefined}>
                          Add another semester
                        </button>
                      )}
                    </div>
                  )}

                  {on && answers.year !== null && !c.variable && (
                    <label className="check elective-done">
                      <input type="checkbox" checked={done} onChange={(e) => markDone(id, e.target.checked)} />
                      <span>I already finished this elective</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
