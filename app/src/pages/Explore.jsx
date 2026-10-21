import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/DataContext.jsx';
import IrisCanvas from '../components/IrisCanvas.jsx';
import CoursePanel from '../components/CoursePanel.jsx';
import MapLegend from '../components/MapLegend.jsx';
import { AREAS, AREA_OF } from '../lib/exploreModel.js';

function useNarrow() {
  const query = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function Explore() {
  const { core } = useData();
  const { catalog, offerings } = core;
  const narrow = useNarrow();
  const [open, setOpen] = useState(() => new Set());
  const [selected, setSelected] = useState(null);

  const openArea = useCallback((id) => setOpen((cur) => (cur.has(id) ? cur : new Set([...cur, id]))), []);
  const closeArea = useCallback((id) => {
    setOpen((cur) => { const next = new Set(cur); next.delete(id); return next; });
    setSelected((cur) => (cur && AREA_OF[cur] === id ? null : cur));
  }, []);
  const openAll = useCallback(() => setOpen(new Set(AREAS.map((a) => a.id))), []);
  const closeAll = useCallback(() => { setOpen(new Set()); setSelected(null); }, []);

  // Selecting a course opens its area. Selecting the same course again clears the selection.
  const select = useCallback((id) => {
    if (!id) { setSelected(null); return; }
    openArea(AREA_OF[id]);
    setSelected((cur) => (cur === id ? null : id));
  }, [openArea]);
  const pick = useCallback((id) => { openArea(AREA_OF[id]); setSelected(id); }, [openArea]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allOpen = useMemo(() => open.size === AREAS.length, [open]);

  return (
    <div className="page explore">
      <div className="explore-head">
        <div>
          <h1>Course map</h1>
          <p className="lede">Open an area to see its courses. Select a course to see what it needs and what it opens up.</p>
        </div>
        <a className="btn btn-primary" href="#/plan">Plan my degree</a>
      </div>

      <div className="explore-body">
        <MapLegend narrow={narrow} />
        <section className="map-frame" aria-label="Course map">
          <IrisCanvas
            catalog={catalog} open={open} selected={selected} narrow={narrow} sheetOpen={Boolean(selected) && narrow} allOpen={allOpen}
            onOpen={openArea} onClose={closeArea} onSelect={select} onPick={pick} onOpenAll={openAll} onCloseAll={closeAll}
          />
        </section>
        <aside className={`side-panel${selected ? ' is-open' : ''}`} aria-label="Course details" aria-live="polite">
          <CoursePanel catalog={catalog} offerings={offerings} courseId={selected} onSelect={pick} onClose={() => setSelected(null)} />
        </aside>
      </div>
    </div>
  );
}
