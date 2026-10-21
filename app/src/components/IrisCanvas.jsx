import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import IrisScene, { SceneDefs } from './IrisScene.jsx';
import MapControls from './MapControls.jsx';
import {
  AREA_BY_ID, AREA_OF, areaRect, areaSize, boundsOf, fitCamera, hoverLabel, layoutAreas, linkedByArea, linksFor, rectOnScreen, unionRects,
} from '../lib/exploreModel.js';

const MIN_K = 0.18;
const MAX_K = 2.6;
const clampK = (k) => Math.min(MAX_K, Math.max(MIN_K, k));
const DRAG_START = 5;
const CONTROLS_INSET = 64;  // room for the zoom buttons at the right
const PHONE_TOP = 56;       // room for the legend and Open all buttons at the top on a phone

/**
 * The map canvas: draws the scene in SVG, and handles panning, zooming, and the hover label.
 * The camera lives in a ref and is written straight to the SVG, so dragging never re-renders React.
 */
export default function IrisCanvas({
  catalog, open, selected, narrow, sheetOpen, allOpen,
  onOpen, onClose, onSelect, onPick, onOpenAll, onCloseAll,
}) {
  const reduce = useReducedMotion();
  const frameRef = useRef(null);
  const svgRef = useRef(null);
  const groupRef = useRef(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const flight = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const dragged = useRef(false);
  const [view, setView] = useState({ width: 0, height: 0 });
  const [tip, setTip] = useState(null);

  const mode = narrow ? 'column' : 'radial';
  const openKey = [...open].sort().join(',');
  const at = useMemo(() => layoutAreas(open, mode), [openKey, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const links = useMemo(() => (selected ? linksFor(catalog, selected) : { needs: [], opens: [] }), [catalog, selected]);
  const counts = useMemo(() => linkedByArea(links), [links]);

  // ---------------------------------------------------------------- camera

  const applyCam = useCallback((c) => {
    cam.current = c;
    groupRef.current?.setAttribute('transform', `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${c.k.toFixed(4)})`);
    const frame = frameRef.current;
    if (frame) {
      frame.style.setProperty('--cam-x', `${c.x}px`);
      frame.style.setProperty('--cam-y', `${c.y}px`);
      frame.style.setProperty('--cam-k', String(c.k));
    }
  }, []);

  const stopFlight = useCallback(() => {
    flight.current?.stop();
    flight.current = null;
  }, []);

  const flyTo = useCallback((target, instant = false) => {
    stopFlight();
    if (instant || reduce) { applyCam(target); return; }
    const from = { ...cam.current };
    flight.current = animate(0, 1, {
      duration: 0.7, ease: [0.32, 0.72, 0, 1],
      onUpdate: (t) => applyCam({ x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t, k: from.k + (target.k - from.k) * t }),
    });
  }, [applyCam, reduce, stopFlight]);

  useLayoutEffect(() => { applyCam(cam.current); });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const measure = () => setView((v) => {
      const next = { width: frame.clientWidth, height: frame.clientHeight };
      return v.width === next.width && v.height === next.height ? v : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const pad = narrow ? 10 : 32;
  const leftInset = 0;
  const rightInset = narrow ? 0 : CONTROLS_INSET;
  const fitAll = useCallback(() => fitCamera(boundsOf(at, open), view, { pad, leftInset, rightInset, maxK: narrow ? 0.95 : 1.1 }), [at, open, view, pad, leftInset, rightInset, narrow]);

  // The phone shows the first areas at full width and lets the student scroll down the column.
  const columnStart = useCallback(() => {
    const box = boundsOf(at, open);
    const k = Math.min(0.95, (view.width - pad * 2) / box.w);
    return { k, x: view.width / 2 - ((box.l + box.r) / 2) * k, y: PHONE_TOP - box.t * k };
  }, [at, open, view.width, pad]);

  // A camera that shows these areas (and the arrows between them) at a readable size.
  const showAreas = useCallback((ids) => {
    const box = unionRects(ids.map((id) => areaRect(id, at, open)));
    return fitCamera(box, view, { pad, leftInset, rightInset, maxK: 1, minK: 0.3, topInset: narrow ? PHONE_TOP - pad : 0 });
  }, [at, open, view, pad, leftInset, rightInset, narrow]);

  // A selected course on a phone sits in the top part of the screen, above the details sheet.
  const focusSelected = useCallback(() => {
    const area = AREA_BY_ID[AREA_OF[selected]];
    const s = areaSize(area, true);
    const c = at[area.id];
    // The ring and its semester labels fit the width. The ring itself fits the space above the sheet.
    const box = { l: c.x - s.outer, r: c.x + s.outer, t: c.y - s.bg, b: c.y + s.bg, w: s.outer * 2, h: s.bg * 2 };
    return fitCamera(box, view, { pad: 8, maxK: 1, minK: 0.3, topInset: PHONE_TOP - 8, bottomInset: Math.round(view.height * 0.44) + 54 });
  }, [at, selected, view]);

  // Move the camera when areas open or close.
  const seen = useRef(null);
  useEffect(() => {
    if (!view.width || !view.height) return;
    const first = seen.current === null;
    const before = seen.current ?? new Set();
    seen.current = new Set(open);
    const added = [...open].filter((id) => !before.has(id));
    if (narrow) {
      if (first || open.size === 0) flyTo(columnStart(), first);
      else if (added.length === 1) flyTo(showAreas([added[0]]));
      else flyTo(fitAll());
    } else if (first || added.length !== 1 || open.size === 1) {
      flyTo(added.length === 1 && !first ? showAreas([added[0]]) : fitAll(), first);
    } else {
      const rect = areaRect(added[0], at, open);
      if (cam.current.k < 0.55 || !rectOnScreen(rect, cam.current, view, { leftInset, rightInset })) flyTo(showAreas([added[0]]));
    }
  }, [openKey, narrow, view.width > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit again when the window changes width.
  const lastWidth = useRef(0);
  useEffect(() => {
    if (!view.width) return;
    if (lastWidth.current && lastWidth.current !== view.width) flyTo(narrow && open.size === 0 ? columnStart() : fitAll(), true);
    lastWidth.current = view.width;
  }, [view.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a course brings it, and the open areas it links to, into view.
  const lastSelected = useRef(null);
  useEffect(() => {
    const changed = selected && selected !== lastSelected.current;
    lastSelected.current = selected;
    if (!changed || !open.has(AREA_OF[selected])) return;
    if (narrow) { flyTo(focusSelected()); return; }
    const ids = [...new Set([AREA_OF[selected], ...[...links.needs, ...links.opens].map((l) => AREA_OF[l.id]).filter((id) => open.has(id))])];
    const box = unionRects(ids.map((id) => areaRect(id, at, open)));
    if (!rectOnScreen(box, cam.current, view, { leftInset, rightInset })) flyTo(showAreas(ids));
  }, [selected, narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((factor, cx, cy, instant = true) => {
    stopFlight();
    const c = cam.current;
    const k = clampK(c.k * factor);
    const ratio = k / c.k;
    const target = { k, x: cx - (cx - c.x) * ratio, y: cy - (cy - c.y) * ratio };
    if (instant) applyCam(target); else flyTo(target);
  }, [applyCam, flyTo, stopFlight]);

  const zoomBy = useCallback((factor) => {
    setTip(null);
    zoomAt(factor, view.width / 2, view.height / 2, false);
  }, [view, zoomAt]);

  // ---------------------------------------------------------------- gestures

  const localPoint = (e) => {
    const box = svgRef.current.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  useEffect(() => {
    const svg = svgRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      setTip(null);
      const box = svg.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const speed = e.ctrlKey ? 0.012 : 0.0016;
      zoomAt(Math.exp(-e.deltaY * unit * speed), e.clientX - box.left, e.clientY - box.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stopFlight();
    pointers.current.set(e.pointerId, localPoint(e));
    dragged.current = false;
    const pts = [...pointers.current.values()];
    if (pts.length === 1) gesture.current = { type: 'pan', start: pts[0], cam: { ...cam.current }, moving: false };
    else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam: { ...cam.current } };
      dragged.current = true;
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, localPoint(e));
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (g.type === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clampK(g.cam.k * (dist / g.dist));
      const ratio = k / g.cam.k;
      applyCam({ k, x: mid.x - (g.mid.x - g.cam.x) * ratio, y: mid.y - (g.mid.y - g.cam.y) * ratio });
      setTip(null);
    } else if (g.type === 'pan' && pts.length === 1) {
      const dx = pts[0].x - g.start.x;
      const dy = pts[0].y - g.start.y;
      if (!g.moving && Math.hypot(dx, dy) > DRAG_START) {
        g.moving = true;
        dragged.current = true;
        setTip(null);
        try { svgRef.current.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      }
      if (g.moving) applyCam({ ...g.cam, x: g.cam.x + dx, y: g.cam.y + dy });
    }
  };

  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    else if (pointers.current.size === 1 && gesture.current?.type === 'pinch') {
      const [p] = [...pointers.current.values()];
      gesture.current = { type: 'pan', start: p, cam: { ...cam.current }, moving: true };
    }
  };

  const onClick = (e) => {
    if (dragged.current) { dragged.current = false; return; }
    if (!e.target.closest?.('[data-hit]')) onSelect(null);
  };

  // ------------------------------------------------------------------ hover

  const onHover = useCallback((id, el, pointerType) => {
    if (!id) { setTip(null); return; }
    // A touch has no hover. A keyboard focus shows the label, and a mouse pointer shows it on hover.
    if (pointerType === 'touch' || (!pointerType && !el.matches(':focus-visible'))) return;
    const frame = frameRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setTip({ text: hoverLabel(catalog, id), x: rect.left + rect.width / 2 - frame.left, y: rect.top - frame.top });
  }, [catalog]);

  useEffect(() => { setTip(null); }, [selected, openKey]);

  // ---------------------------------------------------------------- render

  const api = {
    zoomIn: () => zoomBy(1.3),
    zoomOut: () => zoomBy(1 / 1.3),
    fit: () => { setTip(null); flyTo(fitAll()); },
  };

  return (
    <div className={`iris${sheetOpen ? ' has-sheet' : ''}`} ref={frameRef}>
      <svg
        ref={svgRef} className="iris-svg" role="group" aria-label="Course map. Open an area to see its courses."
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        onClick={onClick}
      >
        <SceneDefs />
        <IrisScene
          catalog={catalog} open={open} at={at} selected={selected} links={links} linkedByArea={counts}
          reduce={Boolean(reduce)} groupRef={groupRef}
          onOpen={onOpen} onClose={onClose} onSelect={onSelect} onHover={onHover}
        />
      </svg>

      <div className="iris-top-right">
        <button type="button" className="iris-pill" onClick={allOpen ? onCloseAll : onOpenAll}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            {allOpen
              ? <path d="M5 5l10 10M15 5L5 15" />
              : <><circle cx="10" cy="10" r="3.2" /><circle cx="10" cy="10" r="7.6" strokeDasharray="2.4 2.6" /></>}
          </svg>
          {allOpen ? 'Close all' : 'Open all'}
        </button>
      </div>

      <MapControls catalog={catalog} api={api} onPick={onPick} />

      {tip && <div className="iris-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>}
    </div>
  );
}
