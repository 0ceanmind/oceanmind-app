import { useState } from 'react';

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Interactive neuron anatomy: drag the weights and watch the output respond live. */
export default function NeuronBlock() {
  const [x1, setX1] = useState(0.8);
  const [x2, setX2] = useState(0.3);
  const [w1, setW1] = useState(1.2);
  const [w2, setW2] = useState(-0.6);
  const [b, setB] = useState(0.1);

  const z = x1 * w1 + x2 * w2 + b;
  const out = sigmoid(z);
  const wColor = (w) => (w >= 0 ? '#2ee6ff' : '#ff8a6b');
  const wWidth = (w) => Math.min(7, 1 + Math.abs(w) * 2.4);

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 640 240" role="img" aria-label="Interactive neuron diagram">
        {/* input nodes */}
        {[{ v: x1, y: 60, label: 'x₁' }, { v: x2, y: 180, label: 'x₂' }].map((inp, i) => (
          <g key={i}>
            <circle cx="70" cy={inp.y} r="26" fill="rgba(127,216,232,0.1)" stroke="#7fd8e8" strokeWidth="1.4" />
            <text x="70" y={inp.y - 34} textAnchor="middle" fill="#9db8c6" fontSize="12">{inp.label} = {inp.v.toFixed(1)}</text>
            <text x="70" y={inp.y + 5} textAnchor="middle" fill="#fff" fontSize="14">{inp.v.toFixed(1)}</text>
          </g>
        ))}
        {/* weighted connections */}
        <path d={`M96 60 C 200 60, 240 105, 306 112`} fill="none" stroke={wColor(w1)} strokeWidth={wWidth(w1)} opacity="0.85" className="flow-anim" />
        <path d={`M96 180 C 200 180, 240 135, 306 128`} fill="none" stroke={wColor(w2)} strokeWidth={wWidth(w2)} opacity="0.85" className="flow-anim" />
        <text x="200" y="48" textAnchor="middle" fill={wColor(w1)} fontSize="12">w₁ = {w1.toFixed(1)}</text>
        <text x="200" y="200" textAnchor="middle" fill={wColor(w2)} fontSize="12">w₂ = {w2.toFixed(1)}</text>
        {/* neuron body */}
        <circle cx="340" cy="120" r="42" fill="rgba(22,184,216,0.12)" stroke="#16b8d8" strokeWidth="2" className="glow" />
        <text x="340" y="112" textAnchor="middle" fill="#fff" fontSize="13">Σ + b</text>
        <text x="340" y="132" textAnchor="middle" fill="#7fd8e8" fontSize="11">z = {z.toFixed(2)}</text>
        {/* activation */}
        <path d="M382 120 L 448 120" stroke="#7fd8e8" strokeWidth="2" className="flow-anim" />
        <rect x="448" y="92" width="76" height="56" rx="14" fill="rgba(53,208,165,0.1)" stroke="#35d0a5" strokeWidth="1.4" />
        <text x="486" y="114" textAnchor="middle" fill="#35d0a5" fontSize="11">sigmoid</text>
        <path d="M460 138 C 472 138, 476 104, 512 102" fill="none" stroke="#35d0a5" strokeWidth="1.6" />
        {/* output */}
        <path d="M524 120 L 566 120" stroke="#35d0a5" strokeWidth={1 + out * 5} className="flow-anim" />
        <circle cx="592" cy="120" r="24" fill={`rgba(53,208,165,${0.1 + out * 0.5})`} stroke="#35d0a5" strokeWidth="1.6" />
        <text x="592" y="125" textAnchor="middle" fill="#fff" fontSize="12">{out.toFixed(2)}</text>
        <text x="592" y="160" textAnchor="middle" fill="#9db8c6" fontSize="11">output</text>
      </svg>

      <div className="dial-row">
        <label className="dial">input x₁ <b>{x1.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x1} onChange={(e) => setX1(+e.target.value)} /></label>
        <label className="dial">input x₂ <b>{x2.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x2} onChange={(e) => setX2(+e.target.value)} /></label>
        <label className="dial">weight w₁ <b>{w1.toFixed(1)}</b><input type="range" min="-3" max="3" step="0.1" value={w1} onChange={(e) => setW1(+e.target.value)} /></label>
        <label className="dial">weight w₂ <b>{w2.toFixed(1)}</b><input type="range" min="-3" max="3" step="0.1" value={w2} onChange={(e) => setW2(+e.target.value)} /></label>
        <label className="dial">bias b <b>{b.toFixed(1)}</b><input type="range" min="-2" max="2" step="0.1" value={b} onChange={(e) => setB(+e.target.value)} /></label>
      </div>
      <p className="block-hint">
        z = x₁·w₁ + x₂·w₂ + b = {x1.toFixed(1)}·{w1.toFixed(1)} + {x2.toFixed(1)}·{w2.toFixed(1)} + {b.toFixed(1)} = <b style={{ color: '#7fd8e8' }}>{z.toFixed(2)}</b>
        &nbsp;→ sigmoid(z) = <b style={{ color: '#35d0a5' }}>{out.toFixed(2)}</b>. Thicker lines = stronger weights; teal pulls the output up, coral pushes it down.
      </p>
    </div>
  );
}
