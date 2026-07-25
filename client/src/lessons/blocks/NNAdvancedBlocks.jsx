import { useEffect, useMemo, useRef, useState } from 'react';

/* ============ PerceptronBlock: the perceptron learning rule, live ============ */

const PW = 620, PH = 300;
const pToCanvas = ([x, y]) => [((x + 1) / 2) * PW, (1 - (y + 1) / 2) * PH];

function makePoints() {
  const pts = [];
  for (let i = 0; i < 26; i++) {
    const label = i % 2 === 0 ? 1 : -1;
    const cx = label === 1 ? 0.4 : -0.4;
    const cy = label === 1 ? 0.3 : -0.3;
    pts.push({ x: [cx + (Math.random() - 0.5) * 0.7, cy + (Math.random() - 0.5) * 0.7], label });
  }
  return pts;
}

export function PerceptronBlock() {
  const [pts, setPts] = useState(makePoints);
  const [w, setW] = useState([0.3, -0.5]);
  const [b, setB] = useState(0.1);
  const [updates, setUpdates] = useState(0);
  const [lastMsg, setLastMsg] = useState('The line is the perceptron’s current decision boundary. Train it to separate teal from coral.');
  const [flash, setFlash] = useState(null);

  const misclassified = useMemo(
    () => pts.filter((p) => Math.sign(w[0] * p.x[0] + w[1] * p.x[1] + b) !== p.label),
    [pts, w, b]
  );

  const trainStep = () => {
    if (misclassified.length === 0) {
      setLastMsg(`Converged! Every point is on the right side after ${updates} updates — the perceptron learning rule always converges on separable data.`);
      return;
    }
    const p = misclassified[Math.floor(Math.random() * misclassified.length)];
    const lr = 0.4;
    setW(([w0, w1]) => [w0 + lr * p.label * p.x[0], w1 + lr * p.label * p.x[1]]);
    setB((bb) => bb + lr * p.label);
    setUpdates((u) => u + 1);
    setFlash(p);
    setTimeout(() => setFlash(null), 600);
    setLastMsg(`Picked a misclassified ${p.label === 1 ? 'teal' : 'coral'} point and nudged the weights toward it: w ← w + η·y·x. Watch the line move.`);
  };

  // decision line: w0*x + w1*y + b = 0
  const line = useMemo(() => {
    if (Math.abs(w[1]) < 1e-6) return null;
    const yAt = (x) => (-b - w[0] * x) / w[1];
    const [x1, y1] = pToCanvas([-1.1, yAt(-1.1)]);
    const [x2, y2] = pToCanvas([1.1, yAt(1.1)]);
    return { x1, y1, x2, y2 };
  }, [w, b]);

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Perceptron learning">
        {line && <line {...line} stroke="#7fd8e8" strokeWidth="2.4" className="glow" />}
        {pts.map((p, i) => {
          const [cx, cy] = pToCanvas(p.x);
          const wrong = misclassified.includes(p);
          return (
            <circle key={i} cx={cx} cy={cy} r={flash === p ? 9 : 5.5}
              fill={p.label === 1 ? '#2ee6ff' : '#ff8a6b'}
              stroke={wrong ? '#ffce6b' : 'rgba(3,10,18,0.9)'} strokeWidth={wrong ? 2.4 : 1.4}
              style={{ transition: 'r 0.3s' }} />
          );
        })}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={trainStep}>⚡ One learning step</button>
        <button className="btn btn--ghost" onClick={() => { setPts(makePoints()); setW([0.3, -0.5]); setB(0.1); setUpdates(0); }}>New data</button>
        <div className="stepper-msg">
          <b>{misclassified.length}</b> misclassified (gold rings) · <b>{updates}</b> updates · w = [{w[0].toFixed(2)}, {w[1].toFixed(2)}], b = {b.toFixed(2)}
        </div>
      </div>
      <p className="block-hint">{lastMsg}</p>
    </div>
  );
}

/* ============ BackpropBlock: error flowing backwards with real numbers ============ */

const NET = {
  w1: [[0.9, -0.4], [0.3, 0.8], [-0.7, 0.5]],
  b1: [0.1, -0.2, 0.3],
  w2: [[0.8, -0.5, 0.6]],
  b2: [0.2],
};
const sig = (x) => 1 / (1 + Math.exp(-x));
const POS = { in: [{ x: 80, y: 90 }, { x: 80, y: 210 }], hid: [{ x: 300, y: 60 }, { x: 300, y: 150 }, { x: 300, y: 240 }], out: [{ x: 520, y: 150 }] };

export function BackpropBlock() {
  const [target, setTarget] = useState(1);
  const [phase, setPhase] = useState(0); // 0 forward · 1 loss · 2 δ output · 3 δ hidden · 4 update

  const calc = useMemo(() => {
    const x = [0.6, -0.4];
    const hz = NET.w1.map((w, j) => w[0] * x[0] + w[1] * x[1] + NET.b1[j]);
    const ha = hz.map(Math.tanh);
    const oz = NET.w2[0].reduce((s, w, j) => s + w * ha[j], NET.b2[0]);
    const out = sig(oz);
    const loss = -(target * Math.log(out) + (1 - target) * Math.log(1 - out));
    const dOut = out - target; // δ at output (sigmoid + BCE)
    const dHid = NET.w2[0].map((w, j) => w * dOut * (1 - ha[j] * ha[j]));
    return { x, hz, ha, out, loss, dOut, dHid };
  }, [target]);

  const msgs = [
    <><b>Phase 1 — forward pass.</b> Inputs flow left → right and produce ŷ = {calc.out.toFixed(3)}. (Same math as the forward-pass explorer.)</>,
    <><b>Phase 2 — measure the error.</b> Target y = {target}, prediction ŷ = {calc.out.toFixed(3)} → cross-entropy loss = <b>{calc.loss.toFixed(3)}</b>. Now the network must find out <i>who is to blame</i>.</>,
    <><b>Phase 3 — output delta.</b> For sigmoid + cross-entropy the error signal is beautifully simple: δ = ŷ − y = {calc.out.toFixed(3)} − {target} = <b>{calc.dOut.toFixed(3)}</b>. It starts flowing backwards (coral arrows).</>,
    <><b>Phase 4 — hidden deltas.</b> Each hidden neuron receives blame proportional to its outgoing weight, times its own tanh slope: δⱼ = w₂ⱼ·δ·(1−a²). Here: [{calc.dHid.map((d) => d.toFixed(3)).join(', ')}].</>,
    <><b>Phase 5 — update.</b> Every weight moves against its gradient: w ← w − η·δ·input. That single loop — forward, loss, backward, update — repeated thousands of times, IS training.</>,
  ];

  const backActive = phase >= 2;

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 640 300" role="img" aria-label="Backpropagation, step by step">
        {POS.in.map((a, i) => POS.hid.map((bp, j) => (
          <line key={`ih${i}${j}`} x1={a.x + 24} y1={a.y} x2={bp.x - 24} y2={bp.y}
            stroke={phase >= 4 ? '#ffce6b' : phase === 0 ? '#2ee6ff' : 'rgba(127,216,232,0.3)'}
            strokeWidth={0.6 + Math.abs(NET.w1[j][i]) * 2}
            className={phase === 0 || phase === 4 ? 'flow-anim' : ''} opacity="0.75" />
        )))}
        {POS.hid.map((a, j) => (
          <line key={`ho${j}`} x1={a.x + 24} y1={a.y} x2={POS.out[0].x - 24} y2={POS.out[0].y}
            stroke={backActive && phase < 4 ? '#ff8a6b' : phase === 0 ? '#2ee6ff' : phase >= 4 ? '#ffce6b' : 'rgba(127,216,232,0.3)'}
            strokeWidth={0.6 + Math.abs(NET.w2[0][j]) * 2}
            className={phase === 0 || phase === 3 || phase === 4 ? 'flow-anim' : ''} opacity="0.8"
            style={backActive && phase < 4 ? { markerStart: 'none' } : {}} />
        ))}
        {POS.in.map((p, i) => (
          <g key={`i${i}`}>
            <circle cx={p.x} cy={p.y} r="24" fill="rgba(127,216,232,0.08)" stroke="#7fd8e8" strokeWidth="1.3" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="12">{calc.x[i]}</text>
          </g>
        ))}
        {POS.hid.map((p, j) => (
          <g key={`h${j}`}>
            <circle cx={p.x} cy={p.y} r="24" fill={phase === 3 ? 'rgba(255,138,107,0.2)' : 'rgba(22,184,216,0.12)'}
              stroke={phase === 3 ? '#ff8a6b' : '#16b8d8'} strokeWidth="1.4" className={phase === 3 ? 'glow' : ''} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="10.5">
              {phase < 3 ? calc.ha[j].toFixed(2) : `δ ${calc.dHid[j].toFixed(2)}`}
            </text>
          </g>
        ))}
        <g>
          <circle cx={POS.out[0].x} cy={POS.out[0].y} r="26"
            fill={phase >= 1 && phase < 4 ? 'rgba(255,138,107,0.2)' : 'rgba(53,208,165,0.12)'}
            stroke={phase >= 1 && phase < 4 ? '#ff8a6b' : '#35d0a5'} strokeWidth="1.6"
            className={phase === 1 || phase === 2 ? 'glow' : ''} />
          <text x={POS.out[0].x} y={POS.out[0].y + 4} textAnchor="middle" fill="#fff" fontSize="11">
            {phase < 2 ? calc.out.toFixed(2) : `δ ${calc.dOut.toFixed(2)}`}
          </text>
          <text x={POS.out[0].x + 52} y={POS.out[0].y - 30} fill="#9db8c6" fontSize="11">y = {target}</text>
          {phase >= 1 && <text x={POS.out[0].x + 52} y={POS.out[0].y - 12} fill="#ff8a6b" fontSize="11">loss {calc.loss.toFixed(2)}</text>}
        </g>
      </svg>
      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => setPhase(Math.max(0, phase - 1))} disabled={phase === 0}>← Back</button>
        <button className="btn btn--primary" onClick={() => setPhase(Math.min(4, phase + 1))} disabled={phase === 4}>Step →</button>
        <div className="seg" role="group" aria-label="Target">
          <button className={target === 1 ? 'on' : ''} onClick={() => { setTarget(1); setPhase(0); }}>target 1</button>
          <button className={target === 0 ? 'on' : ''} onClick={() => { setTarget(0); setPhase(0); }}>target 0</button>
        </div>
      </div>
      <div className="stepper-msg" role="status">{msgs[phase]}</div>
    </div>
  );
}

/* ============ OptimizerRaceBlock: SGD vs Momentum on a bumpy loss ============ */

const loss = (x) => 0.28 * x * x + 0.35 * Math.sin(2.2 * x + 1) + 0.45;
const dLoss = (x) => 0.56 * x + 0.77 * Math.cos(2.2 * x + 1);
const OW = 620, OH = 280, OPAD = 40;
const oxMin = -2.6, oxMax = 2.6, oyMin = 0, oyMax = 2.4;
const opx = (x) => OPAD + ((x - oxMin) / (oxMax - oxMin)) * (OW - 2 * OPAD);
const opy = (y) => OH - OPAD - ((y - oyMin) / (oyMax - oyMin)) * (OH - 2 * OPAD);

export function OptimizerRaceBlock() {
  const [lr, setLr] = useState(0.05);
  const [mom, setMom] = useState(0.85);
  const [running, setRunning] = useState(false);
  const [sgd, setSgd] = useState({ x: -2.2, steps: 0 });
  const [momB, setMomB] = useState({ x: -2.2, v: 0, steps: 0 });
  const timer = useRef(null);
  const ref = useRef({ sgd, momB, lr, mom });
  ref.current = { sgd, momB, lr, mom };

  useEffect(() => () => clearInterval(timer.current), []);

  const reset = () => {
    clearInterval(timer.current);
    setRunning(false);
    setSgd({ x: -2.2, steps: 0 });
    setMomB({ x: -2.2, v: 0, steps: 0 });
  };

  const race = () => {
    if (running) { clearInterval(timer.current); setRunning(false); return; }
    setRunning(true);
    timer.current = setInterval(() => {
      const { sgd: s, momB: m, lr: L, mom: M } = ref.current;
      const sNext = Math.max(oxMin, Math.min(oxMax, s.x - L * dLoss(s.x)));
      const v = M * m.v - L * dLoss(m.x);
      const mNext = Math.max(oxMin, Math.min(oxMax, m.x + v));
      setSgd({ x: sNext, steps: s.steps + 1 });
      setMomB({ x: mNext, v, steps: m.steps + 1 });
      if (s.steps > 220) { clearInterval(timer.current); setRunning(false); }
    }, 90);
  };

  let curveD = '';
  for (let i = 0; i <= 140; i++) {
    const cx = oxMin + (i / 140) * (oxMax - oxMin);
    curveD += `${i === 0 ? 'M' : 'L'}${opx(cx).toFixed(1)} ${opy(loss(cx)).toFixed(1)} `;
  }

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${OW} ${OH}`} role="img" aria-label="SGD vs momentum race">
        <path d={curveD} fill="none" stroke="#7fd8e8" strokeWidth="2.2" />
        <circle cx={opx(sgd.x)} cy={opy(loss(sgd.x)) - 8} r="9" fill="#2ee6ff" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
        <text x={opx(sgd.x)} y={opy(loss(sgd.x)) - 24} textAnchor="middle" fill="#2ee6ff" fontSize="10">SGD</text>
        <circle cx={opx(momB.x)} cy={opy(loss(momB.x)) - 8} r="9" fill="#ffce6b" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
        <text x={opx(momB.x)} y={opy(loss(momB.x)) - 24} textAnchor="middle" fill="#ffce6b" fontSize="10">Momentum</text>
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={race}>{running ? '❚❚ Pause' : '🏁 Race'}</button>
        <button className="btn btn--ghost" onClick={reset}>Reset</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.3" step="0.01" value={lr} onChange={(e) => setLr(+e.target.value)} /></label>
        <label className="dial">momentum β <b>{mom.toFixed(2)}</b>
          <input type="range" min="0" max="0.98" step="0.02" value={mom} onChange={(e) => setMom(+e.target.value)} /></label>
      </div>
      <p className="block-hint">
        Both start in the shallow left valley (a <b>local minimum</b>). Plain SGD often gets stuck there;
        momentum accumulates velocity — v ← βv − η∇L — and can roll straight through the bump into the deeper
        valley. loss(SGD) = <b style={{ color: '#2ee6ff' }}>{loss(sgd.x).toFixed(3)}</b> ·
        loss(Momentum) = <b style={{ color: '#ffce6b' }}>{loss(momB.x).toFixed(3)}</b>
      </p>
    </div>
  );
}
