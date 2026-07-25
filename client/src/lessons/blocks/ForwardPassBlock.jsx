import { useMemo, useState } from 'react';

/**
 * Feed-forward, one animated step at a time: a real 2-3-1 network with visible
 * numbers. Each click advances the signal one layer, showing the exact math.
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

export default function ForwardPassBlock() {
  const [x1, setX1] = useState(0.6);
  const [x2, setX2] = useState(-0.4);
  const [phase, setPhase] = useState(0); // 0 inputs · 1 hidden z · 2 hidden a · 3 output

  const calc = useMemo(() => {
    const inputs = [x1, x2];
    const hz = NET.w1.map((w, j) => w[0] * x1 + w[1] * x2 + NET.b1[j]);
    const ha = hz.map(Math.tanh);
    const oz = NET.w2[0][0] * ha[0] + NET.w2[0][1] * ha[1] + NET.w2[0][2] * ha[2] + NET.b2[0];
    return { inputs, hz, ha, out: sig(oz), oz };
  }, [x1, x2]);

  const msgs = [
    <><b>Phase 1 — inputs.</b> Two numbers enter the network: x₁ = {x1.toFixed(1)}, x₂ = {x2.toFixed(1)}. Drag the sliders to change them, then step forward.</>,
    <><b>Phase 2 — weighted sums.</b> Each hidden neuron computes its own z = w·x + b. Neuron 1: {NET.w1[0][0]}·{x1.toFixed(1)} + ({NET.w1[0][1]})·{x2.toFixed(1)} + {NET.b1[0]} = <b>{calc.hz[0].toFixed(2)}</b>. Three neurons, three different views of the same inputs.</>,
    <><b>Phase 3 — activation.</b> Each z goes through tanh, which squashes it into (−1, 1): [{calc.hz.map((z) => z.toFixed(2)).join(', ')}] → [<b>{calc.ha.map((a) => a.toFixed(2)).join(', ')}</b>]. This non-linearity is what lets networks learn curves.</>,
    <><b>Phase 4 — output.</b> The output neuron combines the three activations: z = {calc.oz.toFixed(2)} → sigmoid → <b>{calc.out.toFixed(3)}</b>. Read it as a probability. That's a complete forward pass — no magic, just arithmetic flowing left to right.</>,
  ];

  const nodeFill = (layer) => {
    const active = (layer === 'in' && phase >= 0) || (layer === 'hid' && phase >= 1) || (layer === 'out' && phase >= 3);
    return active ? 'rgba(22,184,216,0.25)' : 'rgba(127,216,232,0.05)';
  };

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 640 300" role="img" aria-label="Feed-forward network, step by step">
        {/* edges in→hid */}
        {POS.in.map((a, i) =>
          POS.hid.map((b, j) => (
            <line key={`ih${i}${j}`} x1={a.x + 24} y1={a.y} x2={b.x - 24} y2={b.y}
              stroke={NET.w1[j][i] >= 0 ? '#2ee6ff' : '#ff8a6b'}
              strokeWidth={0.6 + Math.abs(NET.w1[j][i]) * 2}
              opacity={phase >= 1 ? 0.8 : 0.22}
              className={phase === 1 ? 'flow-anim' : ''} />
          ))
        )}
        {/* edges hid→out */}
        {POS.hid.map((a, j) => (
          <line key={`ho${j}`} x1={a.x + 24} y1={a.y} x2={POS.out[0].x - 24} y2={POS.out[0].y}
            stroke={NET.w2[0][j] >= 0 ? '#2ee6ff' : '#ff8a6b'}
            strokeWidth={0.6 + Math.abs(NET.w2[0][j]) * 2}
            opacity={phase >= 3 ? 0.8 : 0.22}
            className={phase === 3 ? 'flow-anim' : ''} />
        ))}
        {/* nodes */}
        {POS.in.map((p, i) => (
          <g key={`i${i}`}>
            <circle cx={p.x} cy={p.y} r="24" fill={nodeFill('in')} stroke="#7fd8e8" strokeWidth="1.4" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="12">{calc.inputs[i].toFixed(1)}</text>
            <text x={p.x} y={p.y - 32} textAnchor="middle" fill="#9db8c6" fontSize="11">x{i + 1}</text>
          </g>
        ))}
        {POS.hid.map((p, j) => (
          <g key={`h${j}`}>
            <circle cx={p.x} cy={p.y} r="24" fill={nodeFill('hid')} stroke="#16b8d8" strokeWidth="1.4"
              className={phase === 1 || phase === 2 ? 'glow' : ''} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="11">
              {phase < 1 ? '?' : phase === 1 ? calc.hz[j].toFixed(2) : calc.ha[j].toFixed(2)}
            </text>
            <text x={p.x} y={p.y - 32} textAnchor="middle" fill="#9db8c6" fontSize="10">
              {phase <= 1 ? `z${j + 1}` : `tanh(z${j + 1})`}
            </text>
          </g>
        ))}
        <g>
          <circle cx={POS.out[0].x} cy={POS.out[0].y} r="26" fill={nodeFill('out')} stroke="#35d0a5" strokeWidth="1.6"
            className={phase === 3 ? 'glow' : ''} />
          <text x={POS.out[0].x} y={POS.out[0].y + 4} textAnchor="middle" fill="#fff" fontSize="12">
            {phase >= 3 ? calc.out.toFixed(3) : '?'}
          </text>
          <text x={POS.out[0].x} y={POS.out[0].y - 34} textAnchor="middle" fill="#9db8c6" fontSize="11">ŷ</text>
        </g>
      </svg>

      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => setPhase(Math.max(0, phase - 1))} disabled={phase === 0}>← Back</button>
        <button className="btn btn--primary" onClick={() => setPhase(Math.min(3, phase + 1))} disabled={phase === 3}>
          Step forward →
        </button>
        <label className="dial">x₁ <b>{x1.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x1} onChange={(e) => setX1(+e.target.value)} /></label>
        <label className="dial">x₂ <b>{x2.toFixed(1)}</b><input type="range" min="-1" max="1" step="0.1" value={x2} onChange={(e) => setX2(+e.target.value)} /></label>
      </div>
      <div className="stepper-msg" role="status">{msgs[phase]}</div>
    </div>
  );
}
