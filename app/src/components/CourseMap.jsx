import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position, MarkerType, BaseEdge, getBezierPath,
  useReactFlow, useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { flowLayout, TILE_W, TILE_H, subjectKeyOf } from '../lib/mapLayout.js';
import { termLayout } from '../lib/termLayout.js';
import { buildEdges, chainsFor } from '../lib/flowGraph.js';
import { tileLabel } from '../lib/courseGraph.js';
import { hoursText } from '../lib/exploreModel.js';
import MapControls from './MapControls.jsx';

const SIDES = ['t', 'r', 'b', 'l'];
const POS = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left };

/** A group's background panel with its name. Not interactive. */
function GroupNode({ data }) {
  if (data.kind === 'term') {
    return (
      <div className="map-group map-group-term">
        <div className="map-group-head">
          <span className="map-group-name">{data.label}</span>
          <span className="map-group-count">{data.count} {data.count === 1 ? 'course' : 'courses'}</span>
        </div>
        {data.dividerY != null && <div className="map-group-divider" style={{ top: data.dividerY }}>Elective options</div>}
      </div>
    );
  }
  return (
    <div className={`map-group map-group-${data.kind}`} style={{ '--g': `var(--g-${data.subject})`, '--gbg': `var(--g-${data.subject}-bg)` }}>
      <div className="map-group-head">
        {data.kind === 'elective' && <span className="map-group-kicker">Elective</span>}
        <span className="map-group-name">{data.kind === 'elective' ? data.short : data.label}</span>
      </div>
    </div>
  );
}

/** A course tile. It is a real button, so the keyboard works. The full title wraps to two lines and shows on hover. */
function CourseNode({ data }) {
  return (
    <div className={`tile-wrap tile-${data.state}`} style={{ '--g': `var(--g-${data.subject})`, '--gbg': `var(--g-${data.subject}-bg)` }}>
      {SIDES.map((s) => (
        <React.Fragment key={s}>
          <Handle id={`s-${s}`} type="source" position={POS[s]} isConnectable={false} className="map-handle" />
          <Handle id={`t-${s}`} type="target" position={POS[s]} isConnectable={false} className="map-handle" />
        </React.Fragment>
      ))}
      <button
        type="button"
        className="tile"
        title={`${data.label}, ${data.title}`}
        aria-pressed={data.state === 'selected'}
        aria-label={`${data.label}, ${data.title}. ${data.credits} credit hours. ${data.stateText}`}
        onClick={() => data.onPick(data.id)}
      >
        <span className="tile-id">{data.label}</span>
        <span className="tile-hr">{data.credits} hr</span>
        <span className="tile-title">{data.title}</span>
      </button>
    </div>
  );
}

/** A line between two tiles. The line leaves and enters on the sides that face each other. */
function LineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, className }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  return <BaseEdge path={path} markerEnd={markerEnd} className={className} />;
}

// The group box is not named "group": React Flow gives that name its own border and background.
const nodeTypes = { box: GroupNode, course: CourseNode };
const edgeTypes = { line: LineEdge };

function handlesFor(a, b) {
  if (b.x >= a.x + a.w) return ['r', 'l'];
  if (a.x >= b.x + b.w) return ['l', 'r'];
  if (b.y >= a.y + a.h) return ['b', 't'];
  return ['t', 'b'];
}

const STATE_TEXT = {
  selected: 'Selected.',
  before: 'You need this course first.',
  after: 'This course opens up after the selected course.',
  dim: '',
  idle: '',
};

const PAD = 12;
const TOP_NARROW = 56;   // room for the folded legend above the first group

function MapInner({ catalog, selected, onSelect, onPick, narrow, sheetOpen, mode = 'flow' }) {
  const flow = useReactFlow();
  const layout = useMemo(() => (mode === 'term' ? termLayout(catalog, narrow) : flowLayout(narrow)), [catalog, mode, narrow]);
  const edgesAll = useMemo(() => buildEdges(catalog), [catalog]);
  const chains = useMemo(() => (selected ? chainsFor(selected, edgesAll) : null), [selected, edgesAll]);
  const width = useStore((st) => st.width);
  const height = useStore((st) => st.height);

  const courseState = useCallback((id) => {
    if (!selected) return 'idle';
    if (id === selected) return 'selected';
    if (chains.before.has(id)) return 'before';
    if (chains.after.has(id)) return 'after';
    return 'dim';
  }, [selected, chains]);

  const nodes = useMemo(() => {
    const out = layout.groups.map((g) => ({
      id: `group:${g.id}`, type: 'box', position: { x: g.x, y: g.y }, draggable: false, selectable: false, focusable: false,
      zIndex: -1, width: g.w, height: g.h, style: { width: g.w, height: g.h },
      data: { kind: g.kind, label: g.label, short: g.short, subject: g.subject, count: g.count, dividerY: g.dividerY },
    }));
    for (const [id, r] of Object.entries(layout.tiles)) {
      const state = courseState(id);
      out.push({
        id, type: 'course', position: { x: r.x, y: r.y }, draggable: false, selectable: false, focusable: false,
        zIndex: 5, width: TILE_W, height: TILE_H, style: { width: TILE_W, height: TILE_H },
        data: {
          id, state, stateText: STATE_TEXT[state], subject: subjectKeyOf(id), label: tileLabel(catalog, id),
          title: catalog.courses[id].title, credits: hoursText(catalog.courses[id]), onPick: onSelect,
        },
      });
    }
    return out;
  }, [catalog, layout, courseState, onSelect]);

  // Lines appear when a course is selected: solid back to what it needs, dashed on to what it opens up.
  const edges = useMemo(() => {
    if (!selected) return [];
    const out = [];
    for (const e of edgesAll) {
      const inSet = (set, id) => id === selected || set.has(id);
      let kind = null;
      if (inSet(chains.before, e.from) && inSet(chains.before, e.to)) kind = 'before';
      else if (inSet(chains.after, e.from) && inSet(chains.after, e.to)) kind = 'after';
      if (!kind) continue;
      const [sh, th] = handlesFor(layout.tiles[e.from], layout.tiles[e.to]);
      out.push({
        id: e.id, source: e.from, target: e.to, sourceHandle: `s-${sh}`, targetHandle: `t-${th}`, type: 'line',
        className: `edge-${kind}${e.together ? ' edge-together' : ''}`, selectable: false, focusable: false, zIndex: 3,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#0266bb' },
      });
    }
    return out;
  }, [edgesAll, layout, selected, chains]);

  // Start fitted. On a phone the chart fits the screen width and starts at the top, so a student sees the first
  // groups at a readable size. On a larger screen the whole chart fits.
  const fitted = useRef(null);
  const fitView = useCallback((duration = 0) => {
    if (!width || !height) return;
    const { w, h } = layout.bounds;
    if (narrow) {
      const zoom = Math.min(1, (width - PAD * 2) / w);
      flow.setViewport({ x: (width - w * zoom) / 2, y: TOP_NARROW, zoom }, { duration });
    } else {
      const zoom = Math.min(1, (width - PAD * 2) / w, (height - PAD * 2) / h);
      flow.setViewport({ x: (width - w * zoom) / 2, y: (height - h * zoom) / 2, zoom }, { duration });
    }
  }, [flow, layout, narrow, width, height]);
  useEffect(() => {
    const key = `${mode}:${narrow}:${width}x${height}`;
    if (!width || !height || fitted.current === key) return;
    // A small change of size (the address bar on a phone) keeps the student's place. A new layout refits.
    if (fitted.current && fitted.current.startsWith(`${mode}:${narrow}:`)) { fitted.current = key; return; }
    fitted.current = key;
    fitView(0);
  }, [mode, narrow, width, height, fitView]);

  // Bring a selected tile into view when it is off screen or hidden by the phone's details sheet.
  const lastSelected = useRef(null);
  useEffect(() => {
    if (!selected || lastSelected.current === selected) { lastSelected.current = selected; return; }
    lastSelected.current = selected;
    const r = layout.tiles[selected];
    if (!r || !width || !height) return;
    const v = flow.getViewport();
    const usable = narrow && sheetOpen ? height * 0.52 : height;
    const left = r.x * v.zoom + v.x;
    const top = r.y * v.zoom + v.y;
    const visible = left >= 8 && top >= 8 && left + r.w * v.zoom <= width - 8 && top + r.h * v.zoom <= usable - 8;
    if (visible) return;
    const zoom = Math.max(v.zoom, narrow ? 0.85 : 0.6);
    flow.setViewport({ x: width / 2 - (r.x + r.w / 2) * zoom, y: usable / 2 - (r.y + r.h / 2) * zoom, zoom }, { duration: 350 });
  }, [selected, layout, flow, narrow, sheetOpen, width, height]);

  const [moved, setMoved] = useState(false);
  const api = useMemo(() => ({
    zoomIn: () => flow.zoomIn({ duration: 200 }),
    zoomOut: () => flow.zoomOut({ duration: 200 }),
    fit: () => fitView(300),
  }), [flow, fitView]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        minZoom={narrow ? 0.3 : 0.2}
        maxZoom={1.8}
        translateExtent={[[-120, -120], [layout.bounds.w + 120, layout.bounds.h + 120]]}
        onPaneClick={() => onSelect(null)}
        onMoveStart={(event) => { if (event) setMoved(true); }}
        proOptions={{ hideAttribution: true }}
        aria-label={mode === 'term' ? 'Course map by semester. Each column is a semester and each tile is a course.' : 'Course flow chart. Each tile is a course.'}
      >
        <Background gap={28} size={1} color="#dfe7f1" />
      </ReactFlow>
      <MapControls catalog={catalog} api={api} onPick={onPick} view={mode} />
      {narrow && !selected && !moved && <p className="flow-hint" role="note">Drag to move, pinch to zoom</p>}
    </>
  );
}

export default function CourseMap(props) {
  const box = useRef(null);
  // Focusing a tile that is off screen makes the browser scroll the map's hidden overflow, which shifts the whole map.
  // The map moves with pan and zoom instead, so any scroll in it gets undone.
  useEffect(() => {
    const root = box.current;
    if (!root) return undefined;
    const reset = (e) => {
      const t = e.target;
      if (t.scrollLeft !== 0 || t.scrollTop !== 0) { t.scrollLeft = 0; t.scrollTop = 0; }
    };
    root.addEventListener('scroll', reset, true);
    return () => root.removeEventListener('scroll', reset, true);
  }, []);
  return (
    <div className={`map-box${props.sheetOpen ? ' has-sheet' : ''}`} ref={box}>
      <ReactFlowProvider>
        <MapInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
