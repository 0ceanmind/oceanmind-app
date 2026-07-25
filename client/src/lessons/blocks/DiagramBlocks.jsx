import { useEffect, useMemo, useState } from 'react';

/* ============ AgentLoopBlock: the animated think→act→observe cycle ============ */

const LOOP_STAGES = [
  { id: 'think', label: 'Think', icon: '🧠', color: '#7fd8e8', detail: 'The model reads the goal and everything observed so far, then decides the single next action. This is where the LLM is the brain of the agent.' },
  { id: 'act', label: 'Act', icon: '⚙️', color: '#ffce6b', detail: 'The agent calls a tool — search, calculator, an API. Tools are the agent’s hands: without them it can only talk, never do.' },
  { id: 'observe', label: 'Observe', icon: '👁', color: '#35d0a5', detail: 'The tool result comes back — success, data, or an error. It’s appended to the agent’s context so the next Think step is smarter.' },
  { id: 'done', label: 'Done?', icon: '🏁', color: '#ff8a6b', detail: 'After each loop the agent checks: is the goal met? If yes → deliver the result. If no → loop again. Step budgets and guardrails stop runaways.' },
];
const LOOP_POS = [{ x: 300, y: 52 }, { x: 508, y: 150 }, { x: 300, y: 248 }, { x: 92, y: 150 }];

export function AgentLoopBlock() {
  const [sel, setSel] = useState(0);
  const [spin, setSpin] = useState(true);
  useEffect(() => {
    if (!spin) return;
    const t = setInterval(() => setSel((s) => (s + 1) % 4), 1800);
    return () => clearInterval(t);
  }, [spin]);

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 600 300" role="img" aria-label="The agent loop">
        <defs>
          <marker id="loopArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
        </defs>
        {LOOP_POS.map((p, i) => {
          const n = LOOP_POS[(i + 1) % 4];
          const mx = (p.x + n.x) / 2 + (i === 0 ? 40 : i === 1 ? 0 : i === 2 ? -40 : 0);
          const my = (p.y + n.y) / 2 + (i === 0 ? -10 : i === 1 ? 40 : i === 2 ? 10 : -40);
          return (
            <path key={i} d={`M${p.x} ${p.y} Q ${mx} ${my} ${n.x} ${n.y}`} fill="none"
              stroke="rgba(127,216,232,0.5)" strokeWidth="2"
              className={sel === i ? 'flow-anim' : ''} markerEnd="url(#loopArr)" />
          );
        })}
        {LOOP_STAGES.map((s, i) => (
          <g key={s.id} className="dg-node" onClick={() => { setSel(i); setSpin(false); }}>
            <circle cx={LOOP_POS[i].x} cy={LOOP_POS[i].y} r="40"
              fill={sel === i ? `${s.color}33` : 'rgba(8,26,42,0.9)'}
              stroke={s.color} strokeWidth={sel === i ? 2.4 : 1.3}
              className={sel === i ? 'glow' : ''} />
            <text x={LOOP_POS[i].x} y={LOOP_POS[i].y - 4} textAnchor="middle" fontSize="18">{s.icon}</text>
            <text x={LOOP_POS[i].x} y={LOOP_POS[i].y + 18} textAnchor="middle" fill="#fff" fontSize="12">{s.label}</text>
          </g>
        ))}
      </svg>
      <div className="dg-detail" role="status">
        <b>{LOOP_STAGES[sel].icon} {LOOP_STAGES[sel].label}:</b> {LOOP_STAGES[sel].detail}
      </div>
      <p className="block-hint">Click any stage to pause the tour and inspect it. This exact loop is what runs in the live agent builder below.</p>
    </div>
  );
}

/* ============ DiagramBlock: LLM-authored flow diagrams, animated ============ */

export function DiagramBlock({ nodes = [], edges = [], bare = false }) {
  const [sel, setSel] = useState(null);
  const safe = Array.isArray(nodes) && nodes.length >= 2 && Array.isArray(edges);
  const layout = useMemo(() => {
    // simple layered layout: BFS depth from nodes with no incoming edges
    const incoming = new Set(edges.map((e) => e.to));
    const depths = {};
    const visited = new Set();
    const queue = nodes.filter((n) => !incoming.has(n.id)).map((n) => [n.id, 0]);
    if (queue.length === 0 && nodes.length) queue.push([nodes[0].id, 0]);
    // BFS with a visited set — cyclic diagrams (e.g. evaluator → generator
    // "revise" loops) must NOT re-enqueue forever, or the tab hard-freezes.
    while (queue.length) {
      const [id, d] = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      depths[id] = d;
      for (const e of edges) if (e.from === id && !visited.has(e.to)) queue.push([e.to, d + 1]);
    }
    for (const n of nodes) if (depths[n.id] === undefined) depths[n.id] = 0; // unreachable nodes
    const cols = {};
    for (const n of nodes) {
      const d = depths[n.id] ?? 0;
      (cols[d] = cols[d] ?? []).push(n.id);
    }
    const maxDepth = Math.max(0, ...Object.keys(cols).map(Number));
    const W = 640;
    const pos = {};
    for (const [d, ids] of Object.entries(cols)) {
      ids.forEach((id, i) => {
        pos[id] = {
          x: 90 + (maxDepth === 0 ? W / 2 - 90 : (Number(d) / maxDepth) * (W - 180)),
          y: 60 + i * 84 + (Number(d) % 2 ? 22 : 0),
        };
      });
    }
    const H = Math.max(220, 60 + Math.max(...Object.values(cols).map((c) => c.length)) * 84 + 40);
    return { pos, W, H };
  }, [nodes, edges]);

  const selNode = nodes.find((n) => n.id === sel);
  if (!safe) return null;
  return (
    <div className={bare ? '' : 'block-frame'}>
      <svg className="viz-svg" viewBox={`0 0 ${layout.W} ${layout.H}`} role="img" aria-label="Diagram">
        <defs>
          <marker id="dgArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = layout.pos[e.from], b = layout.pos[e.to];
          if (!a || !b) return null;
          return (
            <g key={i}>
              <path d={`M${a.x + 62} ${a.y} C ${(a.x + b.x) / 2 + 30} ${a.y}, ${(a.x + b.x) / 2 - 30} ${b.y}, ${b.x - 62} ${b.y}`}
                fill="none" stroke="rgba(127,216,232,0.55)" strokeWidth="1.8" className="flow-anim" markerEnd="url(#dgArr)" />
              {e.label && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" fill="#5d7a8c" fontSize="10">{e.label}</text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} className="dg-node" onClick={() => setSel(sel === n.id ? null : n.id)}>
            <rect x={layout.pos[n.id].x - 62} y={layout.pos[n.id].y - 26} width="124" height="52" rx="14"
              fill={sel === n.id ? 'rgba(22,184,216,0.2)' : 'rgba(8,26,42,0.92)'}
              stroke={sel === n.id ? '#16b8d8' : 'rgba(127,216,232,0.4)'} strokeWidth={sel === n.id ? 2 : 1.2} />
            <text x={layout.pos[n.id].x} y={layout.pos[n.id].y + 4} textAnchor="middle" fill="#fff" fontSize="11.5">
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
      {selNode?.detail ? (
        <div className="dg-detail"><b>{selNode.label}:</b> {selNode.detail}</div>
      ) : (
        <p className="block-hint">Click a node to see what it does.</p>
      )}
    </div>
  );
}

/* ============ ChartBlock: LLM-authored live charts, animated ============ */

const COLORS = ['#2ee6ff', '#ff8a6b', '#35d0a5', '#ffce6b'];

export function ChartBlock({ kind = 'line', title, xLabel, yLabel, series = [] }) {
  const [t, setT] = useState(0); // draw-in animation 0→1
  useEffect(() => {
    let raf;
    const started = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - started) / 1200);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [series]);

  const W = 620, H = 280, PAD = 46;
  const pts = series.flatMap((s) => s.points ?? []);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs) || 1;
  const yMinV = Math.min(0, ...ys), yMaxV = Math.max(...ys) || 1;
  const px = (x) => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * PAD);
  const py = (y) => H - PAD - ((y - yMinV) / (yMaxV - yMinV || 1)) * (H - 2 * PAD);

  return (
    <div className="block-frame">
      {title && <p style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{title}</p>}
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || 'Chart'}>
        <line x1={PAD} y1={py(yMinV)} x2={W - PAD} y2={py(yMinV)} stroke="rgba(127,216,232,0.3)" />
        <line x1={PAD} y1={py(yMinV)} x2={PAD} y2={PAD - 10} stroke="rgba(127,216,232,0.3)" />
        {xLabel && <text x={W - PAD} y={H - 10} textAnchor="end" fill="#5d7a8c" fontSize="11">{xLabel} →</text>}
        {yLabel && <text x={12} y={PAD - 16} fill="#5d7a8c" fontSize="11">{yLabel} ↑</text>}
        {series.map((s, si) => {
          const color = COLORS[si % COLORS.length];
          const P = s.points;
          if (kind === 'bar') {
            const bw = ((W - 2 * PAD) / P.length) * 0.6 / series.length;
            return P.map((p, i) => {
              const h = (py(yMinV) - py(p[1])) * t;
              return (
                <rect key={`${si}-${i}`} x={px(p[0]) - bw / 2 + si * bw} y={py(yMinV) - h} width={bw} height={h}
                  rx="3" fill={color} opacity="0.85" />
              );
            });
          }
          const n = Math.max(2, Math.ceil(P.length * t));
          const d = P.slice(0, n).map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(' ');
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={color} strokeWidth="2.4" />
              {P.slice(0, n).map((p, i) => <circle key={i} cx={px(p[0])} cy={py(p[1])} r="3" fill={color} />)}
            </g>
          );
        })}
        {/* legend */}
        {series.length > 1 && series.map((s, si) => (
          <g key={si}>
            <rect x={W - PAD - 130} y={PAD - 24 + si * 18} width="10" height="10" rx="2" fill={COLORS[si % COLORS.length]} />
            <text x={W - PAD - 114} y={PAD - 15 + si * 18} fill="#9db8c6" fontSize="11">{s.name}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
