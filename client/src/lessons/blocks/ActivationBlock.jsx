import { useEffect, useRef, useState } from 'react';
import './nn-a.css';

const FNS = {
  sigmoid: { f: (x) => 1 / (1 + Math.exp(-x)), color: '#2ee6ff', range: [0, 1], desc: 'Squashes anything into (0,1) — great for probabilities, but saturates at the ends.' },
  tanh: { f: Math.tanh, color: '#35d0a5', range: [-1, 1], desc: 'Like sigmoid but centered at 0 — outputs in (−1,1), often trains faster.' },
  relu: { f: (x) => Math.max(0, x), color: '#ff8a6b', range: [0, 4], desc: 'Zero for negatives, identity for positives — cheap, and the default in deep nets.' },
};

const W = 620, H = 260, PAD = 40;
const xMin = -4, xMax = 4, yMin = -1.2, yMax = 1.6;
const px = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
const py = (y) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);
const LEAVE_MS = 380; // a toggled-off curve fades out before it unmounts

const curve = (fn) => {
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const cx = xMin + (i / 120) * (xMax - xMin);
    const cy = Math.max(yMin, Math.min(yMax, fn(cx)));
    d += `${i === 0 ? 'M' : 'L'}${px(cx).toFixed(1)} ${py(cy).toFixed(1)} `;
  }
  return d;
};
const CURVES = Object.fromEntries(Object.entries(FNS).map(([k, v]) => [k, curve(v.f)]));

/** Live activation-function explorer: drag x, compare curves. */
export default function ActivationBlock() {
  const [active, setActive] = useState(['sigmoid', 'relu']);
  const [leaving, setLeaving] = useState([]);
  const [x, setX] = useState(1.0);
  const timers = useRef({});

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const toggle = (k) => {
    if (active.includes(k)) {
      if (active.length === 1) return; // the last active curve stays
      setActive((a) => a.filter((v) => v !== k));
      setLeaving((l) => [...l.filter((v) => v !== k), k]);
      clearTimeout(timers.current[k]);
      timers.current[k] = setTimeout(() => setLeaving((l) => l.filter((v) => v !== k)), LEAVE_MS);
    } else {
      clearTimeout(timers.current[k]);
      setLeaving((l) => l.filter((v) => v !== k));
      setActive((a) => [...a, k]);
    }
  };

  // draw order stays fixed (sigmoid, tanh, relu) so a toggle never reorders the SVG
  const shown = Object.keys(FNS).filter((k) => active.includes(k) || leaving.includes(k));

  return (
    <div className="block-frame" data-active={active.join(',')} data-x={x.toFixed(1)}>
      <div className="seg" role="group" aria-label="Activation functions">
        {Object.entries(FNS).map(([k, v]) => (
          <button key={k} className={active.includes(k) ? 'on' : ''} data-demo={`fn-${k}`} onClick={() => toggle(k)} style={active.includes(k) ? { color: v.color } : {}}>
            {k}
          </button>
        ))}
      </div>
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activation function curves" style={{ marginTop: '0.8rem' }}>
        {/* axes */}
        <line x1={px(xMin)} y1={py(0)} x2={px(xMax)} y2={py(0)} stroke="rgba(127,216,232,0.25)" />
        <line x1={px(0)} y1={py(yMin)} x2={px(0)} y2={py(yMax)} stroke="rgba(127,216,232,0.25)" />
        {[-4, -2, 2, 4].map((t) => <text key={t} x={px(t)} y={py(0) + 16} textAnchor="middle" fill="#5d7a8c" fontSize="10">{t}</text>)}
        {[-1, 1].map((t) => <text key={t} x={px(0) - 10} y={py(t) + 3} textAnchor="end" fill="#5d7a8c" fontSize="10">{t}</text>)}
        {/* curves: each one draws itself in when toggled on and fades when toggled off */}
        {shown.map((k) => (
          <path key={k} d={CURVES[k]} pathLength="1" fill="none" stroke={FNS[k].color} strokeWidth="2.4" opacity="0.9"
            className={leaving.includes(k) ? 'om-nna-fade-out' : 'om-draw-in'} />
        ))}
        {/* live x marker: glides with the slider instead of jumping 0.1 at a time */}
        <g className="om-nna-slide" style={{ transform: `translate(${px(x)}px, 0px)` }}>
          <line x1="0" y1={py(yMin)} x2="0" y2={py(yMax)} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 5" />
        </g>
        {active.map((k) => {
          const y = Math.max(yMin, Math.min(yMax, FNS[k].f(x)));
          return (
            <g key={k} className="om-nna-slide" style={{ transform: `translate(${px(x)}px, ${py(y)}px)` }}>
              <g className="om-nna-appear">
                <circle cx="0" cy="0" r="6" fill={FNS[k].color} className="glow" />
                <text x="10" y="-8" fill={FNS[k].color} fontSize="12">{FNS[k].f(x).toFixed(2)}</text>
              </g>
            </g>
          );
        })}
      </svg>
      <div className="dial-row">
        <label className="dial" style={{ minWidth: 260 }}>
          drag the input x <b>{x.toFixed(1)}</b>
          <input type="range" min="-4" max="4" step="0.1" value={x} data-demo="x" onChange={(e) => setX(+e.target.value)} />
        </label>
      </div>
      <p className="block-hint">
        {active.map((k) => <span key={k} className="om-nna-appear"><b style={{ color: FNS[k].color }}>{k}</b>: {FNS[k].desc} </span>)}
        Notice where curves flatten — flat means tiny gradients, which is exactly where learning slows down.
      </p>
    </div>
  );
}
