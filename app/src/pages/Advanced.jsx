import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/DataContext.jsx';
import { loadSchedules } from '../lib/data.js';
import { terms as T, prereqs as P, validate as V, planner as PL, timetable as TT, whatif as W } from '../lib/engine.js';
import { storageGet, storageSet, storageRemove } from '../lib/storage.js';
import { plural, meetingText, formatTime } from '../lib/format.js';
import WeekGrid from '../components/WeekGrid.jsx';

// The program owner's tools: what-if edits with a baseline comparison, the critical path with slack,
// and full section timetables. They are plain on purpose.

const KEY = 'mtsu-mechatronics-advanced-v1';
const FIRST_START_TERM = '2026FA';
const TABS = [['plan', 'Plan'], ['critical', 'Critical path'], ['times', 'Class times'], ['whatif', 'What-if edits']];
const YEAR_NAMES = ['Freshman year', 'Sophomore year', 'Junior year', 'Senior year'];

const defaultState = () => ({
  start_term: FIRST_START_TERM, completed: [], in_progress: [], choices: {},
  options: { summer_allowed: false, max_credits: 18, summer_max_credits: 8, include_occasional: false, target_term: null },
  edits: [],
});

function readState() {
  const text = storageGet(KEY);
  if (!text) return defaultState();
  try {
    const raw = JSON.parse(text);
    const base = defaultState();
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    // A pick is a course id, or { course, hours } for a course whose hours the student chooses each semester.
    const picks = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || (x && typeof x.course === 'string')).map((x) => (typeof x === 'string' ? x : { course: x.course, hours: Array.isArray(x.hours) ? x.hours.filter(Number.isInteger) : undefined })) : []);
    const o = raw.options ?? {};
    return {
      start_term: typeof raw.start_term === 'string' && T.isTerm(raw.start_term) ? raw.start_term : base.start_term,
      completed: list(raw.completed), in_progress: list(raw.in_progress),
      choices: raw.choices && typeof raw.choices === 'object' ? Object.fromEntries(Object.entries(raw.choices).map(([k, v]) => [k, picks(v)])) : {},
      options: {
        ...base.options,
        max_credits: Number.isFinite(o.max_credits) && o.max_credits > 0 ? o.max_credits : base.options.max_credits,
        include_occasional: o.include_occasional === true,
        target_term: typeof o.target_term === 'string' && T.isTerm(o.target_term) ? o.target_term : null,
      },
      edits: Array.isArray(raw.edits) ? raw.edits.filter((e) => e && typeof e === 'object' && W.EDIT_TYPES.includes(e.type)) : [],
    };
  } catch {
    return defaultState();
  }
}

const termName = (t) => (t ? T.termLabel(t) : 'none');
/** A later semester of a repeatable course has an internal id such as "ENGR 3600#2". Show it in words. */
const unitName = (id) => id.replace(/#(\d+)/g, ' (semester $1)');
const label = (catalog, id) => (catalog.courses[id] ? `${id}  ${catalog.courses[id].title}` : id);

function Notice({ kind = 'info', children }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

function Delta({ delta }) {
  if (delta === null || delta === undefined) return null;
  if (delta === 0) return <span className="muted"> same as baseline</span>;
  return <span className={delta > 0 ? 'delta-up' : 'delta-down'}> {plural(Math.abs(delta), 'term')} {delta > 0 ? 'later' : 'earlier'} than baseline</span>;
}

function Table({ head, rows }) {
  return (
    <div className="table-scroll">
      <table className="adv-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ shared plan pieces

function UnplacedNotice({ plan }) {
  if (plan.unplaced.length === 0) return null;
  return (
    <Notice kind="bad">
      <p><strong>No graduation term: the plan cannot place every course.</strong></p>
      <ul>{plan.unplaced.map((u) => <li key={u.course}><strong>{unitName(u.course)}</strong>: {u.reason}</li>)}</ul>
      <p className="small">Change the start term, or check the course data and the what-if edits that affect these courses.</p>
    </Notice>
  );
}

function PlanSummary({ result, edited }) {
  const { scenario, diff } = result;
  const plan = scenario.plan;
  return (
    <div className="stat-row">
      <div className="stat">
        <div className="k">Projected graduation</div>
        <div className="v">{plan.graduation_term ? termName(plan.graduation_term) : 'Cannot finish'}</div>
        <div className="d">{plan.graduation_term ? `${plural(plan.terms.length, 'term')} from ${termName(plan.start_term)}` : 'See the notice above.'}{edited && <Delta delta={diff.graduation.delta_terms} />}</div>
      </div>
      {plan.milestones.map((m, i) => (
        <div className="stat" key={m.id}>
          <div className="k">{m.label} starts</div>
          <div className="v">{m.start_term ? termName(m.start_term) : m.status === 'done' ? 'Done' : 'Not planned'}</div>
          <div className="d">{m.courses.join(', ')}{edited && diff.milestones[i] && <Delta delta={diff.milestones[i].delta_terms} />}</div>
        </div>
      ))}
      <div className="stat">
        <div className="k">Credit hours left</div>
        <div className="v">{plan.remaining_hours}</div>
        <div className="d">including reserved general education</div>
      </div>
    </div>
  );
}

function Drivers({ plan }) {
  const chain = (title, steps) => (steps.length ? (
    <div key={title}>
      <h3>{title}</h3>
      <ol className="chain">
        {steps.map((s) => <li key={s.course}><strong>{unitName(s.course)}</strong> {termName(s.term)}<span className="why"> {PL.reasonText(s.reason)}</span></li>)}
      </ol>
    </div>
  ) : null);
  return (
    <section className="adv-panel">
      <h2>What sets the dates</h2>
      {plan.milestones.map((m) => chain(`Courses that set the ${m.label.toLowerCase()} start`, plan.drivers.milestones[m.id] ?? []))}
      {plan.drivers.graduation.set_by === 'courses'
        ? chain('Courses that set the graduation term', plan.drivers.graduation.chain)
        : plan.graduation_term ? <p>General education hours in {termName(plan.graduation_term)} set the graduation term.</p> : <p>No graduation term. The reasons are listed at the top of this tab.</p>}
    </section>
  );
}

function TermCard({ t, plan, basePlan }) {
  const starts = plan.milestones.filter((m) => m.start_term === t.term);
  return (
    <article className={`adv-term${starts.length ? ' milestone' : ''}`}>
      <header><h3>{t.label}</h3><span className="muted small">{t.credits} of {t.capacity} hours</span></header>
      {starts.map((m) => <p key={m.id} className="adv-tag">{m.label} starts</p>)}
      {t.courses.map((c) => {
        const meta = [];
        if (c.critical) meta.push('Critical: no room to slip.');
        else if (c.slack !== null && c.slack !== undefined) meta.push(`Can start up to ${plural(c.slack, 'term')} later.`);
        if (c.reason !== 'prerequisite' && c.reason !== 'in progress') meta.push(PL.reasonText(c.reason));
        if (c.added) meta.push('Added because another course needs it.');
        const was = basePlan.placements[c.course];
        if (was && was !== t.term) meta.push(`Baseline: ${termName(was)}.`);
        return (
          <div key={c.course} className={`adv-chip${c.critical ? ' crit' : ''}`}>
            <span><strong>{c.course}</strong> {c.title} <span className="muted small">{c.credits} hr</span></span>
            {meta.length > 0 && <span className="small muted">{meta.join(' ')}</span>}
          </div>
        );
      })}
      {t.placeholders.map((p) => (
        <div key={p.id ?? p.label} className="adv-chip reserve">
          <span>{p.label} <span className="muted small">{p.hours} hr</span></span>
          <span className="small muted">{p.moved_from ? `Reserved general education hours, moved from ${termName(p.moved_from)}.` : 'Reserved general education hours.'}</span>
        </div>
      ))}
    </article>
  );
}

// ------------------------------------------------------------------------ plan tab

/** The elective rule that counts hours: pick courses, and for a repeatable course the hours for each semester. */
function HoursChoice({ catalog, choice, state, update }) {
  const req = catalog.requirements.find((r) => r.id === choice.id);
  const picks = choice.picks;
  const check = P.checkHourPicks(catalog, req, picks);
  const hoursOf = (opt) => picks.find((p) => p.course === opt)?.hours ?? null;
  // Writing a pick keeps every other pick the planner is using, so one change never drops the rest.
  const write = (s, next) => { s.choices[choice.id] = next.map((p) => ({ course: p.course, hours: p.hours })); };
  return (
    <section className="adv-panel">
      <h2>Choose {choice.hours} hours: {choice.id}</h2>
      <p className="small muted">
        {check.total} of {choice.hours} hours chosen.
        {check.status === 'under' ? ` Choose ${choice.hours - check.total} more.` : ''}
        {check.status === 'over' ? ` That is ${check.total - choice.hours} too many.` : ''}
        {check.limits.map((l) => ` ${l.courses.join(' and ')} count for ${l.used} of at most ${l.max_hours} hours.`).join('')}
      </p>
      {choice.options.map((opt) => {
        const def = catalog.courses[opt];
        const hours = hoursOf(opt);
        const variable = P.hasVariableCredits(def);
        const { min, max } = P.creditRange(def);
        return (
          <div key={opt} className="adv-course-row">
            <input
              type="checkbox" checked={Boolean(hours)} aria-label={`${opt} chosen`}
              onChange={(e) => update((s) => {
                const rest = picks.filter((p) => p.course !== opt);
                write(s, e.target.checked ? [...rest, { course: opt, hours: [min] }] : rest);
              })}
            />
            <span><strong>{opt}</strong> {def.title}, {min === max ? `${min} hr` : `${min} to ${max} hr a semester`}</span>
            {hours && variable && hours.map((h, i) => (
              <label className="small adv-now" key={i}>
                Semester {i + 1}{' '}
                <input
                  className="input" type="number" min={min} max={max} value={h} style={{ width: '4.5rem' }}
                  aria-label={`${opt} hours in semester ${i + 1}`}
                  onChange={(e) => update((s) => write(s, picks.map((p) => (p.course === opt ? { ...p, hours: p.hours.map((x, j) => (j === i ? Math.min(max, Math.max(min, Number(e.target.value) || min)) : x)) } : p))))}
                />
              </label>
            ))}
            {hours && variable && P.isRepeatable(def) && (
              <>
                <button type="button" className="btn btn-small" onClick={() => update((s) => write(s, picks.map((p) => (p.course === opt ? { ...p, hours: [...p.hours, p.hours[p.hours.length - 1]] } : p))))}>Add a semester</button>
                {hours.length > 1 && (
                  <button type="button" className="btn btn-small" onClick={() => update((s) => write(s, picks.map((p) => (p.course === opt ? { ...p, hours: p.hours.slice(0, -1) } : p))))}>Remove a semester</button>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

function PlanTab({ catalog, offerings, state, update, result }) {
  const { scenario, baseline } = result;
  const plan = scenario.plan;
  const edited = state.edits.length > 0;
  const starts = T.termRange(FIRST_START_TERM, T.termFromIndex(T.termIndex(FIRST_START_TERM) + 11));
  const groups = useMemo(() => {
    const map = new Map();
    for (const id of Object.keys(catalog.courses)) {
      const pos = P.suggestedPositionOf(catalog, id);
      const key = pos === null ? 99 : Math.floor(pos / 3);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(id);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, ids]) => [
      k === 99 ? 'Other courses' : YEAR_NAMES[k] ?? `Year ${k + 1}`,
      ids.sort((a, b) => (P.suggestedPositionOf(catalog, a) ?? 99) - (P.suggestedPositionOf(catalog, b) ?? 99) || a.localeCompare(b)),
    ]);
  }, [catalog]);
  const setStatus = (id, status) => update((s) => {
    s.completed = s.completed.filter((c) => c !== id);
    s.in_progress = s.in_progress.filter((c) => c !== id);
    if (status === 'done') s.completed.push(id);
    if (status === 'now') s.in_progress.push(id);
  });
  const placeholders = (catalog.requirements ?? []).filter((r) => r.type === 'placeholder');

  return (
    <div className="adv-split">
      <div>
        <section className="adv-panel">
          <h2>Plan settings</h2>
          <div className="field">
            <label htmlFor="adv-start">First term to plan</label>
            <select id="adv-start" className="select" value={state.start_term} onChange={(e) => update((s) => { s.start_term = e.target.value; s.options.target_term = null; })}>
              {starts.map((t) => <option key={t} value={t}>{termName(t)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adv-max">Credit hour limit, fall and spring</label>
            <input id="adv-max" className="input" type="number" min="1" max="30" value={state.options.max_credits}
              onChange={(e) => update((s) => { s.options.max_credits = Math.max(1, Number(e.target.value) || 18); })} />
          </div>
          {offerings && (
            <label className="check">
              <input type="checkbox" checked={state.options.include_occasional} onChange={(e) => update((s) => { s.options.include_occasional = e.target.checked; })} />
              <span>Also use seasons when a course runs only some years</span>
            </label>
          )}
        </section>

        {plan.choices.map((c) => (c.hours ? (
          <HoursChoice key={c.id} catalog={catalog} choice={c} state={state} update={update} />
        ) : (
          <section className="adv-panel" key={c.id}>
            <h2>Choose {c.count}: {c.id}</h2>
            {c.options.map((opt) => (
              <label className="check" key={opt}>
                <input
                  type={c.count === 1 ? 'radio' : 'checkbox'} name={`choice-${c.id}`} checked={c.selected.includes(opt)}
                  onChange={(e) => update((s) => {
                    const current = s.choices[c.id] ?? c.selected;
                    if (c.count === 1) s.choices[c.id] = [opt];
                    else s.choices[c.id] = e.target.checked ? [...new Set([...current, opt])].slice(-c.count) : current.filter((x) => x !== opt);
                  })}
                />
                <span>{label(catalog, opt)}</span>
              </label>
            ))}
          </section>
        )))}

        {placeholders.length > 0 && (
          <section className="adv-panel">
            <h2>General education</h2>
            <p className="small muted">The planner reserves these hours. It does not schedule their sections. Check the ones finished.</p>
            {placeholders.map((p) => (
              <label className="check" key={p.id}>
                <input type="checkbox" checked={state.completed.includes(p.id)}
                  onChange={(e) => update((s) => { s.completed = e.target.checked ? [...s.completed, p.id] : s.completed.filter((c) => c !== p.id); })} />
                <span>{p.label} ({p.hours} hours)</span>
              </label>
            ))}
          </section>
        )}

        <section className="adv-panel">
          <h2>Courses finished</h2>
          <p className="small muted">Check each finished course. Check "Taking now" for courses in the first planned term.</p>
          <button type="button" className="btn btn-small" onClick={() => update((s) => { s.completed = []; s.in_progress = []; })}>Clear all</button>
          {groups.map(([name, ids]) => (
            <div key={name} className="adv-group">
              <h3>{name}</h3>
              {ids.map((id) => {
                const done = state.completed.includes(id);
                const now = state.in_progress.includes(id);
                return (
                  <div key={id} className="adv-course-row">
                    <input type="checkbox" checked={done} aria-label={`${id} finished`} onChange={(e) => setStatus(id, e.target.checked ? 'done' : 'todo')} />
                    <span><strong>{id}</strong> {catalog.courses[id].title}, {P.hasVariableCredits(catalog.courses[id]) ? `${P.creditRange(catalog.courses[id]).min} to ${P.creditRange(catalog.courses[id]).max}` : P.minCredits(catalog.courses[id])} hr</span>
                    {!done && (
                      <label className="small adv-now">
                        <input type="checkbox" checked={now} aria-label={`${id} taking now`} onChange={(e) => setStatus(id, e.target.checked ? 'now' : 'todo')} /> Taking now
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      </div>

      <div>
        <UnplacedNotice plan={plan} />
        <PlanSummary result={result} edited={edited} />
        {[...plan.warnings.filter((w) => !plan.unplaced.some((u) => w.startsWith(`${u.course} is not in the plan.`))), ...plan.assumptions].length > 0 && (
          <Notice kind="warn"><ul>{[...plan.warnings.filter((w) => !plan.unplaced.some((u) => w.startsWith(`${u.course} is not in the plan.`))), ...plan.assumptions].map((w) => <li key={w}>{unitName(w)}</li>)}</ul></Notice>
        )}
        <Drivers plan={plan} />
        <section className="adv-panel">
          <h2>Term by term</h2>
          <div className="adv-terms">{plan.terms.map((t) => <TermCard key={t.term} t={t} plan={plan} basePlan={baseline.plan} />)}</div>
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ critical path tab

function CriticalTab({ catalog, state, update, result }) {
  const [milestone, setMilestone] = useState('');
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const analysis = result.scenario.plan.analysis;
  const baseAnalysis = result.baseline.plan.analysis;
  const m = analysis.milestones[milestone] ? milestone : '';
  const slackOf = (a, id) => (m ? (a.milestones[m] && id in a.milestones[m].slack ? a.milestones[m].slack[id] : null) : a.courses[id]?.slack ?? null);
  const critical = (id) => (m ? !!analysis.milestones[m]?.critical.includes(id) : !!analysis.courses[id]?.critical);
  const words = (id) => {
    const info = analysis.courses[id];
    if (info.status === 'completed') return 'done';
    if (info.status === 'in_progress') return 'in progress';
    if (info.status === 'optional') return 'not selected';
    if (info.blocked) return 'blocked';
    const now = slackOf(analysis, id);
    if (now === null) return 'no link to target';
    const before = slackOf(baseAnalysis, id);
    return state.edits.length && before !== now ? `slack ${now} (was ${before ?? 'none'})` : `slack ${now}`;
  };
  const ids = Object.keys(catalog.courses)
    .filter((id) => !(hideDone && analysis.courses[id].status === 'completed') && !(onlyCritical && !critical(id)))
    .sort((a, b) => (P.suggestedPositionOf(catalog, a) ?? 99) - (P.suggestedPositionOf(catalog, b) ?? 99) || a.localeCompare(b));

  return (
    <section className="adv-panel">
      <h2>Critical path and slack</h2>
      <p className="small muted">
        Slack is the number of terms a course can start later than its earliest term without delaying graduation.
        Courses with zero slack are on the critical path: a delay in any of them delays graduation.
      </p>
      <div className="adv-row">
        <div className="field">
          <label htmlFor="adv-ms">Measure slack toward</label>
          <select id="adv-ms" className="select" value={m} onChange={(e) => setMilestone(e.target.value)}>
            <option value="">Graduation</option>
            {Object.entries(analysis.milestones).map(([id, ms]) => <option key={id} value={id}>{ms.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="adv-target">Graduation target</label>
          <select id="adv-target" className="select" value={state.options.target_term ?? ''} onChange={(e) => update((s) => { s.options.target_term = e.target.value || null; })}>
            <option value="">Earliest possible ({termName(analysis.finish_term)})</option>
            {analysis.terms.slice(0, 16).map((t) => <option key={t} value={t}>{termName(t)}</option>)}
          </select>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} /><span>Show only the critical path</span></label>
      <label className="check"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /><span>Hide finished courses</span></label>
      <Table
        head={['Course', 'Map term', 'Earliest', 'Latest', 'Slack', 'Critical']}
        rows={ids.map((id) => {
          const info = analysis.courses[id];
          return [
            <span key="c"><strong>{id}</strong> <span className="muted small">{catalog.courses[id].title}</span></span>,
            catalog.courses[id].suggested_term ? T.suggestedLabel(catalog.courses[id].suggested_term) : '',
            info.earliest_term ? termName(info.earliest_term) : '',
            info.latest_term ? termName(info.latest_term) : '',
            words(id),
            critical(id) && info.status === 'todo' ? 'Yes' : '',
          ];
        })}
      />
    </section>
  );
}

// -------------------------------------------------------------------- class times tab

function TimesTab({ catalog, result, schedules }) {
  const plan = result.scenario.plan;
  const [term, setTerm] = useState(null);
  const [pick, setPick] = useState(0);
  const withData = plan.terms.filter((t) => schedules[t.term]);
  const chosenTerm = term && plan.terms.some((t) => t.term === term) ? term : (withData[0] ?? plan.terms[0])?.term;
  if (!chosenTerm) return <section className="adv-panel"><p>The plan has no terms yet.</p></section>;
  const planned = plan.terms.find((t) => t.term === chosenTerm);
  const schedule = schedules[chosenTerm] ?? null;
  const t = schedule && planned.courses.length ? W.termTimetable({ plan, catalog: result.scenario.catalog, schedule, term: chosenTerm, limit: 12 }) : null;
  const pairs = t?.available ? TT.incompatiblePairs({ courses: t.courses, catalog: result.scenario.catalog, schedule }) : [];
  const colorOf = t ? Object.fromEntries(t.courses.map((c, i) => [c, (i % 8) + 1])) : {};
  const option = t?.options?.[Math.min(pick, (t.options.length || 1) - 1)];

  return (
    <section className="adv-panel">
      <h2>Section combinations for one term</h2>
      <p className="small muted">The planner tries every combination of sections for the courses planned in the term. It keeps combinations with no overlaps and ranks them by fewest days on campus, then fewest classes before 9:00 a.m.</p>
      <div className="field">
        <label htmlFor="adv-term">Term</label>
        <select id="adv-term" className="select" value={chosenTerm} onChange={(e) => { setTerm(e.target.value); setPick(0); }}>
          {plan.terms.slice(0, 10).map((x) => <option key={x.term} value={x.term}>{x.label}{schedules[x.term] ? '' : ' (no schedule data)'}</option>)}
        </select>
      </div>
      <p className="small muted">Courses planned: {planned.courses.map((c) => c.course).join(', ') || 'none'}</p>
      {!schedule && <Notice kind="warn"><p>There is no schedule data for {termName(chosenTerm)}. The university posts sections only for terms open for registration.</p></Notice>}
      {t && t.no_sections.length > 0 && (
        <Notice kind="warn">
          <p>These planned courses have no sections in the schedule for this term:</p>
          <ul>{t.no_sections.map((n) => <li key={n.course}>{n.course}: no sections for {n.missing.join(', ')}</li>)}</ul>
        </Notice>
      )}
      {option && (
        <>
          <h3>{pick === 0 ? 'Best combination' : `Combination ${pick + 1}`}</h3>
          <p>{plural(option.campus_days, 'day')} on campus, {plural(option.early_classes, 'class', 'classes')} before 9:00 a.m. {t.truncated ? '(search stopped early)' : `${t.total} fit${t.total === 1 ? 's' : ''} without overlaps.`}</p>
          <WeekGrid option={option} colorOf={colorOf} />
          <Table
            head={['Course', 'Section', 'CRN', 'When', 'Where', 'Instructor']}
            rows={option.choices.map((c) => [
              c.component, c.section, c.crn,
              c.meetings.length ? c.meetings.map(meetingText).join('; ') : (c.online ? 'Online, no set time' : 'Time to be announced'),
              [...new Set(c.meetings.map((m) => m.location).filter(Boolean))].join(', '), c.instructor,
            ])}
          />
          {t.options.length > 1 && (
            <>
              <h3>Other combinations</h3>
              {t.options.map((o, i) => (
                <label className="check" key={i}>
                  <input type="radio" name="adv-pick" checked={i === pick} onChange={() => setPick(i)} />
                  <span><strong>{i === 0 ? 'Best: ' : ''}{plural(o.campus_days, 'day')} on campus, {o.early_classes} before 9:00 a.m.</strong> <span className="small muted">{o.choices.map((c) => `${c.component} ${c.section}`).join(', ')}</span></span>
                </label>
              ))}
            </>
          )}
        </>
      )}
      {t && t.conflicts.length > 0 && (
        <>
          <h3>No combination fits</h3>
          {t.conflicts.map((c) => (
            <Notice kind="bad" key={c.courses.join('+')}>
              <p><strong>{c.courses.join(' and ')}</strong>: {c.reason}</p>
              {c.examples.length > 0 && <ul>{c.examples.map((e, i) => <li key={i}>{e.a.component} section {e.a.section} ({e.a.meetings.map(meetingText).join('; ')}) overlaps {e.b.component} section {e.b.section} ({e.b.meetings.map(meetingText).join('; ')}).</li>)}</ul>}
              <p><strong>What could move</strong></p>
              <ul>{c.resolutions.map((r) => <li key={r.course}><strong>{r.course}</strong>{r.can_move ? ` can move to ${termName(r.move_to)} without delaying graduation.` : ' cannot move without delaying graduation.'} {r.fits_without ? 'Everything else then fits.' : 'The remaining courses still conflict.'}</li>)}</ul>
            </Notice>
          ))}
        </>
      )}
      {pairs.length > 0 && (
        <>
          <h3>Course pairs that never fit together this term</h3>
          <p className="small muted">Every section of the first course overlaps every section of the second.</p>
          <ul>{pairs.map(([a, b]) => <li key={`${a}${b}`}>{a} and {b}</li>)}</ul>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------ what-if tab

function parsePrereqText(mode, text) {
  if (mode === 'none') return { value: null };
  const items = text.split(',').map((s) => s.trim()).filter(Boolean).map((token) => ({
    concurrent: /\(same term\)/i.test(token),
    course: token.replace(/\(same term\)/i, '').trim().toUpperCase().replace(/\s+/g, ' '),
  }));
  if (items.length === 0) return { error: 'List at least one course, or choose "No prerequisites".' };
  return { value: { [mode]: items.map((i) => (i.concurrent ? { course: i.course, concurrent_ok: true } : i.course)) }, courses: items.map((i) => i.course) };
}

function editDetail(edit, catalog) {
  if (edit.type === 'set_prereqs') return `New prerequisites: ${P.describePrereqs(edit.prereqs ?? null)}.`;
  if (edit.type === 'set_meeting_pattern') return `${termName(edit.term)}${edit.section ? `, section ${edit.section}` : ', all sections'}: ${edit.meetings.map(meetingText).join('; ') || 'no set meetings'}.`;
  if (edit.type === 'move_requirement') {
    const req = catalog.requirements.find((r) => r.id === edit.to);
    return req ? `${P.isChoice(req) ? 'It becomes one of the elective choices' : 'It becomes a required course'} (${edit.to}).` : '';
  }
  return '';
}

function EditForm({ catalog, result, schedules, onAdd }) {
  const ids = Object.keys(catalog.courses);
  const [d, setD] = useState({ type: 'set_seasons', course: ids.includes('ENGR 3530') ? 'ENGR 3530' : ids[0], mode: 'all', text: '', seasons: null, credits: null, to: null, term: null, section: '' });
  const [meetings, setMeetings] = useState([{ days: 'MWF', start: '09:00', end: '09:50' }]);
  const [error, setError] = useState('');
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const def = catalog.courses[d.course];
  const analysis = result.scenario.plan.analysis;
  const current = analysis.courses[d.course]?.seasons ?? [];
  const seasons = d.seasons ?? current;
  const targets = catalog.requirements.filter((r) => r.type === 'all' || P.isChoice(r));
  const termIds = [...new Set([...Object.keys(schedules), ...result.scenario.plan.terms.slice(0, 8).map((t) => t.term)])].sort(T.compareTerms);

  const add = () => {
    setError('');
    let edit;
    if (d.type === 'set_prereqs') {
      const parsed = parsePrereqText(d.mode, d.text);
      if (parsed.error) return setError(parsed.error);
      const unknown = (parsed.courses ?? []).filter((c) => !catalog.courses[c]);
      if (unknown.length) return setError(`These courses are not in the catalog: ${unknown.join(', ')}.`);
      edit = { type: 'set_prereqs', course: d.course, prereqs: parsed.value };
    } else if (d.type === 'set_seasons') {
      edit = { type: 'set_seasons', course: d.course, regular_seasons: seasons };
    } else if (d.type === 'set_credits') {
      const credits = d.credits ?? P.minCredits(def);
      if (!(credits > 0)) return setError('Enter a positive number of credit hours.');
      edit = { type: 'set_credits', course: d.course, credits };
    } else if (d.type === 'move_requirement') {
      edit = { type: 'move_requirement', course: d.course, to: d.to ?? targets[0]?.id };
    } else {
      if (meetings.some((m) => !m.days || !m.start || !m.end || m.end <= m.start)) return setError('Each meeting needs at least one day and an end time after its start time.');
      edit = { type: 'set_meeting_pattern', course: d.course, term: d.term ?? termIds[0], meetings: meetings.map((m) => ({ ...m })) };
      if (d.section.trim()) edit.section = d.section.trim();
    }
    return onAdd(edit);
  };

  return (
    <section className="adv-panel">
      <h3>Add an edit</h3>
      <div className="adv-row">
        <div className="field">
          <label htmlFor="ed-type">Kind of change</label>
          <select id="ed-type" className="select" value={d.type} onChange={(e) => { set({ type: e.target.value }); setError(''); }}>
            <option value="set_prereqs">Change prerequisites</option>
            <option value="set_seasons">Change offered seasons</option>
            <option value="set_credits">Change credit hours</option>
            <option value="move_requirement">Move between required and elective</option>
            <option value="set_meeting_pattern">Replace the meeting pattern</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ed-course">Course</label>
          <select id="ed-course" className="select" value={d.course} onChange={(e) => set({ course: e.target.value, seasons: null, credits: null })}>
            {ids.map((id) => <option key={id} value={id}>{label(catalog, id)}</option>)}
          </select>
        </div>
      </div>

      {d.type === 'set_prereqs' && (
        <>
          <p className="small muted">Current prerequisites: {P.describePrereqs(def.prereqs)}</p>
          <div className="field">
            <label htmlFor="ed-mode">The student needs</label>
            <select id="ed-mode" className="select" value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
              <option value="all">All of these courses</option>
              <option value="any">Any one of these courses</option>
              <option value="none">No prerequisites</option>
            </select>
          </div>
          {d.mode !== 'none' && (
            <div className="field">
              <label htmlFor="ed-text">Courses</label>
              <input id="ed-text" className="input" type="text" value={d.text} placeholder="MATH 1910, ENGR 2100 (same term)" onChange={(e) => set({ text: e.target.value })} />
              <span className="field-note">Separate courses with commas. Add "(same term)" after a course that may be taken at the same time.</span>
            </div>
          )}
        </>
      )}
      {d.type === 'set_seasons' && (
        <fieldset className="fieldset">
          <legend>The course runs in</legend>
          {['fall', 'spring', 'summer'].map((s) => (
            <label className="check" key={s}>
              <input type="checkbox" checked={seasons.includes(s)} onChange={(e) => set({ seasons: e.target.checked ? [...new Set([...seasons, s])] : seasons.filter((x) => x !== s) })} />
              <span>{s}</span>
            </label>
          ))}
          <span className="field-note">Now: {current.join(' and ') || 'no season'}.</span>
        </fieldset>
      )}
      {d.type === 'set_credits' && (
        <div className="field">
          <label htmlFor="ed-cr">Credit hours</label>
          <input id="ed-cr" className="input" type="number" min="1" max="12" value={d.credits ?? P.minCredits(def)} onChange={(e) => set({ credits: Number(e.target.value) })} />
        </div>
      )}
      {d.type === 'move_requirement' && (
        <div className="field">
          <label htmlFor="ed-mv">Move to</label>
          <select id="ed-mv" className="select" value={d.to ?? targets[0]?.id} onChange={(e) => set({ to: e.target.value })}>
            {targets.map((r) => <option key={r.id} value={r.id}>{P.isChoice(r) ? 'Elective choice' : 'Required'}: {r.id}</option>)}
          </select>
        </div>
      )}
      {d.type === 'set_meeting_pattern' && (
        <>
          <div className="adv-row">
            <div className="field">
              <label htmlFor="ed-term">Term</label>
              <select id="ed-term" className="select" value={d.term ?? termIds[0]} onChange={(e) => set({ term: e.target.value })}>
                {termIds.map((t) => <option key={t} value={t}>{termName(t)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ed-sec">Sections</label>
              <input id="ed-sec" className="input" type="text" value={d.section} placeholder="All sections" onChange={(e) => set({ section: e.target.value })} />
            </div>
          </div>
          <p className="label">New meetings</p>
          {meetings.map((m, i) => (
            <div className="meeting-row" key={i}>
              <span className="day-picks">
                {'MTWRFS'.split('').map((letter) => (
                  <label key={letter}>
                    <input type="checkbox" checked={m.days.includes(letter)} aria-label={`Day ${letter}`} onChange={(e) => {
                      const next = new Set(m.days.split(''));
                      if (e.target.checked) next.add(letter); else next.delete(letter);
                      setMeetings(meetings.map((x, j) => (j === i ? { ...x, days: [...next].sort((a, b) => 'MTWRFS'.indexOf(a) - 'MTWRFS'.indexOf(b)).join('') } : x)));
                    }} /> {letter}
                  </label>
                ))}
              </span>
              <input type="time" className="input" value={m.start} aria-label="Start time" onChange={(e) => setMeetings(meetings.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <span>to</span>
              <input type="time" className="input" value={m.end} aria-label="End time" onChange={(e) => setMeetings(meetings.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <button type="button" className="btn btn-small" disabled={meetings.length === 1} onClick={() => setMeetings(meetings.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button type="button" className="btn btn-small" onClick={() => setMeetings([...meetings, { days: 'MWF', start: '09:00', end: '09:50' }])}>Add a meeting</button>
          <p className="field-note">Letters: M Monday, T Tuesday, W Wednesday, R Thursday, F Friday, S Saturday. If the term has no section of this course, the edit adds one.</p>
        </>
      )}
      {error && <Notice kind="bad"><p>{error}</p></Notice>}
      <p><button type="button" className="btn btn-primary" onClick={add}>Add this edit</button></p>
    </section>
  );
}

function WhatIfTab({ catalog, state, update, result, schedules }) {
  const errors = new Map(result.edit_errors.map((e) => [e.position, e.message]));
  const edited = state.edits.length > 0;
  const base = result.baseline.plan;
  const alt = result.scenario.plan;
  const lines = edited ? W.summarizeDiff(result.diff) : [];
  const slack = edited ? result.diff.critical.slack_changes.filter((c) => c.from !== null || c.to !== null).slice(0, 40) : [];
  const moved = edited ? result.diff.moved.slice(0, 40) : [];
  const responsible = edited ? Object.entries(result.diff.responsible).flatMap(([key, list]) => list.map((r) => ({ key, ...r }))) : [];
  const meetingTerms = [...new Set(state.edits.filter((e) => e.type === 'set_meeting_pattern').map((e) => e.term))];
  const move = (i, by) => update((s) => { const j = i + by; [s.edits[j], s.edits[i]] = [s.edits[i], s.edits[j]]; });

  return (
    <>
      <section className="adv-panel">
        <h2>What-if edits</h2>
        <p className="small muted">Describe a change the department might make. Each edit applies on top of the ones above it. Results compare with the unchanged baseline.</p>
        {edited ? (
          <ol className="edit-list">
            {state.edits.map((edit, i) => (
              <li key={i} className={errors.get(i) ? 'bad' : ''}>
                <div>
                  <strong>{W.describeEdit(edit)}</strong>
                  <div className="small muted">{editDetail(edit, catalog)}</div>
                  {errors.get(i) && <div className="small">Skipped: {errors.get(i)}</div>}
                </div>
                <div className="adv-row-tight">
                  <button type="button" className="btn btn-small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move edit ${i + 1} up`}>Up</button>
                  <button type="button" className="btn btn-small" disabled={i === state.edits.length - 1} onClick={() => move(i, 1)} aria-label={`Move edit ${i + 1} down`}>Down</button>
                  <button type="button" className="btn btn-small" onClick={() => update((s) => { s.edits.splice(i, 1); })} aria-label={`Remove edit ${i + 1}`}>Remove</button>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="muted">No edits yet.</p>}
        <div className="adv-row-tight">
          {catalog.courses['ENGR 3530'] && (
            <button type="button" className="btn btn-small" onClick={() => update((s) => { s.edits.push({ type: 'set_seasons', course: 'ENGR 3530', regular_seasons: ['fall'] }); })}>Example: make ENGR 3530 fall only</button>
          )}
          {edited && <button type="button" className="btn btn-small" onClick={() => update((s) => { s.edits = []; })}>Remove all edits</button>}
        </div>
      </section>

      <EditForm catalog={catalog} result={result} schedules={schedules} onAdd={(edit) => update((s) => { s.edits.push(edit); })} />

      {!edited && <p className="muted">Add an edit to see how the critical path, the plan, and the timetable change.</p>}
      {edited && result.new_problems.length > 0 && (
        <Notice kind="bad"><p>These edits create problems in the catalog:</p><ul>{result.new_problems.map((p) => <li key={p.message}>{p.message}</li>)}</ul></Notice>
      )}
      {edited && (
        <section className="adv-panel">
          <h2>Difference from the baseline</h2>
          <UnplacedNotice plan={alt} />
          <PlanSummary result={result} edited />
          <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          <h3>Critical path</h3>
          <Table head={['', 'Courses']} rows={[
            ['Baseline', base.analysis.critical.map(unitName).join(', ') || 'None'],
            ['With your edits', alt.analysis.critical.map(unitName).join(', ') || 'None'],
            ['Joined', result.diff.critical.added.map(unitName).join(', ') || 'None'],
            ['Left', result.diff.critical.removed.map(unitName).join(', ') || 'None'],
          ]} />
          {slack.length > 0 && (<><h3>Slack that changed</h3><Table head={['Course', 'Baseline slack', 'New slack']} rows={slack.map((c) => [unitName(c.course), c.from === null ? 'none' : String(c.from), c.to === null ? 'none' : String(c.to)])} /></>)}
          {moved.length > 0 && (<><h3>Courses that moved</h3><Table head={['Course', 'Baseline', 'With your edits']} rows={moved.map((c) => [c.course, c.from ? termName(c.from) : 'not in plan', c.to ? termName(c.to) : 'not in plan'])} /></>)}
          {responsible.length > 0 && (
            <>
              <h3>Courses responsible for the delay</h3>
              <ul>{responsible.map((r, i) => <li key={i}><strong>{r.course}</strong> is in {termName(r.term)} in the {r.in_plan}{r.other_term ? ` and in ${termName(r.other_term)} in the other plan` : ' and not in the other plan'}. {PL.reasonText(r.reason)}</li>)}</ul>
            </>
          )}
        </section>
      )}
      {edited && meetingTerms.length > 0 && (
        <section className="adv-panel">
          <h2>Timetable impact</h2>
          {meetingTerms.map((term) => {
            const b = W.termTimetable({ plan: base, catalog: result.baseline.catalog, schedule: result.baseline.schedules[term] ?? null, term, limit: 3 });
            const a = W.termTimetable({ plan: alt, catalog: result.scenario.catalog, schedule: result.scenario.schedules[term] ?? null, term, limit: 3 });
            if (!b.available && !a.available) return <p key={term} className="muted">No schedule data for {termName(term)}, so there is nothing to compare.</p>;
            if (!b.available) return <p key={term} className="muted">The baseline has no schedule data for {termName(term)}.</p>;
            const dd = W.diffTimetables(b, a);
            const best = (x) => (x ? `${plural(x.campus_days, 'day')} on campus, ${plural(x.early_classes, 'class', 'classes')} before 9:00 a.m.` : 'no combination fits');
            return (
              <div key={term}>
                <h3>Compared with the baseline for {termName(term)}</h3>
                <Table head={['', 'Baseline', 'Changed']} rows={[
                  ['Combinations without overlaps', String(dd.total.base), String(dd.total.alt)],
                  ['Best combination', best(dd.best.base), best(dd.best.alt)],
                  ['Course pairs that conflict', dd.base_conflicts.map((c) => c.join(' + ')).join('; ') || 'None', dd.alt_conflicts.map((c) => c.join(' + ')).join('; ') || 'None'],
                ]} />
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------ page

export default function Advanced() {
  const { core } = useData();
  const { catalog, offerings, scheduleTerms } = core;
  const [state, setState] = useState(readState);
  const [tab, setTab] = useState('plan');
  const [schedules, setSchedules] = useState({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    loadSchedules(scheduleTerms).then((s) => { if (live) { setSchedules(s); setLoaded(true); } });
    return () => { live = false; };
  }, [scheduleTerms]);
  useEffect(() => { storageSet(KEY, JSON.stringify(state)); }, [state]);

  const update = (change) => setState((s) => { const next = structuredClone(s); change(next); return next; });
  const problems = useMemo(() => V.validateCatalog(catalog).errors, [catalog]);
  const result = useMemo(() => {
    try {
      return W.compareScenario({
        catalog, offerings, schedules,
        student: { start_term: state.start_term, completed: state.completed, in_progress: state.in_progress, choices: state.choices, options: { ...state.options } },
        edits: state.edits,
      });
    } catch (error) {
      return { error: error.message };
    }
  }, [catalog, offerings, schedules, state]);

  const reset = () => { storageRemove(KEY); setState(defaultState()); };

  return (
    <div className="page adv">
      <h1>Advanced tools</h1>
      <p className="lede">For the program owner. These tools test what-if changes to the catalog and show how the plan and the critical path respond. Students do not need them.</p>
      {problems.length > 0 && (
        <Notice kind="bad"><p>The {catalog.catalog_year} catalog file has {plural(problems.length, 'problem')}. Results may be wrong until it is fixed.</p><ul>{problems.slice(0, 5).map((p) => <li key={p.message}>{p.message}</li>)}</ul></Notice>
      )}
      {!offerings && <Notice kind="warn"><p>Offering data is missing, so the planner assumes every course runs in its suggested season.</p></Notice>}
      {loaded && Object.keys(schedules).length === 0 && <Notice kind="warn"><p>Schedule data is missing, so the class times tab cannot show section times.</p></Notice>}
      {state.edits.length > 0 && tab !== 'whatif' && (
        <Notice kind="info"><p>{plural(state.edits.length, 'what-if edit')} applied. Results compare with the unchanged baseline.</p></Notice>
      )}

      <div className="adv-tabs" role="tablist" aria-label="Advanced tools">
        {TABS.map(([id, name]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`adv-tab${tab === id ? ' is-on' : ''}`} onClick={() => setTab(id)}>{name}</button>
        ))}
        <button type="button" className="btn btn-quiet btn-small adv-reset" onClick={reset}>Reset these settings</button>
      </div>

      {result.error ? (
        <Notice kind="bad"><p>The planner stopped: {result.error}</p></Notice>
      ) : (
        <div role="tabpanel">
          {tab === 'plan' && <PlanTab catalog={catalog} offerings={offerings} state={state} update={update} result={result} />}
          {tab === 'critical' && <CriticalTab catalog={catalog} state={state} update={update} result={result} />}
          {tab === 'times' && <TimesTab catalog={catalog} result={result} schedules={schedules} />}
          {tab === 'whatif' && <WhatIfTab catalog={catalog} state={state} update={update} result={result} schedules={schedules} />}
        </div>
      )}
    </div>
  );
}
