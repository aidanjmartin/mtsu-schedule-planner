import React from 'react';

/**
 * A checklist of courses in groups. `rows` is [{ id, title, credits, checked, blocked }], `blocked` being a
 * plain-language reason when the student cannot check the course.
 */
export default function CourseChecklist({ groups, onToggle, idPrefix }) {
  return (
    <div className="checklist">
      {groups.map((group) => (
        <fieldset key={group.label} className="check-group">
          <legend>{group.label}</legend>
          <ul>
            {group.rows.map((row) => (
              <li key={row.id}>
                <label className={`check-row${row.checked ? ' is-on' : ''}${row.blocked ? ' is-blocked' : ''}`}>
                  <input
                    type="checkbox" checked={row.checked} disabled={Boolean(row.blocked)}
                    id={`${idPrefix}-${row.id.replace(' ', '-')}`}
                    onChange={(e) => onToggle(row.id, e.target.checked)}
                  />
                  <span className="check-main">
                    <span className="check-name"><strong>{row.label ?? row.id}</strong> {row.title}</span>
                    {row.blocked && <span className="check-why">{row.blocked}</span>}
                  </span>
                  <span className="check-hr">{row.credits} hr</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
