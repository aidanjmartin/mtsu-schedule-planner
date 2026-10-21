import React, { useMemo } from 'react';
import { electiveCards, runPlan, ELECTIVE_GROUPS, ELECTIVE_COUNT, seasonsText } from '../lib/planModel.js';
import { terms as T } from '../lib/engine.js';

export default function StepElectives({ catalog, offerings, answers, setAnswers }) {
  const cards = useMemo(
    () => electiveCards(catalog, offerings, answers),
    // The cards depend on what the student has finished, not on which electives they picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, offerings, answers.finished, answers.taking, answers.firstSemester, answers.year, answers.season, answers.electivesDone, answers.load],
  );
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  // The semester the plan schedules each chosen elective.
  const placements = useMemo(
    () => (answers.electives.length ? runPlan(catalog, offerings, answers, answers.load).raw.placements : {}),
    [catalog, offerings, answers],
  );
  const chosen = answers.electives;
  const full = chosen.length >= ELECTIVE_COUNT;

  const toggle = (id, on) => setAnswers((a) => {
    if (on) {
      if (a.electives.length >= ELECTIVE_COUNT) return a;
      return { ...a, electives: [...a.electives, id] };
    }
    return { ...a, electives: a.electives.filter((c) => c !== id), electivesDone: a.electivesDone.filter((c) => c !== id) };
  });
  const markDone = (id, on) => setAnswers((a) => ({
    ...a, electivesDone: on ? [...new Set([...a.electivesDone, id])] : a.electivesDone.filter((c) => c !== id),
  }));

  return (
    <div className="step-body">
      <div className="counter-bar" role="status" aria-live="polite">
        <span className="counter">{chosen.length} of {ELECTIVE_COUNT} chosen</span>
        <span className="counter-note">
          {full ? 'You have chosen all three. Remove one to pick a different elective.' : `Choose ${ELECTIVE_COUNT - chosen.length} more.`}
        </span>
      </div>

      {ELECTIVE_GROUPS.map((group) => (
        <section key={group.id} className="career" style={{ '--g': `var(--g-${group.id})`, '--gbg': `var(--g-${group.id}-bg)` }}>
          <header className="career-head">
            <h3>{group.label}</h3>
            <p>{group.blurb}</p>
          </header>
          <div className="cards">
            {group.courses.map((id) => {
              const c = byId[id];
              const on = chosen.includes(id);
              const locked = full && !on;
              return (
                <div key={id} className={`elective${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}>
                  <label className="elective-main">
                    <input type="checkbox" checked={on} disabled={locked} onChange={(e) => toggle(id, e.target.checked)} />
                    <span className="elective-text">
                      <span className="elective-title"><strong>{id}</strong> {c.title}</span>
                      <span className="elective-desc">{c.description}</span>
                      <span className="elective-facts">
                        <span><b>Runs in:</b> {seasonsText(c.seasons)}{catalog.courses[id].available_from ? `, starting ${T.termLabel(catalog.courses[id].available_from)}` : ''}</span>
                        <span><b>Requires:</b> {c.requires.length || c.standing ? [...c.requires, c.standing ? `${c.standing} standing.` : null].filter(Boolean).join(' ') : 'No other courses.'}</span>
                      </span>
                      {on && placements[id] && !answers.electivesDone.includes(id) && (
                        <span className="elective-planned"><b>Planned for {T.termLabel(placements[id])}.</b></span>
                      )}
                      {!on && !c.canTakeNow && c.earliest && (
                        <span className="elective-later">
                          <b>You can't take this yet.</b> {c.reasons.join(' ')} The earliest semester for you is {T.termLabel(c.earliest)}.
                        </span>
                      )}
                      {locked && <span className="elective-locked">Remove another elective to choose this one.</span>}
                    </span>
                  </label>
                  {on && answers.year !== null && (
                    <label className="check elective-done">
                      <input type="checkbox" checked={answers.electivesDone.includes(id)} onChange={(e) => markDone(id, e.target.checked)} />
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
