import { useEffect, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween } from '../../lib/motion.js';
import './nn-a.css';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Route of the pulse that runs input → output after every change. Segments
// are fractions of PULSE_MS; the dot hides while it is "inside" the body/box.
const PULSE_MS = 820;
const SEG = { w: [0, 0.42], z: [0.5, 0.7], out: [0.78, 1] };
const segT = (p, [a, b]) => (p < a || p > b ? null : (p - a) / (b - a));

// The sigmoid glyph is a real sigmoid over z ∈ [-6, 6], so the marker on it is honest.
const SIG_Z = 6;
const sgx = (z) => 486 + (Math.max(-SIG_Z, Math.min(SIG_Z, z)) / SIG_Z) * 28;
const sgy = (s) => 140 - s * 26; // below the label, so the marker never covers it
const SIG_PATH = Array.from({ length: 25 }, (_, i) => {
  const z = -SIG_Z + (i / 24) * 2 * SIG_Z;
  return `${i ? 'L' : 'M'}${sgx(z).toFixed(1)} ${sgy(sigmoid(z)).toFixed(1)}`;
}).join(' ');

// Dash speed follows the signal strength: strong weights stream fast, weak ones crawl.
const flowSecs = (m) => `${Math.max(0.35, Math.min(3, 1.5 / (0.3 + m))).toFixed(2)}s`;

function pointOn(ref, t) {
  const el = ref.current;
  if (!el || t === null) return null;
  const p = el.getPointAtLength(t * el.getTotalLength());
  return [p.x, p.y];
}

/** Interactive neuron anatomy: drag the weights and watch the output respond live. */
export default function NeuronBlock() {
  const [x1, setX1] = useState(0.8);
  const [x2, setX2] = useState(0.3);
  const [w1, setW1] = useState(1.2);
  const [w2, setW2] = useState(-0.6);
  const [b, setB] = useState(0.1);
  const [pulse, setPulse] = useState(null); // 0..1 while a pulse is travelling
  const [arrivals, setArrivals] = useState(0);

  const z = x1 * w1 + x2 * w2 + b;
  const out = sigmoid(z);
  const wColor = (w) => (w >= 0 ? '#2ee6ff' : '#ff8a6b');
  const wWidth = (w) => Math.min(7, 1 + Math.abs(w) * 2.4);
  const wOpacity = (w) => 0.6 + 0.35 * Math.min(1, Math.abs(w) / 3);

  const w1Ref = useRef(null);
  const w2Ref = useRef(null);
  const zRef = useRef(null);
  const outRef = useRef(null);

  // One pulse at a time: changes that land mid-flight queue exactly one more,
  // so a continuous slider drag becomes a steady stream that always arrives.
  const flight = useRef(null);
  const pending = useRef(false);
  const launch = useRef(null);
  launch.current = () => {
    pending.current = false;
    flight.current = tween({
      from: 0, to: 1, duration: PULSE_MS, easing: ease.linear,
      onUpdate: (v) => setPulse(v),
      onDone: () => {
        flight.current = null;
        setPulse(null);
        setArrivals((n) => n + 1);
        if (pending.current) launch.current();
      },
    });
  };
  const valuesKey = `${x1}|${x2}|${w1}|${w2}|${b}`;
  const lastKey = useRef(valuesKey);
  useEffect(() => {
    if (lastKey.current === valuesKey) return;
    lastKey.current = valuesKey;
    if (prefersReducedMotion()) return;
    if (flight.current) pending.current = true;
    else launch.current();
  }, [valuesKey]);
  useEffect(() => () => flight.current?.cancel(), []);

  const tw = pulse === null ? null : segT(pulse, SEG.w);
  const tz = pulse === null ? null : segT(pulse, SEG.z);
  const to = pulse === null ? null : segT(pulse, SEG.out);
  const dots = [
    { p: pointOn(w1Ref, tw), c: wColor(w1), r: 3 + Math.min(2.5, Math.abs(x1 * w1)) },
    { p: pointOn(w2Ref, tw), c: wColor(w2), r: 3 + Math.min(2.5, Math.abs(x2 * w2)) },
    { p: pointOn(zRef, tz), c: '#7fd8e8', r: 3 + Math.min(2.5, Math.abs(z)) },
    { p: pointOn(outRef, to), c: '#35d0a5', r: 3 + out * 3 },
  ];

  return (
    <div className="block-frame" data-z={z.toFixed(2)} data-out={out.toFixed(2)} data-pulses={arrivals}>
      <svg className="viz-svg" viewBox="0 0 640 240" role="img" aria-label="Interactive neuron diagram" data-demo="diagram">
        {/* input nodes */}
        {[{ v: x1, y: 60, label: 'x₁' }, { v: x2, y: 180, label: 'x₂' }].map((inp, i) => (
          <g key={i}>
            <circle cx="70" cy={inp.y} r="26" fill="rgba(127,216,232,0.1)" stroke="#7fd8e8" strokeWidth="1.4" />
            <text x="70" y={inp.y - 34} textAnchor="middle" fill="#9db8c6" fontSize="12">{inp.label} = {inp.v.toFixed(1)}</text>
            <text x="70" y={inp.y + 5} textAnchor="middle" fill="#fff" fontSize="14">{inp.v.toFixed(1)}</text>
          </g>
        ))}
        {/* weighted connections: thickness, colour and brightness glide; dash speed follows |w| */}
        <path ref={w1Ref} d={`M96 60 C 200 60, 240 105, 306 112`} fill="none" stroke={wColor(w1)} strokeWidth={wWidth(w1)}
          className={`flow-anim om-stroke-ease${w1 < 0 ? ' om-nna-inhib' : ''}`}
          style={{ opacity: wOpacity(w1), animationDuration: flowSecs(Math.abs(w1)) }} />
        <path ref={w2Ref} d={`M96 180 C 200 180, 240 135, 306 128`} fill="none" stroke={wColor(w2)} strokeWidth={wWidth(w2)}
          className={`flow-anim om-stroke-ease${w2 < 0 ? ' om-nna-inhib' : ''}`}
          style={{ opacity: wOpacity(w2), animationDuration: flowSecs(Math.abs(w2)) }} />
        <text x="200" y="48" textAnchor="middle" fill={wColor(w1)} fontSize="12" className="om-nna-fill-ease">w₁ = {w1.toFixed(1)}</text>
        <text x="200" y="200" textAnchor="middle" fill={wColor(w2)} fontSize="12" className="om-nna-fill-ease">w₂ = {w2.toFixed(1)}</text>
        {/* neuron body */}
        <circle cx="340" cy="120" r="42" fill="rgba(22,184,216,0.12)" stroke="#16b8d8" strokeWidth="2" className="glow" />
        <text x="340" y="112" textAnchor="middle" fill="#fff" fontSize="13">Σ + b</text>
        <text x="340" y="132" textAnchor="middle" fill="#7fd8e8" fontSize="11">z = {z.toFixed(2)}</text>
        {/* activation */}
        <path ref={zRef} d="M382 120 L 448 120" stroke="#7fd8e8" strokeWidth="2" className="flow-anim"
          style={{ animationDuration: flowSecs(Math.abs(z)) }} />
        <rect x="448" y="92" width="76" height="56" rx="14" fill="rgba(53,208,165,0.1)" stroke="#35d0a5" strokeWidth="1.4" />
        <text x="486" y="107" textAnchor="middle" fill="#35d0a5" fontSize="11">sigmoid</text>
        <path d={SIG_PATH} fill="none" stroke="#35d0a5" strokeWidth="1.6" />
        {/* where z lands on the curve */}
        <circle cx={sgx(z)} cy={sgy(out)} r="3.6" fill="#ffce6b" stroke="#0a2237" strokeWidth="1.2" className="om-glide" />
        {/* output */}
        <path ref={outRef} d="M524 120 L 566 120" stroke="#35d0a5" strokeWidth={1 + out * 5} className="flow-anim om-stroke-ease"
          style={{ animationDuration: `${(1.8 - out * 1.3).toFixed(2)}s` }} />
        <circle cx="592" cy="120" r="24" fill={`rgba(53,208,165,${0.1 + out * 0.5})`} stroke="#35d0a5" strokeWidth="1.6" className="om-glide" />
        {arrivals > 0 && <circle key={arrivals} cx="592" cy="120" r="24" className="om-nna-ring" stroke="#35d0a5" />}
        <text x="592" y="125" textAnchor="middle" fill="#fff" fontSize="12">{out.toFixed(2)}</text>
        <text x="592" y="160" textAnchor="middle" fill="#9db8c6" fontSize="11">output</text>
        {/* the travelling pulse */}
        {dots.map((d, i) => d.p && <circle key={i} cx={d.p[0]} cy={d.p[1]} r={d.r} fill={d.c} className="om-nna-pulse" />)}
      </svg>

      <div className="dial-row">
        <label className="dial">input x₁ <b>{x1.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x1} data-demo="x1" onChange={(e) => setX1(+e.target.value)} /></label>
        <label className="dial">input x₂ <b>{x2.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x2} data-demo="x2" onChange={(e) => setX2(+e.target.value)} /></label>
        <label className="dial">weight w₁ <b>{w1.toFixed(1)}</b><input type="range" min="-3" max="3" step="0.1" value={w1} data-demo="w1" onChange={(e) => setW1(+e.target.value)} /></label>
        <label className="dial">weight w₂ <b>{w2.toFixed(1)}</b><input type="range" min="-3" max="3" step="0.1" value={w2} data-demo="w2" onChange={(e) => setW2(+e.target.value)} /></label>
        <label className="dial">bias b <b>{b.toFixed(1)}</b><input type="range" min="-2" max="2" step="0.1" value={b} data-demo="bias" onChange={(e) => setB(+e.target.value)} /></label>
      </div>
      <p className="block-hint">
        z = x₁·w₁ + x₂·w₂ + b = {x1.toFixed(1)}·{w1.toFixed(1)} + {x2.toFixed(1)}·{w2.toFixed(1)} + {b.toFixed(1)} = <b style={{ color: '#7fd8e8' }}>{z.toFixed(2)}</b>
        &nbsp;→ sigmoid(z) = <b style={{ color: '#35d0a5' }}>{out.toFixed(2)}</b>. Thicker lines = stronger weights; teal pulls the output up, coral pushes it down.
      </p>
    </div>
  );
}
