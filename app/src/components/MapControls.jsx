import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchCourses, SUBJECT_OF, AREA_BY_ID, AREA_OF } from '../lib/exploreModel.js';
import { tileLabel } from '../lib/courseGraph.js';

const ICONS = {
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  fit: <path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4" />,
  search: <><circle cx="8.6" cy="8.6" r="5" /><path d="M12.4 12.4L17 17" /></>,
  help: <><circle cx="10" cy="10" r="7.4" /><path d="M7.9 7.9a2.2 2.2 0 1 1 3.1 2c-.7.4-1 .8-1 1.5" /><path d="M10 14.2v.2" /></>,
};

function Icon({ name }) {
  return <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className="ctl-icon">{ICONS[name]}</svg>;
}

function SearchPanel({ catalog, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();
  const results = useMemo(() => searchCourses(catalog, query), [catalog, query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const pick = (id) => { onPick(id); onClose(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active].id); }
    else if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  };

  return (
    <div className="ctl-panel ctl-search" role="dialog" aria-label="Search courses">
      <label className="visually-hidden" htmlFor={`${listId}-in`}>Search by course number or title</label>
      <input
        id={`${listId}-in`} ref={inputRef} className="ctl-input" type="search" value={query} autoComplete="off" spellCheck="false"
        placeholder="Course number or title" role="combobox" aria-expanded={results.length > 0} aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
      />
      {query.trim() && results.length === 0 && <p className="ctl-empty">No course matches. Try a number such as 3540.</p>}
      {results.length > 0 && (
        <ul id={listId} className="ctl-results" role="listbox" aria-label="Matching courses">
          {results.map((r, i) => {
            const area = AREA_BY_ID[AREA_OF[r.id]];
            return (
              <li key={r.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => pick(r.id)}>
                  <span className="ctl-swatch" style={{ background: `var(--g-${SUBJECT_OF[r.id].css})` }} aria-hidden="true" />
                  <span className="ctl-result-main"><strong>{tileLabel(catalog, r.id)}</strong> {r.title}</span>
                  <span className="ctl-result-area">{area.label[0].text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HelpPanel({ onClose, view }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div
      className="ctl-panel ctl-help" role="dialog" aria-label="How to use the course map" tabIndex={-1} ref={ref}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="ctl-help-head">
        <h2>How to use the map</h2>
        <button type="button" className="ctl-x" onClick={onClose} aria-label="Close help">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </div>
      {view === 'term' ? (
        <ol>
          <li><strong>Read left to right.</strong> Each column is a semester on the academic map, from Year 1 Fall to Year 4 Spring. Elective options sit below the line in their column.</li>
          <li><strong>Select a course.</strong> Solid lines lead back to the courses it needs. Dashed lines lead on to the courses it opens up. Other courses fade.</li>
          <li><strong>Read the details.</strong> The panel shows the catalog description and what to take first. Select a linked course to follow the chain.</li>
          <li><strong>Move around.</strong> Drag to move the map. Scroll, pinch, or use the plus and minus buttons to zoom. The corner button fits everything on screen.</li>
        </ol>
      ) : view === 'flow' ? (
        <ol>
          <li><strong>Find a course.</strong> Every course is a tile, grouped by subject. Elective areas sit in dashed boxes.</li>
          <li><strong>Select a course.</strong> Solid lines lead back to the courses it needs. Dashed lines lead on to the courses it opens up.</li>
          <li><strong>Read the details.</strong> The panel shows the catalog description and what to take first. Select a linked course to follow the chain.</li>
          <li><strong>Move around.</strong> Drag to move the chart. Scroll, pinch, or use the plus and minus buttons to zoom. The corner button fits everything on screen.</li>
        </ol>
      ) : (
      <ol>
        <li><strong>Open an area.</strong> Click a circle and its courses spread into a ring. Open as many as you like.</li>
        <li><strong>Select a course.</strong> It moves to the middle of its ring. Dashed arrows point to the courses it needs and the courses it opens up.</li>
        <li><strong>Read the details.</strong> The panel shows the catalog description and what to take first. Select a linked course to follow the chain.</li>
        <li><strong>Move around.</strong> Drag to move the map. Scroll, pinch, or use the plus and minus buttons to zoom. The corner button fits everything on screen.</li>
      </ol>
      )}
    </div>
  );
}

/** Zoom, fit, search, and help, stacked at the bottom right of the map or chart. */
export default function MapControls({ catalog, api, onPick, view = 'circle' }) {
  const [panel, setPanel] = useState(null);
  const toggle = (name) => setPanel((p) => (p === name ? null : name));
  const buttons = [
    ['plus', 'Zoom in', api.zoomIn], ['minus', 'Zoom out', api.zoomOut], ['fit', 'Fit to screen', api.fit],
  ];
  return (
    <div className="iris-controls">
      {panel === 'search' && <SearchPanel catalog={catalog} onPick={onPick} onClose={() => setPanel(null)} />}
      {panel === 'help' && <HelpPanel onClose={() => setPanel(null)} view={view} />}
      <div className="ctl-stack" role="group" aria-label={view === 'circle' ? 'Map controls' : 'Chart controls'}>
        {buttons.map(([icon, label, run]) => (
          <button key={icon} type="button" className="ctl" onClick={run} aria-label={label} title={label}><Icon name={icon} /></button>
        ))}
        <span className="ctl-rule" aria-hidden="true" />
        <button type="button" className={`ctl${panel === 'search' ? ' is-on' : ''}`} aria-label="Search courses" title="Search courses" aria-expanded={panel === 'search'} onClick={() => toggle('search')}><Icon name="search" /></button>
        <button type="button" className={`ctl${panel === 'help' ? ' is-on' : ''}`} aria-label="Help" title="Help" aria-expanded={panel === 'help'} onClick={() => toggle('help')}><Icon name="help" /></button>
      </div>
    </div>
  );
}
