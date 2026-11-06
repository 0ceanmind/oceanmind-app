import { useEffect, useMemo, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween, useInView } from '../../lib/motion.js';
import './generic.css';

/* ============ shared helpers for the generic blocks ============ */

/**
 * Progress 0→1 on the shared setTimeout clock, restarted whenever `key`
 * changes. Drives the tokens and packets that travel along SVG paths.
 */
export function useProgress(key, { duration = 1000, delay = 0, enabled = true } = {}) {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!enabled) { setP(0); return undefined; }
    if (prefersReducedMotion()) { setP(1); return undefined; }
    setP(0);
    let tw = null;
    const start = setTimeout(() => {
      tw = tween({ from: 0, to: 1, duration, easing: ease.linear, onUpdate: setP });
    }, delay);
    return () => { clearTimeout(start); tw?.cancel(); };
  }, [key, duration, delay, enabled]);
  return p;
}

/** "Nice" axis ticks (1/2/2.5/5 × 10ⁿ) covering [lo, hi]. */
export function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const mag = 10 ** Math.floor(Math.log10(span / count));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, step };
}

/** Short human number: 1,284 · 0.42 · 12k · 1.2M. */
export function fmtNum(v, digits = 3) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toPrecision(3)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toPrecision(3)}k`;
  if (a >= 100) return Math.round(v).toLocaleString('en-US');
  if (a === 0) return '0';
  return String(+v.toPrecision(digits));
}

/** Greedy word-wrap into at most `maxLines` lines of ~`maxChars` (last line gets an ellipsis). */
export function wrapLabel(label, maxChars = 18, maxLines = 2) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      while (cur.length > maxChars) { lines.push(`${cur.slice(0, maxChars - 1)}-`); cur = cur.slice(maxChars - 1); }
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1)).replace(/[-\s]+$/, '')}…`;
  return kept;
}

/** Enter/Space activate an SVG <g role="button">, like a real button. */
const keyActivate = (fn) => (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};

/* ============ AgentLoopBlock: the animated think→act→observe cycle ============ */

const LOOP_STAGES = [
  { id: 'think', label: 'Think', icon: '🧠', color: '#7fd8e8', detail: 'The model reads the goal and everything observed so far, then decides the single next action. This is where the LLM is the brain of the agent.' },
  { id: 'act', label: 'Act', icon: '⚙️', color: '#ffce6b', detail: 'The agent calls a tool — search, calculator, an API. Tools are the agent’s hands: without them it can only talk, never do.' },
  { id: 'observe', label: 'Observe', icon: '👁', color: '#35d0a5', detail: 'The tool result comes back — success, data, or an error. It’s appended to the agent’s context so the next Think step is smarter.' },
  { id: 'done', label: 'Done?', icon: '🏁', color: '#ff8a6b', detail: 'After each loop the agent checks: is the goal met? If yes → deliver the result. If no → loop again. Step budgets and guardrails stop runaways.' },
];
const LOOP_POS = [{ x: 300, y: 52 }, { x: 508, y: 150 }, { x: 300, y: 248 }, { x: 92, y: 150 }];
const quadAt = ({ p, c, n }, t) => {
  const u = 1 - t;
  return { x: u * u * p.x + 2 * u * t * c.x + t * t * n.x, y: u * u * p.y + 2 * u * t * c.y + t * t * n.y };
};
// Each arc runs rim to rim (not centre to centre), so the arrowhead and the token
// are never hidden under — or showing through — a stage circle.
const LOOP_ARCS = LOOP_POS.map((p, i) => {
  const n = LOOP_POS[(i + 1) % 4];
  const c = { x: (p.x + n.x) / 2 + [40, 0, -40, 0][i], y: (p.y + n.y) / 2 + [-10, 40, 10, -40][i] };
  const full = { p, c, n };
  let t0 = 0, t1 = 1;
  while (t0 < 0.5 && Math.hypot(quadAt(full, t0).x - p.x, quadAt(full, t0).y - p.y) < 44) t0 += 0.005;
  while (t1 > 0.5 && Math.hypot(quadAt(full, t1).x - n.x, quadAt(full, t1).y - n.y) < 45) t1 -= 0.005;
  // the [t0, t1] slice of a quadratic is itself a quadratic (blossom / de Casteljau)
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const blossom = (u, v) => lerp(lerp(p, c, u), lerp(c, n, u), v);
  const arc = { p: blossom(t0, t0), c: blossom(t0, t1), n: blossom(t1, t1) };
  return { ...arc, d: `M${arc.p.x.toFixed(1)} ${arc.p.y.toFixed(1)} Q ${arc.c.x.toFixed(1)} ${arc.c.y.toFixed(1)} ${arc.n.x.toFixed(1)} ${arc.n.y.toFixed(1)}` };
});
const LOOP_TICK = 1800;   // ms spent on each stage during the tour
const LOOP_TRAVEL = { delay: 650, duration: 1000 }; // the token leaves once the stage has been read
const LOOP_RESUME = 6000; // idle ms after a click before the tour picks up again

export function AgentLoopBlock() {
  const [sel, setSel] = useState(0);
  const [spin, setSpin] = useState(true);
  const [hops, setHops] = useState(0); // stages the tour has advanced
  const idle = useRef(null);

  // One timer per stage (not an interval) so the token and the stage change stay in lock-step.
  useEffect(() => {
    if (!spin) return undefined;
    const t = setTimeout(() => { setSel((s) => (s + 1) % 4); setHops((h) => h + 1); }, LOOP_TICK);
    return () => clearTimeout(t);
  }, [spin, sel]);
  useEffect(() => () => clearTimeout(idle.current), []);

  const pick = (i) => {
    setSel(i);
    setSpin(false);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setSpin(true), LOOP_RESUME);
  };
  const resume = () => { clearTimeout(idle.current); setSpin(true); };

  const t = useProgress(sel, { ...LOOP_TRAVEL, enabled: spin });
  const k = ease.inOutCubic(t);
  const moving = spin && t > 0 && t < 1;
  const head = quadAt(LOOP_ARCS[sel], k);
  const tail = quadAt(LOOP_ARCS[sel], Math.max(0, k - 0.07));

  return (
    <div className="block-frame" data-running={spin ? 'true' : 'false'} data-done={hops >= 4 ? 'true' : 'false'}
      data-phase={LOOP_STAGES[sel].id} data-hops={hops}>
      <svg className="viz-svg" viewBox="0 0 600 300" role="img" aria-label="The agent loop">
        <defs>
          <marker id="loopArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
        </defs>
        {LOOP_ARCS.map((a, i) => (
          <path key={i} d={a.d} fill="none"
            stroke="rgba(127,216,232,0.5)" strokeWidth="2"
            className={sel === i ? 'flow-anim' : ''} markerEnd="url(#loopArr)" />
        ))}
        {/* the token: carries this stage's output along the arc into the next stage */}
        {moving && (
          <g className="om-gen-token" style={{ color: LOOP_STAGES[sel].color, opacity: Math.min(1, t * 8, (1 - t) * 8) }} data-demo="token">
            <circle cx={tail.x} cy={tail.y} r="3.5" fill="currentColor" opacity="0.35" />
            <circle cx={head.x} cy={head.y} r="6.5" fill="currentColor" />
          </g>
        )}
        {LOOP_STAGES.map((s, i) => (
          <g key={s.id} className="dg-node" role="button" tabIndex={0} aria-pressed={sel === i}
            aria-label={`${s.label} stage`} data-demo={`stage-${s.id}`}
            onClick={() => pick(i)} onKeyDown={keyActivate(() => pick(i))}>
            <circle cx={LOOP_POS[i].x} cy={LOOP_POS[i].y} r="40"
              fill={sel === i ? `${s.color}33` : 'rgba(8,26,42,0.9)'}
              stroke={s.color} strokeWidth={sel === i ? 2.4 : 1.3}
              className={`om-gen-loop-dot ${sel === i ? 'glow' : ''}`} />
            {sel === i && spin && hops > 0 && (
              <circle key={`ring-${hops}`} cx={LOOP_POS[i].x} cy={LOOP_POS[i].y} r="40"
                fill="none" stroke={s.color} strokeWidth="2" className="om-gen-ring" />
            )}
            <text x={LOOP_POS[i].x} y={LOOP_POS[i].y - 4} textAnchor="middle" fontSize="18">{s.icon}</text>
            <text x={LOOP_POS[i].x} y={LOOP_POS[i].y + 18} textAnchor="middle" fill="#fff" fontSize="12">{s.label}</text>
          </g>
        ))}
      </svg>
      <div className="dg-detail" role="status" data-demo="detail">
        <span key={sel} className="om-swap om-gen-block">
          <b>{LOOP_STAGES[sel].icon} {LOOP_STAGES[sel].label}:</b> {LOOP_STAGES[sel].detail}
        </span>
      </div>
      <div className="om-gen-foot">
        <p className="block-hint">
          {spin
            ? 'Click any stage to pause the tour and inspect it. This exact loop is what runs in the live agent builder below.'
            : 'Tour paused — it picks up again on its own after a few seconds.'}
        </p>
        {!spin && (
          <button type="button" className="btn btn--ghost om-gen-mini om-enter" data-demo="resume" onClick={resume}>▶ Resume tour</button>
        )}
      </div>
    </div>
  );
}

/* ============ DiagramBlock: LLM-authored flow diagrams, animated ============ */

const NODE_W = 124, NODE_H = 52;
const DG_STAGGER = 160; // ms between columns of the left→right reveal
const DG_LEAD = 60;
const DG_FADE = 500;

/**
 * Lay out an authored diagram left→right. Edges that close a cycle (found by
 * DFS) are "loops": they're drawn as arcs over the top of the nodes instead
 * of straight back through them. Everything else is layered by longest path.
 */
export function layoutDiagram(nodes, edges, { minHeight = 0, minAspect = 0 } = {}) {
  const ids = nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const valid = edges.map((e, i) => ({ ...e, i })).filter((e) => index.has(e.from) && index.has(e.to));
  const outs = new Map(ids.map((id) => [id, []]));
  for (const e of valid) outs.get(e.from).push(e);

  // 1) loops: DFS from the entry nodes — an edge into a node still on the stack closes a cycle
  const incoming = new Set(valid.filter((e) => e.from !== e.to).map((e) => e.to));
  const roots = ids.filter((id) => !incoming.has(id));
  const state = new Map(); // 1 = on the stack, 2 = finished
  const back = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const e of outs.get(id)) {
      const s = state.get(e.to);
      if (s === 1) back.add(e.i);
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  for (const id of [...roots, ...ids]) if (!state.get(id)) visit(id);

  // 2) columns: longest path over the remaining (acyclic) edges, so data flows left→right
  const fwd = valid.filter((e) => !back.has(e.i));
  const depth = new Map(ids.map((id) => [id, 0]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of fwd) indeg.set(e.to, indeg.get(e.to) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift();
    for (const e of outs.get(id)) {
      if (back.has(e.i)) continue;
      depth.set(e.to, Math.max(depth.get(e.to), depth.get(id) + 1));
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) queue.push(e.to);
    }
  }
  const cols = [];
  for (const id of ids) (cols[depth.get(id)] ??= []).push(id);
  // order each column by the average row of its parents (fewer crossings)
  const row = new Map();
  cols.forEach((col, d) => {
    if (d > 0) {
      const bary = (id) => {
        const rows = fwd.filter((e) => e.to === id && row.has(e.from)).map((e) => row.get(e.from));
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity;
      };
      col.sort((a, b) => (bary(a) - bary(b)) || (index.get(a) - index.get(b)));
    }
    col.forEach((id, i) => row.set(id, i));
  });

  const maxDepth = cols.length - 1;
  // Up to 4 columns keep the classic 124px nodes in a 640 frame. Longer flows narrow the
  // nodes a little first, then widen the frame, so boxes never overlap.
  const spacing = maxDepth === 0 ? 0 : Math.max(460 / maxDepth, 118);
  const nodeW = maxDepth === 0 ? NODE_W : Math.min(NODE_W, Math.round(spacing - 28));
  const W = Math.max(640, nodeW + 56 + spacing * maxDepth);
  const x0 = (W - spacing * maxDepth) / 2;
  const pos = {};
  cols.forEach((col, d) => col.forEach((id, i) => {
    pos[id] = { x: x0 + d * spacing, y: 60 + i * 84 + (d % 2 ? 22 : 0), d };
  }));

  // 3) loop arcs over the top of every node they span
  const half = nodeW / 2;
  const routeLoop = (e, k) => {
    const a = pos[e.from], b = pos[e.to];
    if (e.from === e.to) {
      const top = a.y - NODE_H / 2;
      return { d: `M${a.x + 18} ${top} C ${a.x + 50} ${top - 46}, ${a.x - 50} ${top - 46}, ${a.x - 18} ${top}`, lx: a.x, ly: top - 34.5 };
    }
    const lo = Math.min(a.x, b.x) - half, hi = Math.max(a.x, b.x) + half;
    let clear = Math.min(a.y, b.y) - NODE_H / 2;
    for (const p of Object.values(pos)) if (p.x + half > lo && p.x - half < hi) clear = Math.min(clear, p.y - NODE_H / 2);
    const peak = clear - 24 - k * 22;
    const aTop = a.y - NODE_H / 2, bTop = b.y - NODE_H / 2;
    const inset = Math.min(26, half - 10);
    const sx = a.x + (b.x < a.x ? -inset : inset), ex = b.x + (b.x < a.x ? inset : -inset);
    const yc = (peak - (aTop + bTop) / 8) / 0.75; // puts the curve's midpoint exactly at `peak`
    return { d: `M${sx} ${aTop} C ${sx} ${yc}, ${ex} ${yc}, ${ex} ${bTop}`, lx: (sx + ex) / 2, ly: peak };
  };
  const loopEdges = valid.filter((e) => back.has(e.i));
  const nodeTop = Math.min(...Object.values(pos).map((p) => p.y)) - NODE_H / 2;
  const nodeBottom = Math.max(...Object.values(pos).map((p) => p.y)) + NODE_H / 2;
  const top = Math.min(nodeTop, ...loopEdges.map((e, k) => routeLoop(e, k).ly - 10));
  const contentH = nodeBottom - top;
  const H = Math.max(minHeight, contentH + 68, 170, minAspect * W);
  const dy = (H - contentH) / 2 - top; // centre the content vertically
  for (const p of Object.values(pos)) p.y += dy;
  const loops = loopEdges.map((e, k) => ({ ...e, ...routeLoop(e, k) }));
  const labelChars = Math.max(8, Math.floor((nodeW - 12) / 6.1));

  return { pos, W, H, maxDepth, fwd, loops, valid, nodeW, labelChars };
}

/** What a node without an authored `detail` does, read off its edges. */
function describeNode(id, valid, labelOf) {
  const uniq = (xs) => [...new Set(xs)];
  const ins = uniq(valid.filter((e) => e.to === id && e.from !== id).map((e) => labelOf(e.from)));
  const outs = uniq(valid.filter((e) => e.from === id && e.to !== id).map((e) => labelOf(e.to)));
  const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  if (!ins.length && outs.length) return `where the flow starts — it feeds ${list(outs)}.`;
  if (ins.length && !outs.length) return `where the flow ends — it collects the result from ${list(ins)}.`;
  if (ins.length && outs.length) return `takes input from ${list(ins)} and passes its result on to ${list(outs)}.`;
  return 'a standalone part of this picture.';
}

export function DiagramBlock({ nodes = [], edges = [], bare = false, minHeight = 0, minAspect = 0, onRevealed }) {
  const [sel, setSel] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const ref = useRef(null);
  const inView = useInView(ref, { threshold: 0.2 });
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;
  const safe = Array.isArray(nodes) && nodes.length >= 2 && Array.isArray(edges);
  const layout = useMemo(() => (safe ? layoutDiagram(nodes, edges, { minHeight, minAspect }) : null), [safe, nodes, edges, minHeight, minAspect]);
  const revealMs = layout ? DG_LEAD + (layout.maxDepth + 1) * DG_STAGGER + DG_FADE : 0;

  useEffect(() => {
    if (!inView || !layout) return undefined;
    const t = setTimeout(() => { setRevealed(true); onRevealedRef.current?.(); }, prefersReducedMotion() ? 0 : revealMs);
    return () => clearTimeout(t);
  }, [inView, layout, revealMs]);

  if (!safe || !layout) return null;
  const { pos, W, H, maxDepth, fwd, loops, valid, nodeW, labelChars } = layout;
  const labelOf = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  const selNode = nodes.find((n) => n.id === sel);
  const touches = (e) => sel != null && (e.from === sel || e.to === sel);
  const toggle = (id) => setSel((s) => (s === id ? null : id));

  return (
    <div ref={ref} className={`${bare ? '' : 'block-frame'} om-gen-dg ${inView ? 'om-gen-live' : ''}`}
      data-running={inView && !revealed ? 'true' : 'false'} data-done={revealed ? 'true' : 'false'}
      data-phase={sel == null ? 'idle' : 'selected'} data-selected={sel ?? ''}>
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Diagram">
        <defs>
          <marker id="dgArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
          <marker id="dgArrLoop" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#ffce6b" />
          </marker>
        </defs>
        {fwd.map((e) => {
          const a = pos[e.from], b = pos[e.to];
          return (
            <g key={e.i} className="om-gen-dg-in om-gen-dg-edge" style={{ '--d': a.d + 0.6 }}>
              <path d={`M${a.x + nodeW / 2} ${a.y} C ${(a.x + b.x) / 2 + 30} ${a.y}, ${(a.x + b.x) / 2 - 30} ${b.y}, ${b.x - nodeW / 2} ${b.y}`}
                fill="none" stroke="rgba(127,216,232,0.55)" strokeWidth="1.8"
                className={`flow-anim om-stroke-ease ${touches(e) ? 'om-flow-hot' : ''}`} markerEnd="url(#dgArr)" />
            </g>
          );
        })}
        {nodes.map((n, i) => {
          const p = pos[n.id];
          const on = sel === n.id;
          const lines = wrapLabel(n.label, labelChars, 3);
          const fs = [11.5, 11, 10][lines.length - 1];
          const lh = lines.length > 2 ? 11.5 : 13;
          return (
            <g key={n.id} className="om-gen-dg-in" style={{ '--d': p.d }}>
              <g className="dg-node" role="button" tabIndex={0} aria-pressed={on} aria-label={n.label}
                data-demo="node" data-node-id={n.id} data-idx={i} data-has-detail={n.detail ? 'true' : 'false'}
                onClick={() => toggle(n.id)} onKeyDown={keyActivate(() => toggle(n.id))}>
                <title>{n.label}</title>
                <rect x={p.x - nodeW / 2} y={p.y - NODE_H / 2} width={nodeW} height={NODE_H} rx="14"
                  fill={on ? 'rgba(22,184,216,0.2)' : 'rgba(8,26,42,0.92)'}
                  stroke={on ? '#16b8d8' : 'rgba(127,216,232,0.4)'} strokeWidth={on ? 2 : 1.2} className="om-gen-dg-box" />
                <text x={p.x} y={p.y - ((lines.length - 1) * lh) / 2 + fs * 0.35} textAnchor="middle" fill="#fff" fontSize={fs}>
                  {lines.map((l, li) => <tspan key={li} x={p.x} dy={li ? lh : 0}>{l}</tspan>)}
                </text>
              </g>
            </g>
          );
        })}
        {/* edge labels sit on top of the nodes, haloed, so they're never hidden */}
        {fwd.filter((e) => e.label).map((e) => {
          const a = pos[e.from], b = pos[e.to];
          return (
            <text key={`l${e.i}`} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" fill="#7a98aa" fontSize="10"
              className="om-gen-halo om-gen-dg-in om-gen-dg-edge" style={{ '--d': a.d + 0.6 }}>{e.label}</text>
          );
        })}
        {/* loops are drawn last, over the nodes, arcing above everything they span */}
        {loops.map((e) => (
          <g key={e.i} className="om-gen-dg-in om-gen-dg-edge" style={{ '--d': maxDepth + 0.8 }} data-demo="loop-edge">
            <path d={e.d} fill="none" stroke="#ffce6b" strokeOpacity={touches(e) ? 1 : 0.75} strokeWidth="1.9"
              className={`flow-anim om-stroke-ease ${touches(e) ? 'om-flow-hot' : ''}`} markerEnd="url(#dgArrLoop)" />
            {e.label && (
              <g className="om-gen-dg-loop-label">
                <rect x={e.lx - (e.label.length * 5.6 + 16) / 2} y={e.ly - 9} width={e.label.length * 5.6 + 16} height="18" rx="9"
                  fill="rgba(5,18,30,0.95)" stroke="rgba(255,206,107,0.55)" />
                <text x={e.lx} y={e.ly + 3.5} textAnchor="middle" fill="#ffce6b" fontSize="10.5">{e.label}</text>
              </g>
            )}
          </g>
        ))}
      </svg>
      {selNode ? (
        <div key={selNode.id} className="dg-detail" data-demo="detail">
          <b>{selNode.label}:</b> {selNode.detail || describeNode(selNode.id, valid, labelOf)}
        </div>
      ) : (
        <p className="block-hint" data-demo="detail-hint">Click a node to see what it does.</p>
      )}
    </div>
  );
}

/* ============ ChartBlock: LLM-authored live charts, animated ============ */

const COLORS = ['#2ee6ff', '#ff8a6b', '#35d0a5', '#ffce6b'];
const CH_W = 620, CH_H = 280, CH_PAD = 46;
const CH_START = 300;   // ms after the chart scrolls into view (lets the step's fade-in settle)
const CH_LINE = 1400;   // one line's stroke draw
const CH_SERIES = 250;  // stagger between series
const CH_BAR = 45;      // stagger between bars
const CH_BAR_GROW = 600;

function buildChart(kind, series) {
  const S = (Array.isArray(series) ? series : [])
    .map((s, si) => ({
      name: String(s?.name ?? `series ${si + 1}`),
      color: COLORS[si % COLORS.length],
      points: (Array.isArray(s?.points) ? s.points : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])),
    }))
    .filter((s) => s.points.length > 0);
  const pts = S.flatMap((s) => s.points);
  if (!pts.length) return null;
  const xsAll = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b);
  const ys = pts.map((p) => p[1]);
  const yLo0 = Math.min(0, ...ys), yHi0 = Math.max(0, ...ys);
  const { ticks: yTicks } = niceTicks(yLo0, yHi0 === yLo0 ? yLo0 + 1 : yHi0, 5);
  const yLo = Math.min(yLo0, yTicks[0]), yHi = Math.max(yHi0 === yLo0 ? yLo0 + 1 : yHi0, yTicks[yTicks.length - 1]);
  const py = (y) => CH_H - CH_PAD - ((y - yLo) / (yHi - yLo || 1)) * (CH_H - 2 * CH_PAD);
  const plotW = CH_W - 2 * CH_PAD;

  let px, cols, xTicks;
  if (kind === 'bar') {
    const band = plotW / xsAll.length;
    const rank = new Map(xsAll.map((x, i) => [x, i]));
    px = (x) => CH_PAD + band * (rank.get(x) + 0.5);
    cols = xsAll.map((x, i) => ({ x, x0: CH_PAD + band * i, x1: CH_PAD + band * (i + 1) }));
    const every = Math.ceil(xsAll.length / 12);
    xTicks = xsAll.filter((_, i) => i % every === 0);
  } else {
    const xMin = xsAll[0], xMax = xsAll[xsAll.length - 1];
    px = (x) => (xMax === xMin ? CH_W / 2 : CH_PAD + ((x - xMin) / (xMax - xMin)) * plotW);
    cols = xsAll.map((x, i) => {
      const prev = i > 0 ? (px(xsAll[i - 1]) + px(x)) / 2 : CH_PAD - 8;
      const next = i < xsAll.length - 1 ? (px(x) + px(xsAll[i + 1])) / 2 : CH_W - CH_PAD + 8;
      return { x, x0: prev, x1: next };
    });
    xTicks = xMax === xMin ? [xMin] : niceTicks(xMin, xMax, 6).ticks.filter((t) => t >= xMin - 1e-9 && t <= xMax + 1e-9);
  }

  // line geometry + where along the stroke each dot sits (so dots pop as the pen passes them)
  const lines = S.map((s) => {
    const P = s.points.map((p) => [px(p[0]), py(p[1])]);
    const seg = P.map((p, i) => (i ? Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0));
    const total = seg.reduce((a, b) => a + b, 0) || 1;
    let run = 0;
    const at = seg.map((l) => (run += l) / total);
    return { d: P.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '), P, at };
  });
  const maxBars = Math.max(...S.map((s) => s.points.length));
  const drawMs = kind === 'bar'
    ? CH_START + (maxBars - 1) * CH_BAR + (S.length - 1) * 80 + CH_BAR_GROW
    : CH_START + (S.length - 1) * CH_SERIES + CH_LINE;
  return { S, py, px, yTicks, xTicks, cols, lines, drawMs, band: kind === 'bar' ? plotW / xsAll.length : 0, sig: JSON.stringify(S.map((s) => s.points)) };
}

export function ChartBlock({ kind = 'line', title, xLabel, yLabel, series = [] }) {
  const ref = useRef(null);
  const inView = useInView(ref, { threshold: 0.3 });
  const [hover, setHover] = useState(null);
  const [drawn, setDrawn] = useState(false);
  const m = useMemo(() => buildChart(kind, series), [kind, series]);

  useEffect(() => {
    setDrawn(false);
    if (!inView || !m) return undefined;
    const t = setTimeout(() => setDrawn(true), prefersReducedMotion() ? 0 : m.drawMs);
    return () => clearTimeout(t);
  }, [inView, m]);

  if (!m) return null;
  const { S, py, px, yTicks, xTicks, cols, lines, band } = m;
  const base = py(0); // the y-axis always spans 0, so this is the zero line
  const col = hover != null ? cols[hover] : null;
  const ease01 = (f) => 1 - (1 - f) ** 0.25; // inverse of the draw's ease-out, for dot timing
  const tipRows = col ? S.map((s) => ({ s, p: s.points.find((p) => p[0] === col.x) })).filter((r) => r.p) : [];
  const tipW = col ? Math.max(90, ...tipRows.map((r) => (r.s.name.length + fmtNum(r.p[1]).length) * 6.2 + 34), `${xLabel || 'x'} ${fmtNum(col.x)}`.length * 6.2 + 20) : 0;
  const tipX = col ? (px(col.x) + 12 + tipW > CH_W - 6 ? px(col.x) - 12 - tipW : px(col.x) + 12) : 0;

  return (
    <div ref={ref} className="block-frame om-gen-chart" data-running={inView && !drawn ? 'true' : 'false'} data-done={drawn ? 'true' : 'false'}
      data-phase={!inView ? 'waiting' : drawn ? 'drawn' : 'drawing'}>
      {title && <p style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{title}</p>}
      <svg className="viz-svg" viewBox={`0 0 ${CH_W} ${CH_H}`} role="img" aria-label={title || 'Chart'} onMouseLeave={() => setHover(null)}>
        {/* light gridlines + tick labels */}
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={CH_PAD} y1={py(v)} x2={CH_W - CH_PAD} y2={py(v)} stroke="rgba(127,216,232,0.08)" />
            <text x={CH_PAD - 6} y={py(v) + 3} textAnchor="end" fill="#5d7a8c" fontSize="9">{fmtNum(v)}</text>
          </g>
        ))}
        {xTicks.map((v) => (
          <text key={`x${v}`} x={px(v)} y={CH_H - CH_PAD + 14} textAnchor="middle" fill="#5d7a8c" fontSize="9">{fmtNum(v)}</text>
        ))}
        <line x1={CH_PAD} y1={base} x2={CH_W - CH_PAD} y2={base} stroke="rgba(127,216,232,0.3)" />
        <line x1={CH_PAD} y1={CH_H - CH_PAD} x2={CH_PAD} y2={CH_PAD - 10} stroke="rgba(127,216,232,0.3)" />
        {xLabel && <text x={CH_W - CH_PAD} y={CH_H - 10} textAnchor="end" fill="#5d7a8c" fontSize="11">{xLabel} →</text>}
        {yLabel && <text x={12} y={CH_PAD - 16} fill="#5d7a8c" fontSize="11">{yLabel} ↑</text>}
        {col && <line x1={px(col.x)} y1={CH_PAD - 6} x2={px(col.x)} y2={CH_H - CH_PAD} stroke="rgba(127,216,232,0.35)" strokeDasharray="3 4" />}
        {/* marks mount once the chart is on screen, so the draw-in is actually seen */}
        {inView && (
          <g key={m.sig}>
            {S.map((s, si) => {
              if (kind === 'bar') {
                const bw = (band * 0.6) / S.length;
                return s.points.map((p, i) => {
                  const y0 = py(Math.max(0, p[1])), y1 = py(Math.min(0, p[1]));
                  const lit = col && col.x === p[0];
                  return (
                    <rect key={`${si}-${i}`} x={px(p[0]) - (band * 0.6) / 2 + si * bw} y={y0} width={Math.max(1, bw - 1)} height={Math.max(0.5, y1 - y0)}
                      rx="3" fill={s.color} opacity={col ? (lit ? 1 : 0.45) : 0.85}
                      className={`om-gen-bar ${p[1] < 0 ? 'neg' : ''}`}
                      style={{ animationDelay: `${CH_START + i * CH_BAR + si * 80}ms` }} />
                  );
                });
              }
              const L = lines[si];
              const delay = CH_START + si * CH_SERIES;
              return (
                <g key={si}>
                  <path d={L.d} pathLength="1" fill="none" stroke={s.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"
                    className="om-draw-in" style={{ animationDuration: `${CH_LINE}ms`, animationDelay: `${delay}ms` }} />
                  {L.P.map((p, i) => (
                    <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={s.color} className="om-gen-chart-dot"
                      style={{ animationDelay: `${Math.round(delay + ease01(L.at[i]) * CH_LINE)}ms` }} />
                  ))}
                </g>
              );
            })}
          </g>
        )}
        {/* legend: one row above the plot, so it never sits on the data */}
        {S.length > 1 && (() => {
          const names = S.map((s) => (s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name));
          const widths = names.map((n) => 22 + n.length * 6.2);
          let x = CH_W - CH_PAD - widths.reduce((a, b) => a + b, 0) - (S.length - 1) * 14;
          return S.map((s, si) => {
            const lx = x;
            x += widths[si] + 14;
            return (
              <g key={si}>
                <rect x={lx} y={10} width="10" height="10" rx="2" fill={s.color} />
                <text x={lx + 16} y={19} fill="#9db8c6" fontSize="11">{names[si]}</text>
              </g>
            );
          });
        })()}
        {/* hover: highlighted points + a value card */}
        {col && kind !== 'bar' && tipRows.map((r) => (
          <circle key={r.s.name} cx={px(r.p[0])} cy={py(r.p[1])} r="5.5" fill={r.s.color} stroke="#fff" strokeWidth="1.5" />
        ))}
        {col && (
          <g data-demo="tooltip" pointerEvents="none" className="om-gen-tip">
            <rect x={tipX} y={CH_PAD - 6} width={tipW} height={22 + tipRows.length * 16} rx="8" fill="rgba(5,18,30,0.94)" stroke="rgba(127,216,232,0.35)" />
            <text x={tipX + 10} y={CH_PAD + 9} fill="#9db8c6" fontSize="10.5">{xLabel || 'x'} {fmtNum(col.x)}</text>
            {tipRows.map((r, ri) => (
              <g key={r.s.name}>
                <circle cx={tipX + 14} cy={CH_PAD + 21 + ri * 16} r="3.5" fill={r.s.color} />
                <text x={tipX + 23} y={CH_PAD + 25 + ri * 16} fill="#fff" fontSize="11">
                  {S.length > 1 ? `${r.s.name} ` : ''}<tspan fontWeight="700">{fmtNum(r.p[1])}</tspan>
                </text>
              </g>
            ))}
          </g>
        )}
        {/* invisible hover columns, one per x value (drive with a 'mouseover' on data-demo="hover-col") */}
        {cols.map((c, i) => (
          <rect key={`h${i}`} x={c.x0} y={CH_PAD - 10} width={Math.max(1, c.x1 - c.x0)} height={CH_H - 2 * CH_PAD + 10}
            fill="transparent" data-demo="hover-col" data-idx={i} data-x={c.x}
            onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
    </div>
  );
}
