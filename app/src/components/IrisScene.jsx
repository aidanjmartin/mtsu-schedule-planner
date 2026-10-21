import React, { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { tileLabel } from '../lib/courseGraph.js';
import {
  AREAS, AREA_BY_ID, AREA_OF, SUBJECT_OF, COURSE_R, areaSize, ringSlots, semesterArcs, selectedRadius,
  hoverLabel, wrapText,
} from '../lib/exploreModel.js';

const EASE = [0.32, 0.72, 0, 1];
const LABEL_LINE = 18;

// Shared animation settings. With reduced motion, every change happens at once.
function useTiming(reduce) {
  const t = (duration, extra = {}) => (reduce ? { duration: 0 } : { duration, ease: EASE, ...extra });
  return { move: t(0.62), grow: t(0.55), fade: t(0.22), reduce };
}

const polar = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

// An arc from one angle to another, clockwise on screen, or the same arc drawn the other way when `clockwise` is false.
function arcPath(r, from, to, clockwise = true) {
  const [x1, y1] = polar(r, clockwise ? from : to);
  const [x2, y2] = polar(r, clockwise ? to : from);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} ${clockwise ? 1 : 0} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function activateOnKey(handler) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e);
    }
  };
}

// ----------------------------------------------------------- area drawn below the arrows

/** The soft disc, the area name, the ring track, and the semester arcs. Nothing here takes clicks. */
const AreaBase = memo(function AreaBase({ catalog, area, open, at, index, timing }) {
  const size = areaSize(area, open);
  const labelY = open ? -(size.outer + 12) : -(size.r + 12);
  const arcs = open ? semesterArcs(catalog, area) : [];
  const hours = area.ids.reduce((sum, id) => sum + catalog.courses[id].credits, 0);
  return (
    <motion.g
      aria-hidden="true"
      className={`area area-${area.tone}${open ? ' is-open' : ''}`}
      initial={timing.reduce ? false : { opacity: 0, x: at.x, y: at.y + 18 }}
      animate={{ opacity: 1, x: at.x, y: at.y }}
      transition={{ x: timing.move, y: timing.move, opacity: timing.reduce ? { duration: 0 } : { duration: 0.5, delay: 0.05 * index } }}
    >
      <motion.circle className="area-disc" filter="url(#iris-shadow)" initial={false} animate={{ r: open ? size.bg : size.r }} transition={timing.grow} />

      <motion.g initial={false} animate={{ opacity: open ? 0 : 1 }} transition={timing.fade} className="area-closed-face">
        <circle className="area-dash" r={size.r - 14} />
        <text className="area-count" y="2">{area.ids.length}</text>
        <text className="area-count-label" y="22">courses</text>
        <text className="area-hours" y="39">{hours} credit hours</text>
      </motion.g>

      {open && <circle className="ring-track" r={size.R} />}

      <motion.g initial={false} animate={{ y: labelY }} transition={timing.grow} className="area-label">
        {area.label.map((line, i) => (
          <text key={line.text} className={line.muted ? 'label-muted' : 'label-main'} y={-(area.label.length - 1 - i) * LABEL_LINE}>{line.text}</text>
        ))}
      </motion.g>

      <AnimatePresence>
        {open && arcs.length > 0 && (
          <motion.g key="arcs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={timing.fade}>
            {arcs.map((arc) => {
              const mid = (arc.start + arc.end) / 2;
              const bottom = Math.sin((mid * Math.PI) / 180) > 0.12;
              const id = `arc-${area.id}-${arc.position}`;
              const labelR = size.arc + (bottom ? 17 : 7);
              return (
                <g key={arc.position}>
                  <motion.path
                    className="semester-arc" d={arcPath(size.arc, arc.start, arc.end)}
                    initial={timing.reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={timing.reduce ? { duration: 0 } : { duration: 0.7, ease: EASE, delay: 0.2 }}
                  />
                  <path id={id} d={arcPath(labelR, arc.start, arc.end, !bottom)} fill="none" stroke="none" />
                  <text className="semester-label">
                    <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{arc.label}</textPath>
                  </text>
                </g>
              );
            })}
          </motion.g>
        )}
      </AnimatePresence>
    </motion.g>
  );
});

// ----------------------------------------------------------- one course circle

const CourseCircle = memo(function CourseCircle({
  catalog, area, slot, selected, faded, linked, timing, onSelect, onHover, index,
}) {
  const id = slot.id;
  const subject = SUBJECT_OF[id];
  const credits = catalog.courses[id].credits;
  const [subj, num] = id.split(' ');
  const selR = selectedRadius(area);
  const r = selected ? selR : COURSE_R;
  const label = hoverLabel(catalog, id);
  const maxChars = Math.max(10, Math.floor(selR / 4.4));
  const titleLines = selected ? wrapText(catalog.courses[id].title, maxChars) : [];
  const lines = selected ? 1 + titleLines.length + 1 : 0;
  const lineH = selR < 62 ? 13 : 14.5;
  const y0 = -((lines - 1) * lineH) / 2;
  const show = (e) => onHover(id, e.currentTarget, e.pointerType);
  return (
    <motion.g
      className={`course${selected ? ' is-selected' : ''}${linked ? ' is-linked' : ''}`}
      style={{ '--c': `var(--g-${subject.css})` }}
      role="button" tabIndex={0} aria-pressed={selected} aria-label={`${label}. ${credits} credit hours.`}
      data-hit="course" data-course={id}
      initial={timing.reduce ? false : { x: 0, y: 0, opacity: 0 }}
      animate={{ x: selected ? 0 : slot.x, y: selected ? 0 : slot.y, opacity: faded ? 0.26 : 1 }}
      transition={{
        x: timing.move, y: timing.move,
        opacity: timing.reduce ? { duration: 0 } : { duration: 0.3, delay: faded ? 0 : 0.02 * index + 0.1 },
      }}
      onClick={() => onSelect(id)}
      onKeyDown={activateOnKey(() => onSelect(id))}
      onPointerEnter={show}
      onPointerLeave={() => onHover(null)}
      onFocus={show}
      onBlur={() => onHover(null)}
    >
      <motion.circle className="course-halo" initial={false} animate={{ r: r + 6 }} transition={timing.grow} />
      <motion.circle className="course-disc" filter={selected ? 'url(#iris-glow)' : 'url(#iris-lift)'} initial={false} animate={{ r }} transition={timing.grow} />
      {!selected && (
        <g className="course-text" pointerEvents="none">
          <text className="c-subj" y="-8">{subj}</text>
          <text className="c-num" y="6.5">{num}</text>
          <text className="c-hr" y="19">{credits} hr</text>
        </g>
      )}
      {selected && (
        <motion.g className="course-text course-text-big" pointerEvents="none" initial={timing.reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={timing.reduce ? { duration: 0 } : { duration: 0.25, delay: 0.25 }}>
          <text className="c-big-id" y={y0}>{tileLabel(catalog, id)}</text>
          {titleLines.map((line, i) => <text key={line + i} className="c-big-title" y={y0 + lineH * (i + 1)}>{line}</text>)}
          <text className="c-big-hr" y={y0 + lineH * (titleLines.length + 1)}>{credits} credit hours</text>
        </motion.g>
      )}
    </motion.g>
  );
});

// ----------------------------------------------- area drawn above the arrows

const AreaFront = memo(function AreaFront({
  catalog, area, open, at, index, selected, related, linkedCount, timing, onOpen, onClose, onSelect, onHover,
}) {
  const size = areaSize(area, open);
  const slots = open ? ringSlots(catalog, area) : [];
  const hasSelected = selected && AREA_OF[selected] === area.id;
  const slot = hasSelected ? slots.find((s) => s.id === selected) : null;
  const dimmed = selected && !open && !linkedCount;
  return (
    <motion.g
      className="area-front"
      initial={timing.reduce ? false : { x: at.x, y: at.y + 18 }}
      animate={{ x: at.x, y: at.y }}
      transition={{ x: timing.move, y: timing.move }}
    >
      {!open && (
        <g>
          <circle
            className="area-hit" r={size.r} data-hit="area" role="button" tabIndex={0} aria-expanded="false"
            aria-label={`Open ${area.name}. ${area.ids.length} courses.`} opacity={dimmed ? 0.55 : 1}
            onClick={() => onOpen(area.id)} onKeyDown={activateOnKey(() => onOpen(area.id))}
          />
          {linkedCount > 0 && (
            <g
              className="badge" data-hit="badge" role="button" tabIndex={0} transform={`translate(${size.r * 0.62} ${-size.r * 0.78})`}
              aria-label={`${linkedCount} linked ${linkedCount === 1 ? 'course' : 'courses'} in ${area.name}. Open this area.`}
              onClick={() => onOpen(area.id)} onKeyDown={activateOnKey(() => onOpen(area.id))}
            >
              <rect x="-38" y="-13" width="76" height="26" rx="13" />
              <text y="1">{linkedCount} linked</text>
            </g>
          )}
        </g>
      )}

      <AnimatePresence>
        {open && (
          <motion.g key="ring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={timing.fade}>
            {!hasSelected && <text className="ring-hint" y="5" pointerEvents="none">Select a course.</text>}
            {slot && <circle className="slot-ghost" cx={slot.x} cy={slot.y} r={COURSE_R} />}
            {slots.map((s, i) => (
              <CourseCircle
                key={s.id} catalog={catalog} area={area} slot={s} index={i} timing={timing}
                selected={selected === s.id} linked={Boolean(selected) && selected !== s.id && related.has(s.id)}
                faded={Boolean(selected) && selected !== s.id && !related.has(s.id)}
                onSelect={onSelect} onHover={onHover}
              />
            ))}
            <g
              className="close-btn" data-hit="close" role="button" tabIndex={0} transform={`translate(0 ${size.outer + 26})`}
              aria-label={`Close ${area.name}`} onClick={() => onClose(area.id)} onKeyDown={activateOnKey(() => onClose(area.id))}
            >
              <circle className="close-halo" r="19" />
              <circle className="close-disc" r="15" />
              <path d="M -5 -5 L 5 5 M 5 -5 L -5 5" />
            </g>
          </motion.g>
        )}
      </AnimatePresence>
    </motion.g>
  );
});

// --------------------------------------------------------------------- arrows

/** One arrow between two circles. `curve` bends it so lines that cross a ring stay apart. */
function arrowGeometry(a, b, ra, rb, curve) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = a.x + ux * (ra + 3);
  const sy = a.y + uy * (ra + 3);
  const ex = b.x - ux * (rb + 5);
  const ey = b.y - uy * (rb + 5);
  if (!curve) return `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const bend = Math.min(70, len * 0.12);
  const cx = (sx + ex) / 2 - uy * bend;
  const cy = (sy + ey) / 2 + ux * bend;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

/** Dashed arrows from the selected course to what it needs and what it opens up, across every open area. */
function Arrows({ catalog, selected, links, open, at, signature, timing }) {
  if (!selected) return null;
  const selArea = AREA_BY_ID[AREA_OF[selected]];
  if (!open.has(selArea.id)) return null;
  const center = (id) => {
    const area = AREA_BY_ID[AREA_OF[id]];
    if (id === selected) return { x: at[area.id].x, y: at[area.id].y, r: selectedRadius(area), area: area.id };
    const slot = ringSlots(catalog, area).find((s) => s.id === id);
    return { x: at[area.id].x + slot.x, y: at[area.id].y + slot.y, r: COURSE_R, area: area.id };
  };
  const me = center(selected);
  const drawn = [];
  for (const l of links.needs) if (open.has(AREA_OF[l.id])) drawn.push({ from: center(l.id), to: me, together: l.together, key: `${l.id}>${selected}` });
  for (const l of links.opens) if (open.has(AREA_OF[l.id])) drawn.push({ from: me, to: center(l.id), together: l.together, key: `${selected}>${l.id}` });
  return (
    <motion.g
      key={signature} className="arrows" pointerEvents="none" aria-hidden="true"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      transition={timing.reduce ? { duration: 0 } : { duration: 0.3, delay: 0.4 }}
    >
      {drawn.map((d) => (
        <path
          key={d.key} className={`arrow${d.together ? ' arrow-together' : ''}`}
          d={arrowGeometry(d.from, d.to, d.from.r, d.to.r, d.from.area !== d.to.area)}
          markerEnd="url(#iris-arrowhead)"
        />
      ))}
    </motion.g>
  );
}

// ---------------------------------------------------------------------- scene

export default function IrisScene({
  catalog, open, at, selected, links, linkedByArea, reduce, groupRef,
  onOpen, onClose, onSelect, onHover,
}) {
  const timing = useTiming(reduce);
  const related = new Set(selected ? [...links.needs, ...links.opens].map((l) => l.id) : []);
  const signature = `${selected}|${[...open].sort().join(',')}|${AREAS.map((a) => `${Math.round(at[a.id].x)},${Math.round(at[a.id].y)}`).join(';')}`;
  return (
    <g ref={groupRef}>
      {AREAS.map((area, i) => (
        <AreaBase key={area.id} catalog={catalog} area={area} open={open.has(area.id)} at={at[area.id]} index={i} timing={timing} />
      ))}
      <Arrows catalog={catalog} selected={selected} links={links} open={open} at={at} signature={signature} timing={timing} />
      {AREAS.map((area, i) => (
        <AreaFront
          key={area.id} catalog={catalog} area={area} open={open.has(area.id)} at={at[area.id]} index={i}
          selected={selected} related={related} linkedCount={selected ? linkedByArea[area.id] ?? 0 : 0}
          timing={timing} onOpen={onOpen} onClose={onClose} onSelect={onSelect} onHover={onHover}
        />
      ))}
    </g>
  );
}

/** Filters and the arrowhead the scene uses. */
export function SceneDefs() {
  return (
    <defs>
      <filter id="iris-shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="9" stdDeviation="11" floodColor="#14304f" floodOpacity="0.14" />
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#14304f" floodOpacity="0.12" />
      </filter>
      <filter id="iris-lift" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#14304f" floodOpacity="0.18" />
      </filter>
      <filter id="iris-glow" x="-40%" y="-40%" width="180%" height="190%">
        <feDropShadow dx="0" dy="5" stdDeviation="8" floodColor="#0266bb" floodOpacity="0.32" />
      </filter>
      <marker id="iris-arrowhead" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto">
        <path d="M 1 1.5 L 10.5 6 L 1 10.5 L 3.6 6 Z" fill="#0266bb" />
      </marker>
    </defs>
  );
}
