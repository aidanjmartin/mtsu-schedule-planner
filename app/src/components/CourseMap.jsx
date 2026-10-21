import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position, MarkerType, BaseEdge, getBezierPath,
  useReactFlow, useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LAYOUT, TILE_RECTS, MAP_BOUNDS, TILE_W, TILE_H } from '../lib/mapLayout.js';
import { buildEdges, chainsFor, tileLabel } from '../lib/courseGraph.js';

const SIDES = ['t', 'r', 'b', 'l'];
const POS = { t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left };

/** A group's background panel with its name. Not interactive. */
function GroupNode({ data }) {
  return (
    <div className={`map-group map-group-${data.kind}`} style={{ '--g': `var(--g-${data.cssKey})`, '--gbg': `var(--g-${data.cssKey}-bg)` }}>
      <div className="map-group-head">
        {data.kind === 'elective' && <span className="map-group-kicker">Elective</span>}
        <span className="map-group-name">{data.kind === 'elective' ? data.short : data.label}</span>
      </div>
    </div>
  );
}

/** A course tile. It is a real button, so the keyboard works. */
function CourseNode({ data }) {
  return (
    <div className={`tile-wrap tile-${data.state}`} style={{ '--g': `var(--g-${data.cssKey})`, '--gbg': `var(--g-${data.cssKey}-bg)` }}>
      {SIDES.map((s) => (
        <React.Fragment key={s}>
          <Handle id={`s-${s}`} type="source" position={POS[s]} isConnectable={false} className="map-handle" />
          <Handle id={`t-${s}`} type="target" position={POS[s]} isConnectable={false} className="map-handle" />
        </React.Fragment>
      ))}
      <button
        type="button"
        className="tile"
        aria-pressed={data.state === 'selected'}
        aria-label={`${data.label}, ${data.title}. ${data.stateText}`}
        onClick={() => data.onPick(data.id)}
      >
        <span className="tile-id">{data.label}</span>
        <span className="tile-title">{data.title}</span>
        <span className="tile-hr">{data.credits} hr</span>
      </button>
    </div>
  );
}

/** A line between two tiles. The line leaves and enters on the sides that face each other. */
function LineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, className }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  return <BaseEdge path={path} markerEnd={markerEnd} className={className} />;
}

const nodeTypes = { group: GroupNode, course: CourseNode };
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

function MapInner({ catalog, selected, onSelect, narrow }) {
  const flow = useReactFlow();
  const edgesAll = useMemo(() => buildEdges(catalog), [catalog]);
  const chains = useMemo(() => (selected ? chainsFor(selected, edgesAll) : null), [selected, edgesAll]);

  const courseState = useCallback((id) => {
    if (!selected) return 'idle';
    if (id === selected) return 'selected';
    if (chains.before.has(id)) return 'before';
    if (chains.after.has(id)) return 'after';
    return 'dim';
  }, [selected, chains]);

  const nodes = useMemo(() => {
    const out = LAYOUT.map((g) => ({
      id: `group:${g.id}`, type: 'group', position: { x: g.x, y: g.y }, draggable: false, selectable: false, focusable: false,
      zIndex: -1, width: g.w, height: g.h, style: { width: g.w, height: g.h },
      data: { kind: g.kind, label: g.label, short: g.short, cssKey: g.cssKey },
    }));
    for (const [id, r] of Object.entries(TILE_RECTS)) {
      const group = LAYOUT.find((g) => g.id === r.group);
      const state = courseState(id);
      out.push({
        id, type: 'course', position: { x: r.x, y: r.y }, draggable: false, selectable: false, focusable: false,
        zIndex: 5, width: TILE_W, height: TILE_H, style: { width: TILE_W, height: TILE_H },
        data: {
          id, state, stateText: STATE_TEXT[state], cssKey: group.cssKey, label: tileLabel(catalog, id),
          title: catalog.courses[id].title, credits: catalog.courses[id].credits, onPick: onSelect,
        },
      });
    }
    return out;
  }, [catalog, courseState, onSelect]);

  const edges = useMemo(() => edgesAll.map((e) => {
    const a = TILE_RECTS[e.from];
    const b = TILE_RECTS[e.to];
    const [sh, th] = handlesFor(a, b);
    let kind = 'idle';
    if (selected) {
      const inSet = (set, id) => id === selected || set.has(id);
      if (inSet(chains.before, e.from) && inSet(chains.before, e.to)) kind = 'before';
      else if (inSet(chains.after, e.from) && inSet(chains.after, e.to)) kind = 'after';
      else kind = 'dim';
    }
    const color = kind === 'dim' || kind === 'idle' ? '#a9b8cb' : '#0266bb';
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: `s-${sh}`, targetHandle: `t-${th}`, type: 'line',
      className: `edge-${kind}${e.together ? ' edge-together' : ''}`, selectable: false, focusable: false, zIndex: kind === 'before' || kind === 'after' ? 3 : 0,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
    };
  }), [edgesAll, selected, chains]);

  // On a phone the course details cover the lower half of the map, so bring the selected tile into the upper half.
  const width = useStore((st) => st.width);
  const height = useStore((st) => st.height);
  const lastSelected = useRef(null);
  useEffect(() => {
    if (!narrow || !selected || lastSelected.current === selected) { lastSelected.current = selected; return; }
    lastSelected.current = selected;
    const r = TILE_RECTS[selected];
    const zoom = Math.max(flow.getZoom(), 0.75);
    flow.setViewport({
      x: width / 2 - (r.x + r.w / 2) * zoom,
      y: height * 0.24 - (r.y + r.h / 2) * zoom,
      zoom,
    }, { duration: 350 });
  }, [narrow, selected, flow, width, height]);

  const defaultViewport = narrow ? { x: 10, y: 8, zoom: 0.62 } : undefined;

  return (
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
      fitView={!narrow}
      fitViewOptions={{ padding: 0.04 }}
      defaultViewport={defaultViewport}
      minZoom={0.25}
      maxZoom={1.8}
      translateExtent={[[-80, -80], [MAP_BOUNDS.w + 80, MAP_BOUNDS.h + 80]]}
      onPaneClick={() => onSelect(null)}
      proOptions={{ hideAttribution: true }}
      aria-label="Course map. Each tile is a course."
    >
      <Background gap={28} size={1} color="#dfe7f1" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
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
    <div className="map-box" ref={box}>
      <ReactFlowProvider>
        <MapInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
