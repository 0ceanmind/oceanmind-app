import { useEffect, useMemo, useState } from 'react';
import { compileExpr } from './mathExpr.js';

/* ============ SimulatorBlock: LLM-authored live formula explorer ============ */

const W = 620, H = 260, PAD = 44;

export function SimulatorBlock({ title, expr, xVar, xRange = [-5, 5], vars = [], yLabel }) {
  const [vals, setVals] = useState(() => Object.fromEntries(vars.map((v) => [v.name, v.init ?? (v.min + v.max) / 2])));
  const fn = useMemo(() => {
    try { return compileExpr(expr); } catch { return null; }
  }, [expr]);
  if (!fn) return null;

  const hasCurve = typeof xVar === 'string' && xVar.length > 0;
  let curve = null, yMin = 0, yMax = 1;
  if (hasCurve) {
    const [x0, x1] = xRange;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const x = x0 + (i / 120) * (x1 - x0);
      const y = fn({ ...vals, [xVar]: x });
      if (Number.isFinite(y)) pts.push([x, y]);
    }
    if (pts.length < 2) return null;
    yMin = Math.min(...pts.map((p) => p[1]));
    yMax = Math.max(...pts.map((p) => p[1]));
    if (yMax - yMin < 1e-9) { yMax = yMin + 1; }
    const px = (x) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
    const py = (y) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);
    curve = { d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(' '), px, py };
  }
  const value = hasCurve ? null : fn(vals);

  return (
    <div className="block-frame">
      {title && <p style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.4rem' }}>{title}</p>}
      <p className="muted" style={{ fontFamily: 'monospace', fontSize: '0.82rem', marginBottom: '0.6rem' }}>ƒ = {expr}</p>
      {hasCurve ? (
        <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || 'Simulator'}>
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(127,216,232,0.3)" />
          <line x1={PAD} y1={PAD - 8} x2={PAD} y2={H - PAD} stroke="rgba(127,216,232,0.3)" />
          <text x={W - PAD} y={H - 12} textAnchor="end" fill="#5d7a8c" fontSize="11">{xVar} →</text>
          <text x={10} y={PAD - 14} fill="#5d7a8c" fontSize="11">{yLabel || 'ƒ'} ↑</text>
          <text x={PAD - 6} y={H - PAD + 4} textAnchor="end" fill="#5d7a8c" fontSize="9">{yMin.toFixed(1)}</text>
          <text x={PAD - 6} y={PAD} textAnchor="end" fill="#5d7a8c" fontSize="9">{yMax.toFixed(1)}</text>
          <path d={curve.d} fill="none" stroke="#2ee6ff" strokeWidth="2.4" />
        </svg>
      ) : (
        <div className="center" style={{ padding: '1.4rem 0' }}>
          <span className="depth-num" style={{ fontSize: '2.4rem' }}>{Number.isFinite(value) ? value.toFixed(4) : '—'}</span>
        </div>
      )}
      <div className="dial-row">
        {vars.map((v) => (
          <label key={v.name} className="dial">
            {v.name} <b>{Number(vals[v.name]).toFixed(2)}</b>
            <input type="range" min={v.min} max={v.max} step={v.step ?? (v.max - v.min) / 100}
              value={vals[v.name]}
              onChange={(e) => setVals((s) => ({ ...s, [v.name]: Number(e.target.value) }))} />
          </label>
        ))}
      </div>
      <p className="block-hint">Drag the sliders — the {hasCurve ? 'curve redraws' : 'value updates'} live from the formula above.</p>
    </div>
  );
}

/* ============ SequenceBlock: LLM-authored animated stage walkthrough ============ */

export function SequenceBlock({ stages = [] }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setI((x) => (x + 1) % stages.length), 2400);
    return () => clearInterval(t);
  }, [auto, stages.length]);
  if (!Array.isArray(stages) || stages.length < 2) return null;

  const w = 620;
  const gap = w / stages.length;

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${w} 120`} role="img" aria-label="Sequence">
        <defs>
          <marker id="sqArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
        </defs>
        {stages.map((s, si) => {
          const x = gap * si + gap / 2;
          return (
            <g key={si} className="dg-node" onClick={() => { setI(si); setAuto(false); }}>
              {si < stages.length - 1 && (
                <line x1={x + 34} y1={56} x2={x + gap - 34} y2={56}
                  stroke="rgba(127,216,232,0.5)" strokeWidth="2"
                  className={si === i ? 'flow-anim' : ''} markerEnd="url(#sqArr)" />
              )}
              <circle cx={x} cy={56} r={si === i ? 30 : 24}
                fill={si === i ? 'rgba(22,184,216,0.28)' : si < i ? 'rgba(53,208,165,0.15)' : 'rgba(8,26,42,0.9)'}
                stroke={si === i ? '#2acbe9' : si < i ? '#35d0a5' : 'rgba(127,216,232,0.4)'}
                strokeWidth={si === i ? 2.4 : 1.3} className={si === i ? 'glow' : ''} />
              <text x={x} y={61} textAnchor="middle" fill="#fff" fontSize="13">{si + 1}</text>
              <text x={x} y={104} textAnchor="middle" fill={si === i ? '#fff' : '#9db8c6'} fontSize="10.5">
                {s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="dg-detail" role="status">
        <b>{i + 1}. {stages[i].label}:</b> {stages[i].detail}
      </div>
      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => { setI(Math.max(0, i - 1)); setAuto(false); }} disabled={i === 0}>← Back</button>
        <button className="btn btn--primary" onClick={() => { setI(Math.min(stages.length - 1, i + 1)); setAuto(false); }} disabled={i === stages.length - 1}>Next →</button>
        <button className="btn" onClick={() => setAuto(!auto)}>{auto ? '❚❚ Pause tour' : '▶ Auto-play'}</button>
      </div>
    </div>
  );
}
