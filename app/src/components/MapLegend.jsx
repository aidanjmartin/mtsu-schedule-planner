import React from 'react';

const CORE = [['math', 'Math & Science'], ['found', 'Foundations'], ['mech', 'Mechanics'], ['circ', 'Circuits & Automation'], ['ctrl', 'Controls'], ['senior', 'Senior Design']];
const ELECTIVE = [['systems', 'Systems & Management'], ['robotics', 'Robotics & Embedded'], ['advanced', 'Advanced Study'], ['internship', 'Internship & Research']];

export default function MapLegend() {
  return (
    <div className="legend" aria-label="How to read the map">
      <ul className="legend-lines">
        <li><svg width="40" height="12" aria-hidden="true"><line x1="2" y1="6" x2="38" y2="6" className="lg-solid" /></svg>A course you need first</li>
        <li><svg width="40" height="12" aria-hidden="true"><line x1="2" y1="6" x2="38" y2="6" className="lg-dash" /></svg>A course it opens up</li>
      </ul>
      <ul className="legend-groups">
        {CORE.map(([k, label]) => (
          <li key={k}><span className="dot" style={{ background: `var(--g-${k})` }} aria-hidden="true" />{label}</li>
        ))}
      </ul>
      <ul className="legend-groups">
        <li className="legend-label">Electives (choose 3 of 8):</li>
        {ELECTIVE.map(([k, label]) => (
          <li key={k}><span className="dot dot-elective" style={{ '--c': `var(--g-${k})` }} aria-hidden="true" />{label}</li>
        ))}
      </ul>
    </div>
  );
}
