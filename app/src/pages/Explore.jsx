import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../lib/DataContext.jsx';
import CourseMap from '../components/CourseMap.jsx';
import CoursePanel from '../components/CoursePanel.jsx';
import MapLegend from '../components/MapLegend.jsx';

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
  const [selected, setSelected] = useState(null);
  const sheetRef = useRef(null);
  const frameRef = useRef(null);

  const select = useCallback((id) => setSelected((cur) => (cur === id ? null : id)), []);
  const pick = useCallback((id) => setSelected(id), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (selected && narrow) {
      sheetRef.current?.scrollTo?.(0, 0);
      const top = frameRef.current?.getBoundingClientRect().top ?? 0;
      if (top > 90 || top < -40) frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selected, narrow]);

  return (
    <div className="page explore">
      <div className="explore-head">
        <div>
          <h1>Course map</h1>
          <p className="lede">Every course in the Mechatronics degree, grouped by subject. Select a course to see what you need first and what it opens up.</p>
        </div>
        <a className="btn btn-primary" href="#/plan">Plan my degree</a>
      </div>

      <MapLegend />

      <div className="explore-body">
        <section className="map-frame" aria-label="Course map" ref={frameRef}>
          <CourseMap catalog={catalog} selected={selected} onSelect={select} narrow={narrow} />
        </section>
        <aside
          ref={sheetRef}
          className={`side-panel${selected ? ' is-open' : ''}`}
          aria-label="Course details"
          aria-live="polite"
        >
          <CoursePanel catalog={catalog} offerings={offerings} courseId={selected} onSelect={pick} onClose={() => setSelected(null)} />
        </aside>
      </div>
    </div>
  );
}
