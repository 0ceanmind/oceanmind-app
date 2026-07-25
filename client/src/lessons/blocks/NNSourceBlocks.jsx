import { useEffect, useMemo, useRef, useState } from 'react';

/* ============ BioNeuronBlock: biological neuron → artificial neuron ============ */

const PARTS = {
  dendrite: { label: 'Dendrites', bio: 'Receive incoming signals from thousands of other neurons.', ai: 'The inputs x₁…xₙ of an artificial neuron.' },
  soma: { label: 'Soma (cell body)', bio: 'Sums the incoming activations and decides whether to fire.', ai: 'The weighted sum Σwᵢxᵢ + b.' },
  axon: { label: 'Axon', bio: 'Carries the output spike away from the cell body.', ai: 'The neuron’s output value.' },
  synapse: { label: 'Synapse', bio: 'The junction whose strength decides how much signal passes through.', ai: 'The weight wᵢ — exactly what training adjusts.' },
};

export function BioNeuronBlock() {
  const [sel, setSel] = useState('dendrite');
  const [firing, setFiring] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setFiring((f) => !f), 1600);
    return () => clearInterval(t);
  }, []);
  const hot = (k) => (sel === k ? '#2acbe9' : 'rgba(127,216,232,0.5)');

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 640 260" role="img" aria-label="Biological neuron">
        {/* dendrites */}
        <g onClick={() => setSel('dendrite')} className="dg-node">
          {[-55, -20, 15, 50].map((dy, i) => (
            <path key={i} d={`M40 ${130 + dy} C 90 ${130 + dy * 0.6}, 120 ${130 + dy * 0.3}, 160 130`}
              fill="none" stroke={hot('dendrite')} strokeWidth={sel === 'dendrite' ? 3 : 2}
              className={firing ? 'flow-anim' : ''} strokeLinecap="round" />
          ))}
          <text x="52" y="60" fill={hot('dendrite')} fontSize="12">dendrites</text>
        </g>
        {/* soma */}
        <g onClick={() => setSel('soma')} className="dg-node">
          <circle cx="200" cy="130" r="42" fill={sel === 'soma' ? 'rgba(22,184,216,0.3)' : 'rgba(22,184,216,0.12)'}
            stroke={hot('soma')} strokeWidth={sel === 'soma' ? 2.8 : 1.6} className={firing ? 'glow' : ''} />
          <circle cx="200" cy="130" r="15" fill="rgba(127,216,232,0.28)" />
          <text x="200" y="196" textAnchor="middle" fill={hot('soma')} fontSize="12">soma</text>
        </g>
        {/* axon */}
        <g onClick={() => setSel('axon')} className="dg-node">
          <path d="M242 130 L 470 130" stroke={hot('axon')} strokeWidth={sel === 'axon' ? 6 : 4}
            className={firing ? 'flow-anim' : ''} strokeLinecap="round" />
          <text x="350" y="112" textAnchor="middle" fill={hot('axon')} fontSize="12">axon</text>
        </g>
        {/* synapse */}
        <g onClick={() => setSel('synapse')} className="dg-node">
          <path d="M470 130 q 26 -22 46 -8 q -16 24 -46 8" fill={sel === 'synapse' ? 'rgba(53,208,165,0.35)' : 'rgba(53,208,165,0.16)'}
            stroke={sel === 'synapse' ? '#35d0a5' : 'rgba(53,208,165,0.6)'} strokeWidth={sel === 'synapse' ? 2.6 : 1.6} />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={532 + i * 16} cy={122 + i * 6} r="3.5" fill="#35d0a5" opacity={firing ? 0.9 : 0.25} />
          ))}
          <text x="530" y="182" textAnchor="middle" fill={sel === 'synapse' ? '#35d0a5' : 'rgba(53,208,165,0.7)'} fontSize="12">synapse</text>
        </g>
      </svg>
      <div className="dg-detail">
        <b>{PARTS[sel].label}</b> — <b style={{ color: 'var(--accent-soft)' }}>In biology:</b> {PARTS[sel].bio}{' '}
        <b style={{ color: 'var(--kelp)' }}>In the artificial neuron:</b> {PARTS[sel].ai}
      </div>
      <p className="block-hint">Click any part of the cell to see what it maps to in the maths. Every artificial neuron is a stripped-down cartoon of this.</p>
    </div>
  );
}

/* ============ LossExplorerBlock: types of objective functions ============ */

const LOSSES = {
  mse: { label: 'MSE (L2)', color: '#2ee6ff', f: (p, y) => (p - y) ** 2, note: 'Squares the error — punishes big mistakes hard, but is sensitive to outliers.' },
  mae: { label: 'MAE (L1)', color: '#35d0a5', f: (p, y) => Math.abs(p - y), note: 'Absolute error — treats all mistakes proportionally, robust to outliers.' },
  bce: { label: 'Cross-entropy', color: '#ff8a6b', f: (p, y) => { const q = Math.min(0.999, Math.max(0.001, p)); return -(y * Math.log(q) + (1 - y) * Math.log(1 - q)); }, note: 'For probabilities: confidently wrong answers are punished almost infinitely.' },
};
const LW = 620, LH = 260, LPAD = 46;

export function LossExplorerBlock() {
  const [active, setActive] = useState(['mse', 'bce']);
  const [target, setTarget] = useState(1);
  const [pred, setPred] = useState(0.35);
  const toggle = (k) => setActive((a) => (a.includes(k) ? (a.length > 1 ? a.filter((v) => v !== k) : a) : [...a, k]));

  const yMax = 4;
  const px = (p) => LPAD + p * (LW - 2 * LPAD);
  const py = (v) => LH - LPAD - (Math.min(v, yMax) / yMax) * (LH - 2 * LPAD);
  const curve = (f) => {
    let d = '';
    for (let i = 0; i <= 120; i++) {
      const p = i / 120;
      d += `${i === 0 ? 'M' : 'L'}${px(p).toFixed(1)} ${py(f(p, target)).toFixed(1)} `;
    }
    return d;
  };

  return (
    <div className="block-frame">
      <div className="seg" role="group" aria-label="Loss functions">
        {Object.entries(LOSSES).map(([k, v]) => (
          <button key={k} className={active.includes(k) ? 'on' : ''} onClick={() => toggle(k)}
            style={active.includes(k) ? { color: v.color } : {}}>{v.label}</button>
        ))}
      </div>
      <svg className="viz-svg" viewBox={`0 0 ${LW} ${LH}`} style={{ marginTop: '0.7rem' }} role="img" aria-label="Loss curves">
        <line x1={LPAD} y1={py(0)} x2={LW - LPAD} y2={py(0)} stroke="rgba(127,216,232,0.28)" />
        <line x1={LPAD} y1={LPAD - 10} x2={LPAD} y2={py(0)} stroke="rgba(127,216,232,0.28)" />
        <text x={LW - LPAD} y={LH - 12} textAnchor="end" fill="#5d7a8c" fontSize="11">prediction →</text>
        <text x={12} y={LPAD - 16} fill="#5d7a8c" fontSize="11">loss ↑</text>
        {active.map((k) => <path key={k} d={curve(LOSSES[k].f)} fill="none" stroke={LOSSES[k].color} strokeWidth="2.4" />)}
        {/* target marker */}
        <line x1={px(target)} y1={LPAD - 10} x2={px(target)} y2={py(0)} stroke="rgba(53,208,165,0.5)" strokeDasharray="4 4" />
        <text x={px(target)} y={LPAD - 16} textAnchor="middle" fill="#35d0a5" fontSize="11">target {target}</text>
        {/* live prediction */}
        <line x1={px(pred)} y1={LPAD - 10} x2={px(pred)} y2={py(0)} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 5" />
        {active.map((k) => (
          <circle key={k} cx={px(pred)} cy={py(LOSSES[k].f(pred, target))} r="6" fill={LOSSES[k].color} className="glow" />
        ))}
      </svg>
      <div className="stepper-row">
        <label className="dial" style={{ minWidth: 220 }}>your prediction <b>{pred.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.99" step="0.01" value={pred} onChange={(e) => setPred(+e.target.value)} /></label>
        <div className="seg" role="group" aria-label="Target">
          <button className={target === 1 ? 'on' : ''} onClick={() => setTarget(1)}>target 1</button>
          <button className={target === 0 ? 'on' : ''} onClick={() => setTarget(0)}>target 0</button>
        </div>
        <div className="stepper-msg">
          {active.map((k) => <span key={k}><b style={{ color: LOSSES[k].color }}>{LOSSES[k].label}</b>: {LOSSES[k].f(pred, target).toFixed(3)} · </span>)}
        </div>
      </div>
      <p className="block-hint">{active.map((k) => <span key={k}><b style={{ color: LOSSES[k].color }}>{LOSSES[k].label}</b> — {LOSSES[k].note} </span>)}</p>
    </div>
  );
}

/* ============ VanishingGradientBlock: why deep sigmoid stacks stop learning ============ */

const ACTS = {
  sigmoid: { label: 'Sigmoid', color: '#2ee6ff', maxSlope: 0.25 },
  tanh: { label: 'Tanh', color: '#35d0a5', maxSlope: 1.0 },
  relu: { label: 'ReLU', color: '#ffce6b', maxSlope: 1.0 },
};

export function VanishingGradientBlock() {
  const [act, setAct] = useState('sigmoid');
  const [layers, setLayers] = useState(8);
  const slope = ACTS[act].maxSlope;
  // gradient magnitude reaching layer i counting back from the output
  const mags = useMemo(
    () => Array.from({ length: layers }, (_, i) => Math.pow(slope * (act === 'relu' ? 1 : 0.92), i)),
    [layers, slope, act]
  );
  const barW = 620 / layers;

  return (
    <div className="block-frame">
      <div className="seg" role="group" aria-label="Activation">
        {Object.entries(ACTS).map(([k, v]) => (
          <button key={k} className={act === k ? 'on' : ''} onClick={() => setAct(k)} style={act === k ? { color: v.color } : {}}>{v.label}</button>
        ))}
      </div>
      <svg className="viz-svg" viewBox="0 0 620 220" style={{ marginTop: '0.7rem' }} role="img" aria-label="Gradient magnitude per layer">
        {mags.map((m, i) => {
          const h = Math.max(1.5, m * 150);
          return (
            <g key={i}>
              <rect x={i * barW + 6} y={185 - h} width={barW - 12} height={h} rx="3" fill={ACTS[act].color}
                opacity={0.35 + m * 0.65} style={{ transition: 'all 0.5s cubic-bezier(0.32,0.72,0,1)' }} />
              <text x={i * barW + barW / 2} y={202} textAnchor="middle" fill="#5d7a8c" fontSize="9">L{layers - i}</text>
              {m < 0.01 && <text x={i * barW + barW / 2} y={176} textAnchor="middle" fill="#ff6b81" fontSize="11">💀</text>}
            </g>
          );
        })}
        <text x={8} y={16} fill="#9db8c6" fontSize="11">gradient reaching each layer (output → input, right to left)</text>
      </svg>
      <div className="stepper-row">
        <label className="dial">depth <b>{layers} layers</b>
          <input type="range" min="3" max="14" step="1" value={layers} onChange={(e) => setLayers(+e.target.value)} /></label>
        <div className="stepper-msg">
          Gradient at the <b>first</b> layer: <b style={{ color: mags.at(-1) < 0.01 ? 'var(--danger)' : 'var(--kelp)' }}>{mags.at(-1).toExponential(2)}</b>{' '}
          {act === 'sigmoid'
            ? '— sigmoid’s slope maxes out at 0.25, so each layer multiplies the signal by ≤¼. Stack a few and it vanishes: early layers stop learning.'
            : act === 'tanh'
              ? '— tanh peaks at slope 1, so it decays far slower than sigmoid, but still shrinks in saturation.'
              : '— ReLU passes gradient through unchanged (slope 1) for positive inputs, which is exactly why deep nets use it.'}
        </div>
      </div>
      <p className="block-hint">Switch to <b>ReLU</b> and drag the depth to 14 — the bars stay tall. That single change is what made deep networks trainable.</p>
    </div>
  );
}

/* ============ GDVariantsBlock: batch vs mini-batch vs stochastic ============ */

const GW = 620, GH = 300;
const bowl = (x, y) => 0.5 * x * x + 1.4 * y * y;
const bgrad = (x, y) => [x, 2.8 * y];
const gpx = (x) => GW / 2 + x * 92;
const gpy = (y) => GH / 2 + y * 92;

export function GDVariantsBlock() {
  const [runs, setRuns] = useState({});
  const [running, setRunning] = useState(false);
  const timer = useRef(null);
  const VARIANTS = {
    batch: { label: 'Batch GD', color: '#2ee6ff', noise: 0, lr: 0.12, note: 'Uses the whole dataset per step: smooth, accurate, but slow and memory-hungry.' },
    mini: { label: 'Mini-batch', color: '#35d0a5', noise: 0.10, lr: 0.16, note: 'A compromise — small batches give a mostly-smooth path with far less compute. The default in practice.' },
    sgd: { label: 'Stochastic', color: '#ffce6b', noise: 0.30, lr: 0.20, note: 'One sample per step: very noisy and jittery, but fast and the noise can escape shallow traps.' },
  };

  useEffect(() => () => clearInterval(timer.current), []);

  const race = () => {
    if (running) { clearInterval(timer.current); setRunning(false); return; }
    setRunning(true);
    const state = Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, { x: -2.1, y: 1.05, path: [] }]));
    setRuns({});
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      for (const [k, v] of Object.entries(VARIANTS)) {
        const s = state[k];
        const [gx, gy] = bgrad(s.x, s.y);
        s.path.push([s.x, s.y]);
        s.x -= v.lr * (gx + (Math.random() - 0.5) * v.noise * 6);
        s.y -= v.lr * (gy + (Math.random() - 0.5) * v.noise * 6);
      }
      setRuns(Object.fromEntries(Object.entries(state).map(([k, s]) => [k, [...s.path]])));
      if (n > 60) { clearInterval(timer.current); setRunning(false); }
    }, 90);
  };

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${GW} ${GH}`} role="img" aria-label="Gradient descent variants">
        {/* contour rings of the bowl */}
        {[0.35, 0.8, 1.4, 2.2, 3.2].map((lv, i) => (
          <ellipse key={i} cx={gpx(0)} cy={gpy(0)} rx={Math.sqrt(lv / 0.5) * 92} ry={Math.sqrt(lv / 1.4) * 92}
            fill="none" stroke="rgba(127,216,232,0.18)" strokeWidth="1.2" />
        ))}
        <circle cx={gpx(0)} cy={gpy(0)} r="5" fill="#35d0a5" className="glow" />
        <text x={gpx(0) + 10} y={gpy(0) - 8} fill="#35d0a5" fontSize="11">minimum</text>
        {Object.entries(VARIANTS).map(([k, v]) => {
          const path = runs[k] ?? [];
          if (path.length < 2) return null;
          const d = path.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${gpx(x).toFixed(1)} ${gpy(y).toFixed(1)}`).join(' ');
          const last = path.at(-1);
          return (
            <g key={k}>
              <path d={d} fill="none" stroke={v.color} strokeWidth="2" opacity="0.85" />
              <circle cx={gpx(last[0])} cy={gpy(last[1])} r="6" fill={v.color} className={running ? 'glow' : ''} />
            </g>
          );
        })}
        {Object.entries(VARIANTS).map(([k, v], i) => (
          <g key={`l${k}`}>
            <rect x={16} y={16 + i * 18} width="10" height="10" rx="2" fill={v.color} />
            <text x={32} y={25 + i * 18} fill="#9db8c6" fontSize="11">{v.label}</text>
          </g>
        ))}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={race}>{running ? '❚❚ Pause' : '🏁 Race all three'}</button>
        <button className="btn btn--ghost" onClick={() => { clearInterval(timer.current); setRunning(false); setRuns({}); }}>Reset</button>
      </div>
      <p className="block-hint">
        {Object.values(VARIANTS).map((v) => <span key={v.label}><b style={{ color: v.color }}>{v.label}</b> — {v.note} </span>)}
      </p>
    </div>
  );
}

/* ============ ChainRuleBlock: the computational graph behind backprop ============ */

export function ChainRuleBlock() {
  const [x, setX] = useState(1.4);
  const [w, setW] = useState(0.8);
  const [b, setB] = useState(-0.3);
  const [stage, setStage] = useState(0); // 0 forward · 1..3 backward hops

  const u = w * x;          // multiply
  const v = u + b;          // add
  const s = 1 / (1 + Math.exp(-v)); // sigmoid
  const dS_dv = s * (1 - s);
  const dv_du = 1;
  const du_dw = x;
  const dS_dw = dS_dv * dv_du * du_dw;

  const nodes = [
    { id: 'x', label: `x = ${x.toFixed(2)}`, cx: 70, cy: 60 },
    { id: 'w', label: `w = ${w.toFixed(2)}`, cx: 70, cy: 170 },
    { id: 'u', label: `u = w·x = ${u.toFixed(2)}`, cx: 240, cy: 115 },
    { id: 'b', label: `b = ${b.toFixed(2)}`, cx: 240, cy: 220 },
    { id: 'v', label: `v = u+b = ${v.toFixed(2)}`, cx: 410, cy: 160 },
    { id: 's', label: `σ(v) = ${s.toFixed(3)}`, cx: 560, cy: 100 },
  ];
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [['x', 'u'], ['w', 'u'], ['u', 'v'], ['b', 'v'], ['v', 's']];
  const backLit = { 1: ['v', 's'], 2: ['u', 'v'], 3: ['w', 'u'] };

  const msgs = [
    <>Forward: each node computes its value from its inputs. Drag the sliders — everything downstream updates instantly.</>,
    <><b>Hop 1:</b> ∂σ/∂v = σ(v)·(1−σ(v)) = <b>{dS_dv.toFixed(4)}</b> — the sigmoid’s local slope.</>,
    <><b>Hop 2:</b> ∂v/∂u = <b>1</b> (addition just passes gradient straight through, unchanged).</>,
    <><b>Hop 3:</b> ∂u/∂w = x = <b>{x.toFixed(2)}</b>. Multiply the whole chain: ∂σ/∂w = {dS_dv.toFixed(4)} × 1 × {x.toFixed(2)} = <b style={{ color: 'var(--kelp)' }}>{dS_dw.toFixed(4)}</b>. That is backpropagation — the chain rule, applied edge by edge.</>,
  ];

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox="0 0 640 270" role="img" aria-label="Computational graph and chain rule">
        {edges.map(([a, bb], i) => {
          const lit = stage > 0 && backLit[stage]?.includes(a) && backLit[stage]?.includes(bb);
          return (
            <line key={i} x1={pos[a].cx + 52} y1={pos[a].cy} x2={pos[bb].cx - 52} y2={pos[bb].cy}
              stroke={lit ? '#ff8a6b' : stage === 0 ? '#2ee6ff' : 'rgba(127,216,232,0.28)'}
              strokeWidth={lit ? 3.4 : 2} className={lit || stage === 0 ? 'flow-anim' : ''} />
          );
        })}
        {nodes.map((n) => {
          const lit = stage > 0 && backLit[stage]?.includes(n.id);
          return (
            <g key={n.id}>
              <rect x={n.cx - 52} y={n.cy - 20} width="104" height="40" rx="12"
                fill={lit ? 'rgba(255,138,107,0.2)' : 'rgba(8,26,42,0.92)'}
                stroke={lit ? '#ff8a6b' : 'rgba(127,216,232,0.45)'} strokeWidth={lit ? 2.4 : 1.3}
                className={lit ? 'glow' : ''} />
              <text x={n.cx} y={n.cy + 4} textAnchor="middle" fill="#fff" fontSize="11">{n.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => setStage(Math.max(0, stage - 1))} disabled={stage === 0}>← Back</button>
        <button className="btn btn--primary" onClick={() => setStage(Math.min(3, stage + 1))} disabled={stage === 3}>
          {stage === 0 ? 'Start backward pass →' : 'Next hop →'}
        </button>
        <label className="dial">x <b>{x.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={x} onChange={(e) => setX(+e.target.value)} /></label>
        <label className="dial">w <b>{w.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={w} onChange={(e) => setW(+e.target.value)} /></label>
        <label className="dial">b <b>{b.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={b} onChange={(e) => setB(+e.target.value)} /></label>
      </div>
      <div className="stepper-msg" role="status">{msgs[stage]}</div>
    </div>
  );
}
