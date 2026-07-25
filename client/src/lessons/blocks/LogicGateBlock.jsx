import { useEffect, useRef, useState } from 'react';

/**
 * "Emulating logical gates with a perceptron" — straight from the source deck.
 * Pick a gate; a single perceptron tries to learn it. AND/OR/NAND converge;
 * XOR never does (not linearly separable) — the classic lesson, made live.
 */
const GATES = {
  AND: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
  OR: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
  NAND: [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
  XOR: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
};
const W = 340, H = 300, PAD = 60;
const gx = (v) => PAD + v * (W - 2 * PAD);
const gy = (v) => H - PAD - v * (H - 2 * PAD);

export default function LogicGateBlock() {
  const [gate, setGate] = useState('AND');
  const [w, setW] = useState([0.2, -0.1]);
  const [b, setB] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState(4);
  const timer = useRef(null);
  const st = useRef({ w, b, gate });
  st.current = { w, b, gate };

  useEffect(() => () => clearInterval(timer.current), []);

  const reset = (g = gate) => {
    clearInterval(timer.current);
    setRunning(false);
    setW([0.2, -0.1]); setB(0); setEpoch(0);
    const data = GATES[g];
    setErrors(data.filter(([x1, x2, y]) => (0.2 * x1 - 0.1 * x2 + 0 >= 0 ? 1 : 0) !== y).length);
  };

  const train = () => {
    if (running) { clearInterval(timer.current); setRunning(false); return; }
    setRunning(true);
    timer.current = setInterval(() => {
      const { w: cw, b: cb, gate: g } = st.current;
      const data = GATES[g];
      let nw = [...cw], nb = cb, wrong = 0;
      for (const [x1, x2, y] of data) {
        const pred = nw[0] * x1 + nw[1] * x2 + nb >= 0 ? 1 : 0;
        const err = y - pred;
        if (err !== 0) { wrong++; nw[0] += 0.1 * err * x1; nw[1] += 0.1 * err * x2; nb += 0.1 * err; }
      }
      setW(nw); setB(nb); setErrors(wrong);
      setEpoch((e) => {
        if (e > 60 || wrong === 0) { clearInterval(timer.current); setRunning(false); }
        return e + 1;
      });
    }, 260);
  };

  const data = GATES[gate];
  // boundary w0*x + w1*y + b = 0
  let line = null;
  if (Math.abs(w[1]) > 1e-6) {
    const yAt = (x) => (-b - w[0] * x) / w[1];
    line = { x1: gx(-0.2), y1: gy(yAt(-0.2)), x2: gx(1.2), y2: gy(yAt(1.2)) };
  }
  const solved = errors === 0;

  return (
    <div className="block-frame">
      <div className="seg" role="group" aria-label="Logic gate" style={{ marginBottom: '0.7rem' }}>
        {Object.keys(GATES).map((g) => (
          <button key={g} className={gate === g ? 'on' : ''} onClick={() => { setGate(g); reset(g); }}>{g}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 340 }} role="img" aria-label={`${gate} gate perceptron`}>
          <line x1={PAD} y1={gy(0)} x2={W - PAD} y2={gy(0)} stroke="rgba(127,216,232,0.25)" />
          <line x1={gx(0)} y1={H - PAD} x2={gx(0)} y2={PAD} stroke="rgba(127,216,232,0.25)" />
          <text x={gx(0)} y={gy(0) + 22} textAnchor="middle" fill="#5d7a8c" fontSize="11">0</text>
          <text x={gx(1)} y={gy(0) + 22} textAnchor="middle" fill="#5d7a8c" fontSize="11">1  (x₁)</text>
          <text x={gx(0) - 16} y={gy(1)} textAnchor="end" fill="#5d7a8c" fontSize="11">1 (x₂)</text>
          {line && <line {...line} stroke={solved ? '#35d0a5' : '#7fd8e8'} strokeWidth="2.4" className="glow" />}
          {data.map(([x1, x2, y], i) => {
            const pred = w[0] * x1 + w[1] * x2 + b >= 0 ? 1 : 0;
            const wrong = pred !== y;
            return (
              <g key={i}>
                <circle cx={gx(x1)} cy={gy(x2)} r="11"
                  fill={y === 1 ? '#2ee6ff' : '#ff8a6b'}
                  stroke={wrong ? '#ffce6b' : 'rgba(3,10,18,0.9)'} strokeWidth={wrong ? 3 : 1.5} />
                <text x={gx(x1)} y={gy(x2) + 4} textAnchor="middle" fill="#04202e" fontSize="11" fontWeight="700">{y}</text>
              </g>
            );
          })}
        </svg>
        <div style={{ flex: 1, minWidth: 200 }}>
          <table className="gate-truth">
            <thead><tr><th>x₁</th><th>x₂</th><th>{gate}</th><th>perceptron</th></tr></thead>
            <tbody>
              {data.map(([x1, x2, y], i) => {
                const pred = w[0] * x1 + w[1] * x2 + b >= 0 ? 1 : 0;
                return (
                  <tr key={i}>
                    <td>{x1}</td><td>{x2}</td><td>{y}</td>
                    <td style={{ color: pred === y ? 'var(--kelp)' : 'var(--danger)' }}>{pred} {pred === y ? '✓' : '✗'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={train}>{running ? '❚❚ Pause' : '▶ Train perceptron'}</button>
        <button className="btn btn--ghost" onClick={() => reset()}>Reset</button>
        <div className="stepper-msg">
          epoch <b>{epoch}</b> · <b>{errors}</b>/4 wrong ·{' '}
          {gate === 'XOR'
            ? <span style={{ color: 'var(--coral)' }}>XOR is <b>not linearly separable</b> — one straight line can never split it. Watch the perceptron fail forever. That’s exactly why we need hidden layers.</span>
            : solved ? <span style={{ color: 'var(--kelp)' }}>Solved! One line cleanly separates the classes — {gate} is linearly separable.</span>
            : 'Training… the line rotates to separate teal (1) from coral (0).'}
        </div>
      </div>
    </div>
  );
}
