import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Modal, Card, Md, Spinner, useToast } from '../../components/ui.jsx';
import { ease, isDemo, prefersReducedMotion, sleep, tween, useTweenedNumber, useTypewriter } from '../../lib/motion.js';
import '../agents.css';

const NODE_TYPES = {
  trigger: {
    label: 'Trigger', icon: '⚡',
    hint: 'Where the run starts. It receives the test input you type in the toolbar and passes it to whatever it connects to.',
    requires: 'Nothing upstream — this is the entry point. Every flow needs exactly one.',
  },
  llm: {
    label: 'LLM step', icon: '✨',
    hint: 'Sends its incoming text to the connected model with your prompt, and passes the model’s reply onward.',
    requires: 'A connected model (Admin → Model) and an input wire. Write a clear prompt in the inspector.',
  },
  tool: {
    label: 'Tool', icon: '🔧',
    hint: 'Really executes a function on the server and returns the actual result — no hallucination.',
    requires: 'An input wire whose text suits the tool (e.g. an arithmetic expression for the calculator).',
  },
  output: {
    label: 'Output', icon: '📤',
    hint: 'Collects whatever reaches it as the flow’s final result. Shown in the run panel.',
    requires: 'At least one input wire. Nothing runs after it.',
  },
};
const TOOL_OPTIONS = [
  { id: 'calculator', desc: 'evaluates an arithmetic expression like "1200 + 80*8"' },
  { id: 'docsearch', desc: 'searches the course source documents and returns passages' },
  { id: 'notes', desc: 'appends its input to a scratchpad' },
  { id: 'clock', desc: 'returns the current date and time' },
];

const TEMPLATES = {
  starter: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 30, y: 150, config: { label: 'Incoming request' } },
      { id: 'n2', type: 'llm', x: 250, y: 150, config: { label: 'Process', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' } },
      { id: 'n3', type: 'output', x: 470, y: 150, config: { label: 'Result' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  research: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 24, y: 60, config: { label: 'Research question' } },
      { id: 'n2', type: 'tool', x: 230, y: 60, config: { label: 'Search sources', tool: 'docsearch' } },
      { id: 'n3', type: 'llm', x: 440, y: 60, config: { label: 'Summarize', prompt: 'Summarize the retrieved passages into 3 bullet points answering the question.' } },
      { id: 'n4', type: 'output', x: 440, y: 240, config: { label: 'Summary' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },
  marketing: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 24, y: 170, config: { label: 'Campaign brief' } },
      { id: 'n2', type: 'llm', x: 230, y: 60, config: { label: 'Audience analysis', prompt: 'From this campaign brief, identify the target audience and their 3 main pain points.' } },
      { id: 'n3', type: 'llm', x: 230, y: 280, config: { label: 'Copywriter', prompt: 'Write 2 short ad copy variants for this brief.' } },
      { id: 'n4', type: 'llm', x: 450, y: 170, config: { label: 'Campaign plan', prompt: 'Combine the audience analysis and ad copy into a one-paragraph launch plan.' } },
      { id: 'n5', type: 'output', x: 650, y: 170, config: { label: 'Launch plan' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },
};

const NODE_W = 148;
// Rough node heights, used only until the real ones are measured.
const FALLBACK_H = { trigger: 94, llm: 100, tool: 66, output: 94 };
// Run replay pacing: a packet travels each incoming wire, then the node works.
const WIRE_MS = 420;
const NODE_MS = 380;
const PENDING_LOOP_MS = 700; // packet lap on the trigger's wires while the server runs
const ARM_MS = 380; // how long the helper's rubber-band wire takes to reach its target
const GLIDE_MS = 600; // matches .fb-world.om-ag-glide
const TIP_W = 230; // hover tip width; it may spill over the palette/inspector, never clipped by the canvas
const POP_MS = 500; // node entrance; template nodes stagger 70ms apart
// Fit-to-view padding in screen px; the top clears the zoom pill.
const FIT_PAD = { l: 24, r: 24, t: 50, b: 30 };

const edgeKey = (e) => `${e.from}-${e.to}`;
const clampZoom = (k) => Math.max(0.4, Math.min(2, k));

/** Cubic wire from an out port (x1,y1) to an in port (x2,y2) as [x1,y1,c1x,c1y,c2x,c2y,x2,y2]. */
function wirePts(x1, y1, x2, y2) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
  return [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
}
const pathD = (p) => `M${p[0]} ${p[1]} C ${p[2]} ${p[3]}, ${p[4]} ${p[5]}, ${p[6]} ${p[7]}`;
function bezierAt(p, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

/** A node's output in the run results: its own line breaks kept (.fb-result is pre-line), ~600 chars. */
function clipOutput(out) {
  const s = String(out ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > 600 ? `${s.slice(0, 599).trimEnd()}…` : s;
}

/** A short one-liner of a node's output for the card itself (the inspector has the full text). */
function previewText(out) {
  let s = String(out ?? '').replace(/\s+/g, ' ').trim();
  const search = s.match(/^Top passages for "[^"]*":\s*(.*)$/);
  if (search) s = `🔎 “${search[1]}`;
  return s.length > 84 ? `${s.slice(0, 83).trimEnd()}…` : s;
}

/** One wire. Draws itself in when it first appears, then idles or runs hot. */
function FlowEdge({ id, pts, state, onRemove }) {
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 900);
    return () => clearTimeout(t);
  }, []);
  const drawing = fresh && state !== 'hot';
  const d = pathD(pts);
  return (
    <g className="om-ag-edge" onClick={onRemove}>
      <path d={d} className="om-ag-edge-hit" />
      <path data-edge={id} d={d} fill="none" stroke="rgba(22,184,216,0.7)" strokeWidth="2.2"
        {...(drawing
          ? { pathLength: 1, className: 'om-ag-wire om-draw-in' }
          : {
            className: `om-ag-wire flow-anim ${state === 'hot' ? 'om-flow-hot' : 'om-flow-idle'} ${state === 'carried' ? 'om-ag-carried' : ''}`,
            markerEnd: 'url(#fbArr)',
          })}>
        <title>Click to disconnect</title>
      </path>
    </g>
  );
}

/** A bright data packet riding a wire (setTimeout clock, so it keeps time in any tab). */
function Packet({ pts, duration, loop }) {
  const ref = useRef(null);
  const ptsRef = useRef(pts);
  ptsRef.current = pts;
  useLayoutEffect(() => {
    const place = (v) => {
      const [x, y] = bezierAt(ptsRef.current, v);
      ref.current?.setAttribute('transform', `translate(${x} ${y})`);
    };
    place(0);
    let alive = true;
    let t = null;
    const lap = () => {
      t = tween({ from: 0, to: 1, duration, easing: ease.inOutCubic, onUpdate: place });
      t.promise.then((ok) => { if (ok && alive && loop) lap(); });
    };
    lap();
    return () => { alive = false; t?.cancel(); };
  }, [duration, loop]);
  return (
    <g ref={ref} className="om-ag-packet">
      <circle r="7" className="halo" />
      <circle r="3.6" className="core" />
    </g>
  );
}

/** The node's own output line, typed out as the run reaches it. */
function NodeOutput({ text, error }) {
  const short = useMemo(() => previewText(text), [text]);
  const shown = useTypewriter(short, { cps: 150 });
  return <div className={`om-ag-node-out ${error ? 'bad' : ''}`} data-demo="node-output">{shown}</div>;
}

export default function FlowBuilder({ template = 'starter', goalHint, topicId, sessionId }) {
  const toast = useToast();
  const canvasRef = useRef(null);
  const inspectorRef = useRef(null);
  const [initial] = useState(() => structuredClone(TEMPLATES[template] ?? TEMPLATES.starter));
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [sel, setSel] = useState(null);
  const [arming, setArming] = useState(null);
  const [armPos, setArmPos] = useState(null); // world point the rubber-band wire follows
  const [drag, setDrag] = useState(null);
  const [hoverId, setHoverId] = useState(null);
  const [input, setInput] = useState(goalHint ?? '');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | pending | replay | done | error
  const [trace, setTrace] = useState({});
  const [hot, setHot] = useState({ ids: [], seq: 0, loop: false }); // wires carrying data right now
  const [guide, setGuide] = useState(null);
  const [guideBusy, setGuideBusy] = useState(false);
  const [canvasH, setCanvasH] = useState(440);
  const [projectId, setProjectId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }); // pan (x,y) + zoom (k)
  const [glide, setGlide] = useState(false); // animate the next view change (buttons/auto-fit, not drags)
  const [epoch, setEpoch] = useState(0); // bumps on template load so nodes and wires re-enter
  const [heights, setHeights] = useState({}); // measured node heights, so wires meet the port dots
  const [ghosts, setGhosts] = useState({ nodes: [], edges: [] }); // removed items fading out
  const [fitReq, setFitReq] = useState(null);

  const panRef = useRef(null);
  const resizeRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const selRef = useRef(sel);
  selRef.current = sel;
  const inputRef = useRef(input);
  inputRef.current = input;
  const traceRef = useRef(trace);
  traceRef.current = trace;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const autoFitRef = useRef(true); // keep re-fitting on resize until the user pans or zooms by hand
  const uidRef = useRef(100);
  const ghostSeq = useRef(0);
  const nodeEls = useRef(new Map());
  const nodeRefFns = useRef({});
  const roRef = useRef(null);
  // entrance stagger (ms) for the nodes of the current template; added nodes pop at once
  const staggerRef = useRef(null);
  if (staggerRef.current === null) staggerRef.current = new Map(initial.nodes.map((n, i) => [n.id, i * 70]));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // every write goes through the refs too, so helper calls in the same tick see each other
  const commitNodes = (fn) => { const next = fn(nodesRef.current); nodesRef.current = next; setNodes(next); };
  const commitEdges = (fn) => { const next = fn(edgesRef.current); edgesRef.current = next; setEdges(next); };

  const selNode = nodes.find((n) => n.id === sel);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /* ------------------------------------------------------ node measuring */

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      setHeights((h) => {
        let next = h;
        for (const en of entries) {
          const id = en.target.dataset.nodeId;
          const v = en.target.offsetHeight;
          if (id && v && next[id] !== v) {
            if (next === h) next = { ...h };
            next[id] = v;
          }
        }
        return next;
      });
    });
    roRef.current = ro;
    nodeEls.current.forEach((el) => ro.observe(el));
    return () => { ro.disconnect(); roRef.current = null; };
  }, []);
  // Ref per node id: measures it and pops it in once when its element mounts. The pop
  // uses the Web Animations API so it never fights the CSS .running/.did-run animations.
  const nodeRef = (id) => {
    nodeRefFns.current[id] ??= (el) => {
      const prev = nodeEls.current.get(id);
      if (prev && prev !== el) roRef.current?.unobserve(prev);
      if (!el) {
        nodeEls.current.delete(id);
        return;
      }
      nodeEls.current.set(id, el);
      roRef.current?.observe(el);
      if (el !== prev && !prefersReducedMotion() && el.animate) {
        el.animate(
          [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }],
          { duration: POP_MS, delay: staggerRef.current.get(id) ?? 0, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'backwards' }
        );
      }
    };
    return nodeRefFns.current[id];
  };
  // synchronous pass so the very first paint already has correct wires
  useLayoutEffect(() => {
    setHeights((h) => {
      let next = h;
      nodeEls.current.forEach((el, id) => {
        const v = el.offsetHeight;
        if (v && next[id] !== v) {
          if (next === h) next = { ...h };
          next[id] = v;
        }
      });
      return next;
    });
  }, [nodes, trace]);

  const hOf = (n) => heights[n.id] ?? FALLBACK_H[n.type];
  // ports sit at top:50% of the card; the in port's left edge is where the arrow tip lands
  const outPt = (n) => [n.x + NODE_W - 1, n.y + hOf(n) / 2];
  const inPt = (n) => [n.x - 6, n.y + hOf(n) / 2];
  const edgePts = (e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return null;
    const [x1, y1] = outPt(a);
    const [x2, y2] = inPt(b);
    return wirePts(x1, y1, x2, y2);
  };

  /* ------------------------------------------------------------ viewing */

  // world coords from a pointer event (account for pan + zoom)
  const toWorld = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };

  /** The view that shows every node, centred, never zoomed past 100%. */
  const fitTarget = () => {
    const c = canvasRef.current;
    const ns = nodesRef.current;
    if (!c || !c.clientWidth || !c.clientHeight) return null;
    if (ns.length === 0) return { x: 0, y: 0, k: 1 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) {
      const h = nodeEls.current.get(n.id)?.offsetHeight || FALLBACK_H[n.type];
      x0 = Math.min(x0, n.x - 10); y0 = Math.min(y0, n.y - 4);
      x1 = Math.max(x1, n.x + NODE_W + 10); y1 = Math.max(y1, n.y + h + 4);
    }
    const availW = Math.max(60, c.clientWidth - FIT_PAD.l - FIT_PAD.r);
    const availH = Math.max(60, c.clientHeight - FIT_PAD.t - FIT_PAD.b);
    const k = clampZoom(Math.min(1, availW / (x1 - x0), availH / (y1 - y0)));
    return {
      k,
      x: FIT_PAD.l + (availW - (x1 - x0) * k) / 2 - x0 * k,
      y: FIT_PAD.t + (availH - (y1 - y0) * k) / 2 - y0 * k,
    };
  };
  const fitView = (animate = true) => {
    autoFitRef.current = true;
    const v = fitTarget();
    if (!v) return false;
    const cur = viewRef.current;
    if (Math.abs(cur.k - v.k) < 0.004 && Math.abs(cur.x - v.x) < 1 && Math.abs(cur.y - v.y) < 1) return true;
    setGlide(animate);
    viewRef.current = v;
    setView(v);
    return true;
  };
  const fitRef = useRef(fitView);
  fitRef.current = fitView;

  // fit on mount (instantly), then whenever something asks for it (after that render's layout)
  useLayoutEffect(() => { fitRef.current(false); }, []);
  useLayoutEffect(() => { if (fitReq) fitRef.current(fitReq.animate); }, [fitReq]);
  // the canvas can get its real width late (hidden parent, fonts): keep fitting until the user takes over
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (autoFitRef.current && !runningRef.current) fitRef.current(false); });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const zoomBy = (f) => {
    autoFitRef.current = false;
    setGlide(true);
    setView((v) => {
      const k = clampZoom(v.k * f);
      const cx = (canvasRef.current?.clientWidth ?? 400) / 2, cy = canvasH / 2;
      const ratio = k / v.k;
      return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
    });
  };
  const zoomPct = useTweenedNumber(view.k * 100, { duration: glide ? GLIDE_MS : 120 });

  // wheel zoom, centred on the cursor. Registered natively as non-passive: React's
  // root wheel listener is passive, so its preventDefault can't stop the page scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      autoFitRef.current = false;
      setGlide(false);
      setView((v) => {
        const k = clampZoom(v.k * (e.deltaY < 0 ? 1.1 : 0.9));
        const ratio = k / v.k;
        return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ------------------------------------------------------------ editing */

  const addGhosts = (gNodes, gEdges) => {
    if (gNodes.length === 0 && gEdges.length === 0) return;
    const tag = ++ghostSeq.current;
    setGhosts((g) => ({
      nodes: [...g.nodes, ...gNodes.map((x) => ({ ...x, tag }))],
      edges: [...g.edges, ...gEdges.map((p, i) => ({ p, tag, key: `${tag}-${i}` }))],
    }));
    setTimeout(() => {
      if (!mountedRef.current) return;
      setGhosts((g) => ({ nodes: g.nodes.filter((x) => x.tag !== tag), edges: g.edges.filter((x) => x.tag !== tag) }));
    }, 300);
  };

  /** A free spot near the selected (or last working) node, so new nodes never land on top of others. */
  const findSpot = (type) => {
    const ns = nodesRef.current;
    if (ns.length === 0) return { x: 40, y: 150 };
    const anchor = ns.find((n) => n.id === selRef.current)
      ?? [...ns].reverse().find((n) => n.type !== 'output')
      ?? ns[ns.length - 1];
    const h = FALLBACK_H[type];
    const heightOf = (n) => nodeEls.current.get(n.id)?.offsetHeight || FALLBACK_H[n.type];
    const free = (x, y) => ns.every((n) => x >= n.x + NODE_W + 36 || x + NODE_W + 36 <= n.x || y >= n.y + heightOf(n) + 34 || y + h + 34 <= n.y);
    // right, below-right, below, above-right, above, then further out
    const tries = [[1, 0], [1, 1], [0, 1], [1, -1], [0, -1], [2, 0], [2, 1], [2, -1], [1, 2], [0, 2], [2, 2], [-1, 1], [-1, -1], [1, -2], [0, -2], [3, 0], [3, 1], [3, -1]];
    for (const [cx, cy] of tries) {
      const x = anchor.x + cx * 220, y = anchor.y + cy * 150;
      if (free(x, y)) return { x, y };
    }
    return { x: anchor.x, y: Math.max(...ns.map((n) => n.y + heightOf(n))) + 50 };
  };

  const addNode = (type, opts = {}) => {
    if (!NODE_TYPES[type]) return null;
    let id = `n${++uidRef.current}`;
    while (nodesRef.current.some((n) => n.id === id)) id = `n${++uidRef.current}`;
    const spot = Number.isFinite(opts.x) && Number.isFinite(opts.y) ? { x: opts.x, y: opts.y } : findSpot(type);
    const node = {
      id, type, x: spot.x, y: spot.y,
      config: {
        label: opts.label ?? NODE_TYPES[type].label,
        ...(type === 'llm' ? { prompt: opts.prompt ?? 'Process the input and produce a useful result.' } : {}),
        ...(type === 'tool' ? { tool: opts.tool ?? 'calculator' } : {}),
      },
    };
    commitNodes((ns) => [...ns, node]);
    if (opts.select !== false) setSel(id);
    setFitReq({ animate: true });
    return id;
  };
  const removeNode = (id) => {
    const n = nodesRef.current.find((x) => x.id === id);
    if (!n) return false;
    const gone = edgesRef.current.filter((e) => e.from === id || e.to === id);
    addGhosts([{ n, h: nodeEls.current.get(id)?.offsetHeight }], gone.map(edgePts).filter(Boolean));
    commitNodes((ns) => ns.filter((x) => x.id !== id));
    commitEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    setSel((s) => (s === id ? null : s));
    setArming((a) => (a === id ? null : a));
    setHoverId((h) => (h === id ? null : h));
    return true;
  };
  const patchNode = (id, patch) => commitNodes((ns) => ns.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)));
  const updateSel = (patch) => patchNode(sel, patch);

  const loadTemplate = (k) => {
    const t = TEMPLATES[k];
    if (!t) return false;
    if (runningRef.current) { // abandon a replay in flight: its ids would light the new nodes
      runIdRef.current += 1;
      runningRef.current = false;
      setRunning(false);
    }
    const next = structuredClone(t);
    staggerRef.current = new Map(next.nodes.map((n, i) => [n.id, i * 70]));
    commitNodes(() => next.nodes);
    commitEdges(() => next.edges);
    setEpoch((e) => e + 1);
    setTrace({}); setSel(null); setArming(null); setArmPos(null);
    setHot((h) => ({ ...h, ids: [] }));
    setPhase('idle');
    setFitReq({ animate: true });
    return true;
  };

  const onNodeDown = (e, id) => {
    if (e.target.closest('.fb-port') || e.target.closest('button')) return;
    e.stopPropagation();
    // while a wire is armed, clicking anywhere on a target node connects to it
    if (arming && arming !== id) { clickIn(id); return; }
    const node = nodesRef.current.find((n) => n.id === id);
    const w = toWorld(e.clientX, e.clientY);
    setSel(id);
    setHoverId(null);
    setDrag({ id, dx: w.x - node.x, dy: w.y - node.y });
  };

  // node dragging (in world space, so it tracks under the cursor at any zoom)
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const w = toWorld(e.clientX, e.clientY);
      const x = Math.max(-200, Math.min(2000, w.x - drag.dx));
      const y = Math.max(-200, Math.min(2000, w.y - drag.dy));
      commitNodes((ns) => ns.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]);

  // panning the canvas background
  const onCanvasDown = (e) => {
    if (e.target !== canvasRef.current && !e.target.classList.contains('fb-world')) return;
    setSel(null); setArming(null); setArmPos(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
  };
  useEffect(() => {
    const move = (e) => {
      const p = panRef.current;
      if (!p) return;
      if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 2) autoFitRef.current = false;
      setGlide(false);
      setView((v) => ({ ...v, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
    };
    const up = () => { panRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  // resize the workspace — reliable global listeners bound once
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current;
      if (!r) return;
      setCanvasH(Math.max(300, Math.min(900, r.startH + (e.clientY - r.startY))));
    };
    const up = () => { resizeRef.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  const startResize = (e) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startH: canvasH };
    document.body.style.userSelect = 'none';
  };

  /* ------------------------------------------------------------- wiring */

  const connect = (from, to) => {
    setArming(null); setArmPos(null);
    const a = nodesRef.current.find((n) => n.id === from);
    const b = nodesRef.current.find((n) => n.id === to);
    if (!a || !b || from === to || a.type === 'output' || b.type === 'trigger') return false;
    if (edgesRef.current.some((e) => e.from === from && e.to === to)) return false;
    commitEdges((es) => [...es, { from, to }]);
    toast('Connected! Click any wire to remove it.', 'success');
    return true;
  };
  const clickOut = (id) => {
    if (arming === id) { setArming(null); setArmPos(null); return; }
    setArming(id); setArmPos(null);
  };
  const clickIn = (id) => {
    if (!arming || arming === id) return;
    connect(arming, id);
  };
  const removeEdge = (from, to) => {
    const e = edgesRef.current.find((x) => x.from === from && x.to === to);
    if (!e) return false;
    const p = edgePts(e);
    if (p) addGhosts([], [p]);
    commitEdges((es) => es.filter((x) => x !== e));
    return true;
  };
  const onCanvasMove = (e) => {
    if (arming) setArmPos(toWorld(e.clientX, e.clientY));
  };
  // Escape drops an armed wire
  useEffect(() => {
    if (!arming) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setArming(null); setArmPos(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arming]);

  /* ---------------------------------------------------------------- run */

  const run = async () => {
    if (runningRef.current) return null;
    if (!inputRef.current.trim()) { toast('Type a test input first — that’s what the Trigger receives.', 'error'); return null; }
    const myRun = ++runIdRef.current;
    const live = () => mountedRef.current && runIdRef.current === myRun;
    const ns = nodesRef.current, es = edgesRef.current;
    runningRef.current = true;
    setRunning(true);
    setPhase('pending');
    setSel(null); setArming(null); setArmPos(null); setHoverId(null); // results show when nothing is selected
    fitView(true);
    // while the server works, the trigger fires and its wires carry the input out
    const triggers = new Set(ns.filter((n) => n.type === 'trigger').map((n) => n.id));
    setTrace(Object.fromEntries([...triggers].map((id) => [id, { status: 'running' }])));
    setHot((h) => ({ ids: es.filter((e) => triggers.has(e.from)).map(edgeKey), seq: h.seq + 1, loop: true }));
    const t0 = performance.now();
    try {
      const r = await api('/api/flow/run', { method: 'POST', body: { nodes: ns, edges: es, input: inputRef.current } });
      if (!live()) return null;
      setPhase('replay');
      const done = new Set();
      for (const step of r.trace) {
        if (triggers.has(step.id)) {
          const wait = NODE_MS - (performance.now() - t0);
          if (wait > 0) await sleep(wait);
        } else {
          const incoming = es.filter((e) => e.to === step.id && done.has(e.from)).map(edgeKey);
          if (incoming.length) {
            setHot((h) => ({ ids: incoming, seq: h.seq + 1, loop: false }));
            // eslint-disable-next-line no-await-in-loop
            await sleep(WIRE_MS);
            if (!live()) return null;
          }
          setHot((h) => ({ ...h, ids: [] }));
          setTrace((t) => ({ ...t, [step.id]: { status: 'running' } }));
          // eslint-disable-next-line no-await-in-loop
          await sleep(NODE_MS);
        }
        if (!live()) return null;
        setHot((h) => ({ ...h, ids: [] }));
        setTrace((t) => ({ ...t, [step.id]: step }));
        done.add(step.id);
      }
      if (r.error) toast(r.error, 'error');
      else toast('Flow completed — check each node’s output on the right.', 'success');
      setFitReq({ animate: true }); // outputs changed the cards' heights; keep everything in view
      await sleep(GLIDE_MS); // data-done flips once the view has settled
      if (!live()) return null;
      setPhase(r.error ? 'error' : 'done');
      return { trace: r.trace, error: r.error ?? null };
    } catch (e) {
      if (!live()) return null;
      toast(e.message, 'error');
      setPhase('error');
      return null;
    } finally {
      if (runIdRef.current === myRun) {
        runningRef.current = false;
        if (mountedRef.current) {
          setRunning(false);
          setHot((h) => ({ ...h, ids: [] }));
          setTrace((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.status !== 'running')));
        }
      }
    }
  };

  const exportJson = () => {
    const data = { name: 'oceanmind-agent-flow', version: 1, nodes, edges, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-agent-flow.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Flow downloaded as my-agent-flow.json 📦', 'success');
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      const name = selNode ? undefined : null;
      const defaultName = `Agent flow · ${new Date().toLocaleDateString()}`;
      const r = await api('/api/projects', {
        method: 'POST',
        body: { projectId, kind: 'flow', name: name ?? defaultName, topicId, sessionId, data: { nodes, edges } },
      });
      setProjectId(r.projectId);
      toast('Saved to your Projects library 🗂️', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const getGuide = async () => {
    setGuideBusy(true);
    try {
      const r = await api('/api/flow/guide', { method: 'POST', body: { nodes, edges } });
      setGuide(r.text);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGuideBusy(false);
    }
  };

  /* ------------------------------------------------- demo director hooks */

  // Same code paths (and so the same visuals, toasts and animations) as a learner's
  // clicks; they just skip hunting for pixels. Registered only in demo mode.
  const typeText = async (apply, text, typeMs) => {
    if (!typeMs) { apply(text); return true; }
    for (let i = 0; i <= text.length; i++) {
      apply(text.slice(0, i));
      // eslint-disable-next-line no-await-in-loop
      await sleep(typeMs);
      if (!mountedRef.current) return false;
    }
    return true;
  };
  const helperImpl = {
    addNode,
    removeNode,
    removeEdge,
    loadTemplate,
    run,
    select: (id) => { setArming(null); setArmPos(null); setSel(id && nodesRef.current.some((n) => n.id === id) ? id : null); return true; },
    fit: async ({ animate = true } = {}) => { fitView(animate); await sleep(animate ? GLIDE_MS : 0); return true; },
    connect: async (from, to, { armMs = ARM_MS } = {}) => {
      const a = nodesRef.current.find((n) => n.id === from);
      const b = nodesRef.current.find((n) => n.id === to);
      if (!a || !b) return false;
      const [sx, sy] = outPt(a);
      const [tx, ty] = inPt(b);
      setArming(from);
      setArmPos({ x: sx, y: sy });
      await tween({ from: 0, to: 1, duration: armMs, easing: ease.inOutCubic,
        onUpdate: (v) => setArmPos({ x: sx + (tx - sx) * v, y: sy + (ty - sy) * v }) }).promise;
      if (!mountedRef.current) return false;
      return connect(from, to);
    },
    setLabel: (id, text, { typeMs = 0 } = {}) => {
      setSel(id);
      return typeText((s) => patchNode(id, { label: s.slice(0, 40) }), String(text), typeMs);
    },
    setPrompt: (id, text, { typeMs = 0 } = {}) => {
      setSel(id);
      return typeText((s) => patchNode(id, { prompt: s.slice(0, 600) }), String(text), typeMs);
    },
    setTool: (id, tool) => {
      if (!TOOL_OPTIONS.some((t) => t.id === tool)) return false;
      setSel(id);
      patchNode(id, { tool });
      return true;
    },
    setInput: (text, { typeMs = 0 } = {}) => typeText((s) => { inputRef.current = s; setInput(s); }, String(text).slice(0, 300), typeMs),
    moveNode: (id, x, y, { duration = 500 } = {}) => {
      const n = nodesRef.current.find((q) => q.id === id);
      if (!n) return Promise.resolve(false);
      const fx = n.x, fy = n.y;
      return tween({ from: 0, to: 1, duration, easing: ease.inOutCubic,
        onUpdate: (v) => commitNodes((ns) => ns.map((q) => (q.id === id ? { ...q, x: fx + (x - fx) * v, y: fy + (y - fy) * v } : q))) }).promise;
    },
    getState: () => ({
      nodes: structuredClone(nodesRef.current),
      edges: structuredClone(edgesRef.current),
      sel: selRef.current,
      running: runningRef.current,
      phase: phaseRef.current,
      trace: structuredClone(traceRef.current),
      view: { ...viewRef.current },
    }),
  };
  const helperRef = useRef(helperImpl);
  helperRef.current = helperImpl;
  useEffect(() => {
    if (!isDemo()) return undefined;
    const call = (name) => (...args) => helperRef.current[name](...args);
    const handle = Object.fromEntries(Object.keys(helperRef.current).map((k) => [k, call(k)]));
    handle.el = (id) => canvasRef.current?.querySelector(`[data-node-id="${id}"]`) ?? null;
    window.__omFlow = handle;
    return () => { if (window.__omFlow === handle) delete window.__omFlow; };
  }, []);

  /* ------------------------------------------------------------- render */

  // in execution order (trace keys are inserted as the run reaches each node)
  const orderedResults = useMemo(
    () => Object.keys(trace).filter((id) => trace[id]?.output !== undefined && byId.has(id)).map((id) => ({ node: byId.get(id), ...trace[id] })),
    [byId, trace]
  );
  // keep the newest result in view while a run lands
  useEffect(() => {
    const el = inspectorRef.current;
    if (el && phase === 'replay') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [orderedResults.length, phase]);
  const hotIds = new Set(hot.ids);
  const edgeState = (e) => {
    if (hotIds.has(edgeKey(e))) return 'hot';
    if (trace[e.from]?.status === 'ok' && trace[e.to]?.status === 'ok') return 'carried';
    return 'idle';
  };
  const armedNode = arming ? byId.get(arming) : null;
  const rubber = armedNode && armPos ? wirePts(...outPt(armedNode), armPos.x, armPos.y) : null;

  // hover tip lives outside the clipped canvas, placed in stage coordinates
  const tipNode = hoverId && !drag ? byId.get(hoverId) : null;
  let tipStyle = null;
  if (tipNode) {
    const k = view.k;
    const w = canvasRef.current?.clientWidth ?? 400;
    const sx = view.x + tipNode.x * k, sy = view.y + tipNode.y * k;
    let left = sx + NODE_W * k + 12;
    if (left + TIP_W > w + 250) left = sx - TIP_W - 12; // no room on the right (even over the inspector): flip
    tipStyle = { left: Math.max(-180, left), top: Math.max(0, Math.min(canvasH - 60, sy)), width: TIP_W };
  }
  const runningNow = orderedResults.length;
  const traceTotal = nodes.length;

  return (
    <div className="block-frame" data-running={String(running)} data-done={String(phase === 'done')} data-phase={phase}
      data-selected={sel ?? ''} data-arming={arming ?? ''} data-nodes={nodes.length} data-edges={edges.length}>
      <div className="fb-wrap">
        <div className="fb-palette">
          <h4>Add a step</h4>
          {Object.entries(NODE_TYPES).map(([type, t]) => (
            <button key={type} className="fb-pal-item" onClick={() => addNode(type)} title={t.hint} data-demo={`pal-${type}`}>
              {t.icon} {t.label}
            </button>
          ))}
          <h4 style={{ marginTop: '0.9rem' }}>Templates</h4>
          {Object.keys(TEMPLATES).map((k) => (
            <button key={k} className="fb-pal-item" onClick={() => loadTemplate(k)} data-demo={`tpl-${k}`}>📋 {k}</button>
          ))}
        </div>

        <div className="fb-stage">
          <div className="fb-canvas" ref={canvasRef} style={{ height: canvasH }} data-demo="flow-canvas" data-zoom={view.k.toFixed(3)}
            onPointerDown={onCanvasDown} onPointerMove={onCanvasMove}>
            <div className={`fb-world ${glide ? 'om-ag-glide' : ''}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              <svg className="fb-edges" width="3000" height="3000">
                <defs>
                  <marker id="fbArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
                    <path d="M0 0 L7 3.5 L0 7 z" fill="#16b8d8" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const pts = edgePts(e);
                  if (!pts) return null;
                  return (
                    <FlowEdge key={`${epoch}:${edgeKey(e)}`} id={edgeKey(e)} pts={pts} state={edgeState(e)}
                      onRemove={() => removeEdge(e.from, e.to)} />
                  );
                })}
                {ghosts.edges.map((g) => <path key={g.key} d={pathD(g.p)} className="om-ag-ghost-edge" />)}
                {rubber && <path d={pathD(rubber)} className="om-ag-rubber" />}
                {edges.filter((e) => hotIds.has(edgeKey(e))).map((e) => {
                  const pts = edgePts(e);
                  return pts && (
                    <Packet key={`${hot.seq}:${edgeKey(e)}`} pts={pts} loop={hot.loop}
                      duration={hot.loop ? PENDING_LOOP_MS : WIRE_MS - 20} />
                  );
                })}
              </svg>
              {nodes.map((n) => {
                const tr = trace[n.id];
                return (
                  <div key={`${epoch}:${n.id}`} ref={nodeRef(n.id)} data-node-id={n.id} data-node-type={n.type} data-status={tr?.status ?? 'idle'}
                    className={`fb-node ${sel === n.id ? 'selected' : ''} ${arming && arming !== n.id && n.type !== 'trigger' ? 'om-ag-target' : ''} ${tr?.status === 'running' ? 'running' : tr?.status === 'ok' ? 'did-run' : tr?.status === 'error' ? 'error' : ''}`}
                    style={{ left: n.x, top: n.y }}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onMouseEnter={() => setHoverId(n.id)} onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}>
                    {n.type !== 'trigger' && <span className="fb-port in" data-port="in" title="Input" onClick={(e) => { e.stopPropagation(); clickIn(n.id); }} />}
                    {n.type !== 'output' && <span className={`fb-port out ${arming === n.id ? 'armed' : ''}`} data-port="out" title="Click to start a connection" onClick={(e) => { e.stopPropagation(); clickOut(n.id); }} />}
                    <div className="fb-node-head">
                      {NODE_TYPES[n.type].icon} {n.config.label}
                      <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); removeNode(n.id); }} aria-label="Delete node" data-demo="node-delete">✕</button>
                    </div>
                    {/* once the run reaches a node its output replaces the static hint/prompt (the tool keeps its name) */}
                    {(!tr || n.type === 'tool') && (
                      <div className="fb-node-body">
                        {n.type === 'llm' ? n.config.prompt : n.type === 'tool' ? `tool: ${n.config.tool}` : NODE_TYPES[n.type].hint}
                      </div>
                    )}
                    {tr?.status === 'running' && (
                      <div className="om-ag-node-out working"><span className="om-typing"><i /><i /><i /></span></div>
                    )}
                    {(tr?.status === 'ok' || tr?.status === 'error') && <NodeOutput text={tr.output} error={tr.status === 'error'} />}
                  </div>
                );
              })}
              {ghosts.nodes.map(({ n, h, tag }) => (
                <div key={`ghost-${tag}-${n.id}`} className="fb-node om-ag-ghost" style={{ left: n.x, top: n.y, height: h }} aria-hidden="true">
                  <div className="fb-node-head">{NODE_TYPES[n.type].icon} {n.config.label}</div>
                </div>
              ))}
            </div>

            {/* fixed overlay controls (not affected by pan/zoom) */}
            <div className="fb-zoom">
              <button className="icon-btn" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in" data-demo="zoom-in">＋</button>
              <span title="Current zoom" data-demo="zoom-level">{Math.round(zoomPct)}%</span>
              <button className="icon-btn" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out" data-demo="zoom-out">－</button>
              <button className="icon-btn" onClick={() => fitView(true)} title="Fit every step in view" aria-label="Fit to view" data-demo="zoom-fit">⤢</button>
            </div>
            {arming && <div className="fb-arming">Now click a target node’s left port to connect ⚡</div>}
            {/* corner + edge resize handles */}
            <div className="fb-resize-corner" onPointerDown={startResize} title="Drag to resize the workspace" />
          </div>
          <div className="fb-resize-bar" onPointerDown={startResize} title="Drag to resize the workspace" data-demo="flow-resize">⋯</div>
          {tipNode && (
            <div className="fb-tip" style={tipStyle} key={tipNode.id}>
              <b>{NODE_TYPES[tipNode.type].icon} {NODE_TYPES[tipNode.type].label}</b>
              <p>{NODE_TYPES[tipNode.type].hint}</p>
              <p className="fb-tip-req"><b>Needs:</b> {NODE_TYPES[tipNode.type].requires}</p>
              {tipNode.type === 'tool' && (
                <p className="fb-tip-req"><b>This tool:</b> {TOOL_OPTIONS.find((t) => t.id === tipNode.config.tool)?.desc}</p>
              )}
            </div>
          )}
        </div>

        <div className="fb-inspector" data-demo="flow-inspector" ref={inspectorRef} style={{ maxHeight: canvasH + 22, overflowY: 'auto' }}>
          <div key={selNode ? `sel-${selNode.id}` : 'results'} className="om-swap">
            {selNode ? (
              <>
                <h4>{NODE_TYPES[selNode.type].icon} {NODE_TYPES[selNode.type].label}</h4>
                <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.7rem', lineHeight: 1.45 }}>{NODE_TYPES[selNode.type].hint}</p>
                <div className="field">
                  <label>Name</label>
                  <input className="input" value={selNode.config.label} onChange={(e) => updateSel({ label: e.target.value })} maxLength={40} data-demo="insp-name" />
                </div>
                {selNode.type === 'llm' && (
                  <div className="field">
                    <label>Prompt</label>
                    <textarea className="textarea" style={{ minHeight: '5rem', fontSize: '0.82rem' }}
                      value={selNode.config.prompt} onChange={(e) => updateSel({ prompt: e.target.value })} maxLength={600} data-demo="insp-prompt" />
                  </div>
                )}
                {selNode.type === 'tool' && (
                  <div className="field">
                    <label>Tool</label>
                    <select className="select" value={selNode.config.tool} onChange={(e) => updateSel({ tool: e.target.value })} data-demo="insp-tool">
                      {TOOL_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                    </select>
                    <p className="muted mt-1" style={{ fontSize: '0.76rem' }}>{TOOL_OPTIONS.find((t) => t.id === selNode.config.tool)?.desc}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <h4>Run results</h4>
                {phase === 'pending' && (
                  <p className="om-ag-run-status"><span className="om-typing"><i /><i /><i /></span> Running on the server…</p>
                )}
                {phase === 'replay' && (
                  <p className="om-ag-run-status">Step {Math.min(runningNow + 1, traceTotal)} of {traceTotal}…</p>
                )}
                {orderedResults.length === 0 && phase !== 'pending' && <p className="muted" style={{ fontSize: '0.82rem' }}>Hover a node for how it works. Select one to edit it, or Run the flow to see each step’s real output.</p>}
                <div className="om-stagger" data-demo="flow-results">
                  {orderedResults.map(({ node, status, output }, i) => (
                    <div key={node.id} className="fb-result" data-node-id={node.id} style={{ '--i': phase === 'replay' ? 0 : i }}>
                      <b>{NODE_TYPES[node.type].icon} {node.config.label} {status === 'error' ? '⛔' : '✓'}</b>
                      {clipOutput(output)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="fb-toolbar">
        <input className="input" style={{ flex: 1, minWidth: 200 }} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Test input for the Trigger — e.g. “Launch our new eco water bottle”" maxLength={300} data-demo="flow-input" />
        <button className="btn btn--primary" onClick={run} disabled={running} data-demo="flow-run">{running ? <Spinner /> : '▶ Run flow'}</button>
        <button className="btn" onClick={saveProject} disabled={saving} data-demo="flow-save" data-saved={String(Boolean(projectId))}>{saving ? <Spinner /> : projectId ? '💾 Update' : '🗂️ Save to Projects'}</button>
        <button className="btn btn--ghost" onClick={exportJson} data-demo="flow-json">⬇ JSON</button>
        <button className="btn btn--ghost" onClick={getGuide} disabled={guideBusy} data-demo="flow-guide">{guideBusy ? <Spinner /> : '🔌 Integration guide'}</button>
      </div>
      <p className="block-hint">
        Build it like Zapier: drag nodes, wire outputs → inputs, <b>drag the empty canvas to pan</b>,
        <b> scroll or ＋/－ to zoom</b>, and drag the bottom/corner to resize. Hover any node for how it works.
        <b> Run</b> executes for real; <b>Save to Projects</b> keeps it.
      </p>

      {guide && (
        <Modal onClose={() => setGuide(null)}>
          <Card>
            <div data-demo="flow-guide-modal">
              <div className="row-between" style={{ marginBottom: '0.8rem' }}>
                <b>🔌 Integrating this flow into your own product</b>
                <button className="btn btn--ghost" onClick={() => setGuide(null)} data-demo="guide-close">Close ✕</button>
              </div>
              <Md text={guide} />
            </div>
          </Card>
        </Modal>
      )}
    </div>
  );
}
