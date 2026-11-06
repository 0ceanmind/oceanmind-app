import { useEffect, useMemo, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween, useTweenedNumber } from '../../lib/motion.js';
import './nn-a.css';

/**
 * Feed-forward, one animated step at a time: a real 2-3-1 network with visible
 * numbers. Each click sends the signal one layer along the edges, and the
 * numbers land when it arrives.
 */
const NET = {
  w1: [[0.9, -0.4], [0.3, 0.8], [-0.7, 0.5]], // 3 hidden neurons × 2 inputs
  b1: [0.1, -0.2, 0.3],
  w2: [[0.8, -0.5, 0.6]], // 1 output × 3 hidden
  b2: [0.2],
};
const sig = (x) => 1 / (1 + Math.exp(-x));

const POS = {
  in: [{ x: 80, y: 90 }, { x: 80, y: 210 }],
  hid: [{ x: 300, y: 60 }, { x: 300, y: 150 }, { x: 300, y: 240 }],
  out: [{ x: 520, y: 150 }],
};
// edge endpoints (on the node rims), shared by the lines and the travelling pulses
const IH = POS.in.flatMap((a, i) => POS.hid.map((b, j) => ({ i, j, x1: a.x + 24, y1: a.y, x2: b.x - 24, y2: b.y, w: NET.w1[j][i] })));
const HO = POS.hid.map((a, j) => ({ j, x1: a.x + 24, y1: a.y, x2: POS.out[0].x - 24, y2: POS.out[0].y, w: NET.w2[0][j] }));
const PULSE_MS = 650; // signal travel time; the numbers land when it arrives

/** A number that glides between values. */
function Num({ value, digits }) {
  const v = useTweenedNumber(value, { duration: 420 });
  return v.toFixed(digits);
}

export default function ForwardPassBlock() {
  const [x1, setX1] = useState(0.6);
  const [x2, setX2] = useState(-0.4);
  const [phase, setPhase] = useState(0); // 0 inputs · 1 hidden z · 2 hidden a · 3 output
  const [shown, setShown] = useState(0); // the phase whose numbers are on the nodes (lags while a pulse travels)
  const [pulse, setPulse] = useState(null); // { layer: 'ih' | 'ho' | 'act', t }
  const flight = useRef(null);

  useEffect(() => () => flight.current?.cancel(), []);

  const calc = useMemo(() => {
    const inputs = [x1, x2];
    const hz = NET.w1.map((w, j) => w[0] * x1 + w[1] * x2 + NET.b1[j]);
    const ha = hz.map(Math.tanh);
    const oz = NET.w2[0][0] * ha[0] + NET.w2[0][1] * ha[1] + NET.w2[0][2] * ha[2] + NET.b2[0];
    return { inputs, hz, ha, out: sig(oz), oz };
  }, [x1, x2]);

  const goTo = (next) => {
    flight.current?.cancel();
    flight.current = null;
    setPhase(next);
    // stepping back, or no motion wanted: the numbers change at once
    if (next < phase || prefersReducedMotion()) {
      setPulse(null);
      setShown(next);
      return;
    }
    const layer = next === 1 ? 'ih' : next === 3 ? 'ho' : 'act';
    flight.current = tween({
      from: 0, to: 1, duration: PULSE_MS, easing: ease.inOutCubic,
      onUpdate: (t) => setPulse({ layer, t }),
      onDone: () => {
        flight.current = null;
        setPulse(null);
        setShown(next);
      },
    });
  };

  const msgs = [
    <><b>Phase 1 — inputs.</b> Two numbers enter the network: x₁ = {x1.toFixed(1)}, x₂ = {x2.toFixed(1)}. Drag the sliders to change them, then step forward.</>,
    <><b>Phase 2 — weighted sums.</b> Each hidden neuron computes its own z = w·x + b. Neuron 1: {NET.w1[0][0]}·{x1.toFixed(1)} + ({NET.w1[0][1]})·{x2.toFixed(1)} + {NET.b1[0]} = <b>{calc.hz[0].toFixed(2)}</b>. Three neurons, three different views of the same inputs.</>,
    <><b>Phase 3 — activation.</b> Each z goes through tanh, which squashes it into (−1, 1): [{calc.hz.map((z) => z.toFixed(2)).join(', ')}] → [<b>{calc.ha.map((a) => a.toFixed(2)).join(', ')}</b>]. This non-linearity is what lets networks learn curves.</>,
    <><b>Phase 4 — output.</b> The output neuron combines the three activations: z = {calc.oz.toFixed(2)} → sigmoid → <b>{calc.out.toFixed(3)}</b>. Read it as a probability. That's a complete forward pass — no magic, just arithmetic flowing left to right.</>,
  ];

  const nodeFill = (layer) => {
    const active = (layer === 'in' && shown >= 0) || (layer === 'hid' && shown >= 1) || (layer === 'out' && shown >= 3);
    return active ? 'rgba(22,184,216,0.25)' : 'rgba(127,216,232,0.05)';
  };
  const edgeColor = (w) => (w >= 0 ? '#2ee6ff' : '#ff8a6b');
  // Each layer of edges is "next" (a dim idle flow hinting where the signal
  // goes), "hot" (carrying it right now), "done" (a calm flow) or not yet reached.
  const edgeState = (at) => (phase === at ? 'hot' : phase > at ? 'done' : phase === at - 1 ? 'next' : 'off');
  const edgeClass = (at) => ({ hot: ' flow-anim', done: ' flow-anim om-flow-idle', next: ' flow-anim om-flow-idle', off: '' })[edgeState(at)];
  const edgeOpacity = (at) => ({ hot: 0.8, done: 0.8, next: 0.3, off: 0.22 })[edgeState(at)];

  return (
    <div className="block-frame" data-phase={phase} data-shown-phase={shown} data-travelling={pulse ? 'true' : 'false'}>
      <svg className="viz-svg" viewBox="0 0 640 300" role="img" aria-label="Feed-forward network, step by step">
        {/* edges in→hid (carry the signal at phase 1) */}
        {IH.map((e) => (
          <line key={`ih${e.i}${e.j}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={edgeColor(e.w)}
            strokeWidth={0.6 + Math.abs(e.w) * 2}
            style={{ opacity: edgeOpacity(1) }}
            className={`om-stroke-ease${edgeClass(1)}`} />
        ))}
        {/* edges hid→out (carry it at phase 3) */}
        {HO.map((e) => (
          <line key={`ho${e.j}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
            stroke={edgeColor(e.w)}
            strokeWidth={0.6 + Math.abs(e.w) * 2}
            style={{ opacity: edgeOpacity(3) }}
            className={`om-stroke-ease${edgeClass(3)}`} />
        ))}
        {/* the signal travelling along the active layer's edges */}
        {pulse && pulse.layer !== 'act' && (pulse.layer === 'ih' ? IH : HO).map((e, k) => (
          <circle key={`p${k}`} className="om-nna-pulse"
            cx={e.x1 + (e.x2 - e.x1) * pulse.t} cy={e.y1 + (e.y2 - e.y1) * pulse.t}
            r={2.5 + Math.abs(e.w) * 2} fill={edgeColor(e.w)} />
        ))}
        {/* nodes */}
        {POS.in.map((p, i) => (
          <g key={`i${i}`}>
            <circle cx={p.x} cy={p.y} r="24" fill={nodeFill('in')} stroke="#7fd8e8" strokeWidth="1.4"
              className={`om-glide-slow${phase === 0 ? ' glow' : ''}`} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="12">{calc.inputs[i].toFixed(1)}</text>
            <text x={p.x} y={p.y - 32} textAnchor="middle" fill="#9db8c6" fontSize="11">x{i + 1}</text>
          </g>
        ))}
        {POS.hid.map((p, j) => (
          <g key={`h${j}`}>
            <circle cx={p.x} cy={p.y} r="24" fill={nodeFill('hid')} stroke="#16b8d8" strokeWidth="1.4"
              className={`om-glide-slow${phase === 1 || phase === 2 ? ' glow' : ''}`} />
            {/* tanh "squeezing" the value: a ring closes in on the node while phase 2 plays */}
            {pulse?.layer === 'act' && (
              <circle cx={p.x} cy={p.y} r={24 + 14 * (1 - pulse.t)} fill="none" stroke="#35d0a5" strokeWidth="1.6" style={{ opacity: 0.15 + 0.6 * pulse.t }} />
            )}
            {/* a ring bursts when the signal lands (phase 1) and when tanh squashes it (phase 2) */}
            {shown >= 1 && shown <= 2 && <circle key={`r${shown}`} cx={p.x} cy={p.y} r="24" className="om-nna-ring" stroke="#16b8d8" />}
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="11">
              {shown < 1 ? '?' : <Num value={shown === 1 ? calc.hz[j] : calc.ha[j]} digits={2} />}
            </text>
            <text x={p.x} y={p.y - 32} textAnchor="middle" fill="#9db8c6" fontSize="10">
              {shown <= 1 ? `z${j + 1}` : `tanh(z${j + 1})`}
            </text>
          </g>
        ))}
        <g>
          <circle cx={POS.out[0].x} cy={POS.out[0].y} r="26" fill={nodeFill('out')} stroke="#35d0a5" strokeWidth="1.6"
            className={`om-glide-slow${phase === 3 ? ' glow' : ''}`} />
          {shown >= 3 && <circle cx={POS.out[0].x} cy={POS.out[0].y} r="26" className="om-nna-ring" stroke="#35d0a5" />}
          <text x={POS.out[0].x} y={POS.out[0].y + 4} textAnchor="middle" fill="#fff" fontSize="12">
            {shown >= 3 ? <Num value={calc.out} digits={3} /> : '?'}
          </text>
          <text x={POS.out[0].x} y={POS.out[0].y - 34} textAnchor="middle" fill="#9db8c6" fontSize="11">ŷ</text>
        </g>
      </svg>

      <div className="stepper-row">
        <button className="btn btn--ghost" data-demo="back" onClick={() => goTo(Math.max(0, phase - 1))} disabled={phase === 0}>← Back</button>
        <button className="btn btn--primary" data-demo="step" onClick={() => goTo(Math.min(3, phase + 1))} disabled={phase === 3}>
          Step forward →
        </button>
        <label className="dial">x₁ <b>{x1.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x1} data-demo="x1" onChange={(e) => setX1(+e.target.value)} /></label>
        <label className="dial">x₂ <b>{x2.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x2} data-demo="x2" onChange={(e) => setX2(+e.target.value)} /></label>
      </div>
      <div className="stepper-msg om-swap" role="status" key={phase} data-demo="msg">{msgs[phase]}</div>
    </div>
  );
}
