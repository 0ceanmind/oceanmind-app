import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTweenedNumber } from '../../lib/motion.js';
import { compileExpr } from './mathExpr.js';
import { fmtNum, niceTicks, wrapLabel } from './DiagramBlocks.jsx';
import './generic.css';

/* ============ SimulatorBlock: LLM-authored live formula explorer ============ */

const W = 620, H = 260, PAD = 44;
const SAMPLES = 120;
const AXIS_SETTLE_MS = 1100; // the y-axis only shrinks back once the sliders have been still this long

function sampleCurve(fn, scope, xVar, x0, x1) {
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = x0 + (i / SAMPLES) * (x1 - x0);
    const y = fn({ ...scope, [xVar]: x });
    if (Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}
const spanOf = (pts) => {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  return { lo, hi };
};

export function SimulatorBlock({ title, expr, xVar, xRange = [-5, 5], vars = [], yLabel }) {
  const initVals = useMemo(() => Object.fromEntries(vars.map((v) => [v.name, v.init ?? (v.min + v.max) / 2])), [vars]);
  const [vals, setVals] = useState(initVals);
  const fn = useMemo(() => {
    try { return compileExpr(expr); } catch { return null; }
  }, [expr]);
  const hasCurve = typeof xVar === 'string' && xVar.length > 0;
  const [x0, x1] = Array.isArray(xRange) && xRange[0] < xRange[1] ? xRange : [-5, 5];
  const [refX, setRefX] = useState((x0 + x1) / 2);
  const svgRef = useRef(null);
  const dragging = useRef(false);
  const clipId = `omgen-sim-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // the starting curve stays on screen as a ghost, and anchors the y-axis
  const ghost = useMemo(() => (fn && hasCurve ? sampleCurve(fn, initVals, xVar, x0, x1) : []), [fn, hasCurve, initVals, xVar, x0, x1]);
  const pts = useMemo(() => (fn && hasCurve ? sampleCurve(fn, vals, xVar, x0, x1) : []), [fn, hasCurve, vals, xVar, x0, x1]);
  const g = spanOf(ghost), c = spanOf(pts);
  let tLo = Math.min(g.lo, c.lo), tHi = Math.max(g.hi, c.hi);
  if (!Number.isFinite(tLo) || !Number.isFinite(tHi)) { tLo = 0; tHi = 1; }
  if (tHi - tLo < 1e-9) { tLo -= 0.5; tHi += 0.5; }
  const pad = (tHi - tLo) * 0.06;
  const targetLo = tLo - pad, targetHi = tHi + pad;

  // Stable axis: grows at once when the curve leaves it (with headroom), shrinks back only
  // once the sliders rest — so while you drag, the curve visibly moves instead of the axis.
  const [axis, setAxis] = useState({ lo: targetLo, hi: targetHi });
  useEffect(() => {
    setAxis((a) => {
      if (targetLo >= a.lo && targetHi <= a.hi) return a;
      const head = (targetHi - targetLo) * 0.12;
      return { lo: targetLo < a.lo ? targetLo - head : a.lo, hi: targetHi > a.hi ? targetHi + head : a.hi };
    });
    const t = setTimeout(() => setAxis({ lo: targetLo, hi: targetHi }), AXIS_SETTLE_MS);
    return () => clearTimeout(t);
  }, [targetLo, targetHi]);
  const yMin = useTweenedNumber(axis.lo, { duration: 380 });
  const yMax = useTweenedNumber(axis.hi, { duration: 380 });

  const refY = fn ? fn(hasCurve ? { ...vals, [xVar]: refX } : vals) : NaN;
  const refY0 = fn ? fn(hasCurve ? { ...initVals, [xVar]: refX } : initVals) : NaN;
  const shownY = useTweenedNumber(Number.isFinite(refY) ? refY : 0, { duration: 320 });
  const changed = vars.some((v) => vals[v.name] !== initVals[v.name]);

  if (!fn) return null;
  if (hasCurve && pts.length < 2) return null;

  const span = yMax - yMin || 1;
  const px = (x) => PAD + ((x - x0) / (x1 - x0)) * (W - 2 * PAD);
  const py = (y) => H - PAD - ((y - yMin) / span) * (H - 2 * PAD);
  const pathOf = (P) => P.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(' ');
  const { ticks } = niceTicks(yMin, yMax, 4);
  const xTicks = niceTicks(x0, x1, 6).ticks.filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9);
  const mx = px(refX);
  const flip = mx > W - PAD - 110;

  const moveMarker = (e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const x = x0 + ((vx - PAD) / (W - 2 * PAD)) * (x1 - x0);
    const snap = (x1 - x0) / 200;
    setRefX(Math.min(x1, Math.max(x0, Math.round(x / snap) * snap)));
  };

  return (
    <div className="block-frame" data-running="false" data-done="false" data-phase={hasCurve ? 'curve' : 'value'}
      data-changed={changed ? 'true' : 'false'} data-value={Number.isFinite(refY) ? +refY.toPrecision(6) : ''}>
      {title && <p style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.4rem' }}>{title}</p>}
      <p className="muted" style={{ fontFamily: 'monospace', fontSize: '0.82rem', marginBottom: '0.6rem' }}>ƒ = {expr}</p>
      {hasCurve ? (
        <svg ref={svgRef} className="viz-svg om-gen-sim" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title || 'Simulator'}
          data-demo="plot"
          onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } moveMarker(e); }}
          onPointerMove={(e) => dragging.current && moveMarker(e)}
          onPointerUp={() => { dragging.current = false; }}
          onPointerCancel={() => { dragging.current = false; }}
          onClick={moveMarker}>
          <defs>
            <clipPath id={clipId}><rect x={PAD} y={PAD - 8} width={W - 2 * PAD} height={H - 2 * PAD + 8} /></clipPath>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD} y1={py(v)} x2={W - PAD} y2={py(v)} stroke="rgba(127,216,232,0.07)" />
              <text x={PAD - 6} y={py(v) + 3} textAnchor="end" fill="#5d7a8c" fontSize="9">{fmtNum(v)}</text>
            </g>
          ))}
          {xTicks.map((v) => (
            <text key={`x${v}`} x={px(v)} y={H - PAD + 13} textAnchor="middle" fill="#5d7a8c" fontSize="9">{fmtNum(v)}</text>
          ))}
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(127,216,232,0.3)" />
          <line x1={PAD} y1={PAD - 8} x2={PAD} y2={H - PAD} stroke="rgba(127,216,232,0.3)" />
          <text x={W - PAD} y={H - 12} textAnchor="end" fill="#5d7a8c" fontSize="11">{xVar} →</text>
          <text x={10} y={PAD - 14} fill="#5d7a8c" fontSize="11">{yLabel || 'ƒ'} ↑</text>
          <g clipPath={`url(#${clipId})`}>
            {changed && <path d={pathOf(ghost)} fill="none" stroke="#7fd8e8" strokeOpacity="0.35" strokeWidth="1.6" strokeDasharray="5 5" data-demo="ghost" />}
            <path d={pathOf(pts)} fill="none" stroke="#2ee6ff" strokeWidth="2.4" strokeLinejoin="round" />
            {/* the reference marker: where the curve sits at one x, and where it started */}
            <line x1={mx} y1={PAD - 8} x2={mx} y2={H - PAD} stroke="rgba(127,216,232,0.28)" strokeDasharray="3 4" />
            {changed && Number.isFinite(refY0) && <circle cx={mx} cy={py(refY0)} r="4.5" fill="none" stroke="#7fd8e8" strokeOpacity="0.6" strokeWidth="1.4" />}
            {Number.isFinite(refY) && <circle cx={mx} cy={py(refY)} r="5.5" fill="#2ee6ff" className="glow" data-demo="marker" />}
          </g>
          {Number.isFinite(refY) && (
            <text x={flip ? mx - 10 : mx + 10} y={Math.min(H - PAD - 6, Math.max(PAD + 4, py(refY) - 10))} textAnchor={flip ? 'end' : 'start'}
              fill="#fff" fontSize="11" className="om-gen-halo" data-demo="readout">
              ƒ({xVar}={fmtNum(refX)}) = <tspan fontWeight="700">{fmtNum(shownY)}</tspan>
              {changed && Number.isFinite(refY0) && <tspan fill="#9db8c6"> · was {fmtNum(refY0)}</tspan>}
            </text>
          )}
        </svg>
      ) : (
        <div className="center" style={{ padding: '1.4rem 0' }}>
          <span className="om-gen-sim-value" data-demo="readout">{Number.isFinite(refY) ? shownY.toFixed(4) : '—'}</span>
          {changed && Number.isFinite(refY0) && Number.isFinite(refY) && (
            <div className="om-gen-sim-delta om-enter">
              started at {refY0.toFixed(4)} · <b className={refY >= refY0 ? 'up' : 'down'}>{refY >= refY0 ? '+' : '−'}{Math.abs(refY - refY0).toFixed(4)}</b>
            </div>
          )}
        </div>
      )}
      <div className="dial-row">
        {vars.map((v) => (
          <label key={v.name} className="dial">
            {v.name} <b>{Number(vals[v.name]).toFixed(2)}</b>
            <input type="range" min={v.min} max={v.max} step={v.step ?? (v.max - v.min) / 100}
              value={vals[v.name]} data-demo={`var-${v.name}`}
              onChange={(e) => setVals((s) => ({ ...s, [v.name]: Number(e.target.value) }))} />
          </label>
        ))}
        {changed && (
          <button type="button" className="btn btn--ghost om-gen-mini om-enter" style={{ alignSelf: 'flex-end' }} data-demo="reset"
            onClick={() => setVals(initVals)}>↺ Reset</button>
        )}
      </div>
      <p className="block-hint">
        Drag the sliders — the {hasCurve ? 'curve redraws' : 'value updates'} live from the formula above.
        {hasCurve && ' The dashed line is where you started; click the plot to move the marker.'}
      </p>
    </div>
  );
}

/* ============ SequenceBlock: LLM-authored animated stage walkthrough ============ */

const SEQ_AUTO_MS = 1600; // auto-play: one stage per beat, one pass, then stop
const SEQ_W = 620;

/** Fit a stage label under its circle: one line, else two, shrinking the font before truncating. */
function fitLabel(label, room) {
  for (let fs = 10.5; fs >= 8.5; fs -= 0.5) {
    const chars = Math.max(4, Math.floor(room / (fs * 0.56)));
    if (label.length <= chars) return { fs, lines: [label] };
    const lines = wrapLabel(label, chars, 2);
    if (!lines[1]?.endsWith('…') && lines.every((l) => l.length <= chars)) return { fs, lines };
  }
  return { fs: 8.5, lines: wrapLabel(label, Math.max(4, Math.floor(room / (8.5 * 0.56))), 2) };
}

export function SequenceBlock({ stages = [] }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const n = Array.isArray(stages) ? stages.length : 0;
  useEffect(() => {
    if (!auto) return undefined;
    if (i >= n - 1) { setAuto(false); return undefined; } // one pass, then stop on the last stage
    const t = setTimeout(() => setI((x) => Math.min(n - 1, x + 1)), SEQ_AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, i, n]);
  if (!Array.isArray(stages) || n < 2) return null;

  const gap = SEQ_W / n;
  const last = i === n - 1;
  const go = (to) => { setI(to); setAuto(false); };
  const toggleAuto = () => {
    if (auto) { setAuto(false); return; }
    if (last) setI(0);
    setAuto(true);
  };

  return (
    <div className="block-frame" data-running={auto ? 'true' : 'false'} data-done={last ? 'true' : 'false'}
      data-phase={i} data-stages={n}>
      <svg className="viz-svg" viewBox={`0 0 ${SEQ_W} 120`} role="img" aria-label="Sequence">
        <defs>
          <marker id="sqArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 z" fill="#7fd8e8" />
          </marker>
        </defs>
        {stages.map((s, si) => {
          const x = gap * si + gap / 2;
          const on = si === i;
          const { fs, lines } = fitLabel(s.label, gap - 8);
          return (
            <g key={si} className="dg-node" role="button" tabIndex={0} aria-pressed={on} aria-label={`Stage ${si + 1}: ${s.label}`}
              data-demo="stage" data-idx={si}
              onClick={() => go(si)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(si); } }}>
              <title>{s.label}</title>
              {si < n - 1 && (
                <line x1={x + 34} y1={56} x2={x + gap - 34} y2={56}
                  stroke="rgba(127,216,232,0.5)" strokeWidth="2"
                  className={on ? 'flow-anim' : ''} markerEnd="url(#sqArr)" />
              )}
              {/* auto-play: the arrow out of the current stage fills up until the next stage lights */}
              {on && auto && si < n - 1 && (
                <path key={`fill-${si}`} d={`M${x + 34} 56 L${x + gap - 36} 56`} stroke="#7fd8e8" strokeWidth="2.6" fill="none"
                  pathLength="1" className="om-draw-in" style={{ animationDuration: `${SEQ_AUTO_MS}ms`, animationTimingFunction: 'linear' }} />
              )}
              <circle cx={x} cy={56} r={on ? 30 : 24}
                fill={on ? 'rgba(22,184,216,0.28)' : si < i ? 'rgba(53,208,165,0.15)' : 'rgba(8,26,42,0.9)'}
                stroke={on ? '#2acbe9' : si < i ? '#35d0a5' : 'rgba(127,216,232,0.4)'}
                strokeWidth={on ? 2.4 : 1.3} className={`om-gen-seq-dot ${on ? 'glow' : ''}`} />
              <text x={x} y={61} textAnchor="middle" fill="#fff" fontSize="13">{si + 1}</text>
              <text x={x} y={lines.length > 1 ? 99 : 104} textAnchor="middle" fill={on ? '#fff' : '#9db8c6'} fontSize={fs} className="om-gen-seq-label">
                {lines.map((l, li) => <tspan key={li} x={x} dy={li ? fs + 2 : 0}>{l}</tspan>)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="dg-detail" role="status" data-demo="detail">
        <span key={i} className="om-swap om-gen-block"><b>{i + 1}. {stages[i].label}:</b> {stages[i].detail}</span>
      </div>
      <div className="stepper-row">
        <button className="btn btn--ghost" data-demo="back" onClick={() => go(Math.max(0, i - 1))} disabled={i === 0}>← Back</button>
        <button className="btn btn--primary" data-demo="next" onClick={() => go(Math.min(n - 1, i + 1))} disabled={last}>Next →</button>
        <button className="btn" data-demo="autoplay" onClick={toggleAuto}>{auto ? '❚❚ Pause tour' : last ? '↺ Replay' : '▶ Auto-play'}</button>
      </div>
    </div>
  );
}
