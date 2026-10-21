import React from 'react';
import { timetable as TT } from '../lib/engine.js';
import { formatTime, DAY_NAMES } from '../lib/format.js';

const HOUR_H = 40;

/** A weekly calendar of one set of sections. A table of the same sections sits under it on the page. */
export default function WeekGrid({ option, colorOf }) {
  const meetings = option.choices.flatMap((c) => c.meetings.map((m) => ({ ...m, choice: c })));
  const hasSat = meetings.some((m) => m.days.includes('S'));
  const days = (hasSat ? 'MTWRFS' : 'MTWRF').split('');
  const mins = (hhmm) => TT.toMinutes(hhmm);
  const startHour = meetings.length ? Math.min(8, Math.floor(Math.min(...meetings.map((m) => mins(m.start))) / 60)) : 8;
  const endHour = meetings.length ? Math.max(17, Math.ceil(Math.max(...meetings.map((m) => mins(m.end))) / 60)) : 17;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  return (
    <div className="week" role="img" aria-label="Weekly calendar of these sections. The list under it gives the same information.">
      <div className="week-inner" style={{ '--days': days.length, '--hours': endHour - startHour, '--hour-h': `${HOUR_H}px` }}>
        <div className="week-head" />
        {days.map((d) => <div key={d} className="week-head">{DAY_NAMES[d]}</div>)}
        <div className="week-times">
          {hours.map((h) => (
            <span key={h} style={{ top: `${(h - startHour) * HOUR_H}px` }}>{formatTime(`${String(h).padStart(2, '0')}:00`).replace(':00', '')}</span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="week-col">
            {meetings.filter((m) => m.days.includes(d)).map((m, i) => {
              const top = ((mins(m.start) - startHour * 60) / 60) * HOUR_H;
              const height = Math.max(20, ((mins(m.end) - mins(m.start)) / 60) * HOUR_H - 2);
              return (
                <div key={`${m.choice.crn}-${i}`} className={`block c${colorOf[m.choice.course]}`} style={{ top, height }}>
                  <b>{m.choice.course}</b>
                  <span>{formatTime(m.start).replace(' ', '')}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
