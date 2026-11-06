import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { demoRandom, useTweenedNumber } from '../../lib/motion.js';
import './nn-b.css';

/* ============ PerceptronBlock: the perceptron learning rule, live ============ */

const PW = 620, PH = 300;
const pToCanvas = ([x, y]) => [((x + 1) / 2) * PW, (1 - (y + 1) / 2) * PH];
const P_LR = 0.4;
const W0 = [0.3, -0.5], B0 = 0.1;
// Demo seed, chosen by simulating this exact update rule: the first dataset
// starts with 17 misclassified and converges in 6 visible updates
// (17 → 13 → 5 → 5 → 2 → 1 → 0). Outside the demo the data is truly random.
const P_SEED = 1645;
const P_INTRO = 'The line is the perceptron’s current decision boundary. Train it to separate teal from coral.';

function makePoints(rand) {
  const pts = [];
  for (let i = 0; i < 26; i++) {
    const label = i % 2 === 0 ? 1 : -1;
    const cx = label === 1 ? 0.4 : -0.4;
    const cy = label === 1 ? 0.3 : -0.3;
    pts.push({ x: [cx + (rand() - 0.5) * 0.7, cy + (rand() - 0.5) * 0.7], label });
  }
  return pts;
}

// The part of the line a·x + c·y + b = 0 inside the square [-L, L]², in canvas
// coordinates (null if it misses). Works for vertical lines too, so the
// boundary never blinks out when a weight passes through zero.
function clipLine(a, c, b, L = 1.1) {
  const hits = [];
  if (Math.abs(c) > 1e-9) {
    for (const x of [-L, L]) {
      const y = (-b - a * x) / c;
      if (Math.abs(y) <= L) hits.push([x, y]);
    }
  }
  if (Math.abs(a) > 1e-9) {
    for (const y of [-L, L]) {
      const x = (-b - c * y) / a;
      if (Math.abs(x) <= L && !hits.some((h) => Math.abs(h[0] - x) < 1e-6 && Math.abs(h[1] - y) < 1e-6)) hits.push([x, y]);
    }
  }
  if (hits.length < 2) return null;
  const [x1, y1] = pToCanvas(hits[0]);
  const [x2, y2] = pToCanvas(hits[1]);
  return { x1, y1, x2, y2 };
}

export function PerceptronBlock() {
  const [gen, setGen] = useState(0); // which dataset (New data bumps it)
  const [pts, setPts] = useState(() => makePoints(demoRandom(`perceptron:${P_SEED}:0`)));
  const [w, setW] = useState(W0);
  const [b, setB] = useState(B0);
  const [updates, setUpdates] = useState(0);
  const [lastMsg, setLastMsg] = useState(P_INTRO);
  const [flash, setFlash] = useState(null); // index of the point just used
  const [cheer, setCheer] = useState(0);    // bumps to replay the "converged" badge
  const pick = useRef(null);
  if (!pick.current) pick.current = demoRandom(`perceptron-pick:${P_SEED}:0`);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const misclassified = useMemo(
    () => pts.filter((p) => Math.sign(w[0] * p.x[0] + w[1] * p.x[1] + b) !== p.label),
    [pts, w, b]
  );
  // Convergence is announced the moment the last point is fixed, no extra click.
  const converged = misclassified.length === 0;
  const announced = converged && updates > 0;

  const trainStep = () => {
    if (converged) { setCheer((c) => c + 1); return; }
    const p = misclassified[Math.floor(pick.current() * misclassified.length)];
    setW([w[0] + P_LR * p.label * p.x[0], w[1] + P_LR * p.label * p.x[1]]);
    setB(b + P_LR * p.label);
    setUpdates(updates + 1);
    setFlash(pts.indexOf(p));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 600);
    setLastMsg(`Picked a misclassified ${p.label === 1 ? 'teal' : 'coral'} point and nudged the weights toward it: w ← w + η·y·x. Watch the line move.`);
  };

  const newData = () => {
    const g = gen + 1;
    setGen(g);
    setPts(makePoints(demoRandom(`perceptron:${P_SEED}:${g}`)));
    pick.current = demoRandom(`perceptron-pick:${P_SEED}:${g}`);
    setW(W0);
    setB(B0);
    setUpdates(0);
    setFlash(null);
    setCheer(0);
    setLastMsg(P_INTRO);
  };

  // the decision line (w0·x + w1·y + b = 0) glides between updates: the
  // weights tween, so the line swings about the point the old and new lines share
  const tw0 = useTweenedNumber(w[0], { duration: 420 });
  const tw1 = useTweenedNumber(w[1], { duration: 420 });
  const tb = useTweenedNumber(b, { duration: 420 });
  const line = useMemo(() => clipLine(tw0, tw1, tb), [tw0, tw1, tb]);

  const msg = announced
    ? `Converged! Every point is on the right side after ${updates} updates — the perceptron learning rule always converges on separable data.`
    : converged
      ? 'This draw is already separated by the starting line. Click New data for a fresh set.'
      : lastMsg;

  return (
    <div className="block-frame" data-phase={announced ? 'converged' : updates ? 'training' : 'ready'}
      data-running="false" data-done={announced} data-misclassified={misclassified.length} data-updates={updates}>
      <svg className="viz-svg" viewBox={`0 0 ${PW} ${PH}`} role="img" aria-label="Perceptron learning" data-demo="plot">
        {line && <line {...line} stroke={announced ? '#35d0a5' : '#7fd8e8'} strokeWidth={announced ? 3 : 2.4} className="glow om-nnb-ease" />}
        {pts.map((p, i) => {
          const [cx, cy] = pToCanvas(p.x);
          const wrong = misclassified.includes(p);
          return (
            <circle key={`${gen}-${i}`} cx={cx} cy={cy} r={flash === i ? 9 : 5.5}
              fill={p.label === 1 ? '#2ee6ff' : '#ff8a6b'}
              stroke={wrong ? '#ffce6b' : 'rgba(3,10,18,0.9)'} strokeWidth={wrong ? 2.4 : 1.4}
              className={`om-nnb-pt ${announced ? 'is-cheer' : 'is-in'}`} style={{ '--i': i }} />
          );
        })}
        {announced && (
          <g key={`${gen}-${cheer}`} className="om-nnb-pop" data-demo="badge">
            <rect x={PW - 214} y={10} width={200} height={26} rx={13} fill="rgba(53,208,165,0.16)" stroke="#35d0a5" strokeWidth="1.2" />
            <text x={PW - 114} y={27} textAnchor="middle" fill="#35d0a5" fontSize="12" fontWeight="600">✓ Converged · {updates} updates</text>
          </g>
        )}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={trainStep} data-demo="step">⚡ One learning step</button>
        <button className="btn btn--ghost" onClick={newData} data-demo="new-data">New data</button>
        <div className="stepper-msg">
          <b key={`m${misclassified.length}`} className="om-swap om-nnb-num" data-demo="stat-misclassified">{misclassified.length}</b> misclassified
          (gold rings) · <b key={`u${updates}`} className="om-swap om-nnb-num" data-demo="stat-updates">{updates}</b> updates ·
          w = [{w[0].toFixed(2)}, {w[1].toFixed(2)}], b = {b.toFixed(2)}
        </div>
      </div>
      <p key={announced ? 'done' : `${gen}-${updates}`} className="block-hint om-swap" role="status">{msg}</p>
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
const ETA = 0.5; // learning rate used for the Δw labels in the update phase
const sig = (x) => 1 / (1 + Math.exp(-x));
const POS = { in: [{ x: 80, y: 90 }, { x: 80, y: 210 }], hid: [{ x: 300, y: 60 }, { x: 300, y: 150 }, { x: 300, y: 240 }], out: [{ x: 520, y: 150 }] };

export function BackpropBlock() {
  const [target, setTarget] = useState(1);
  const [phase, setPhase] = useState(0); // 0 forward · 1 loss · 2 δ output · 3 δ hidden · 4 update
  const arrowId = `om-nnb-bp-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const calc = useMemo(() => {
    const x = [0.6, -0.4];
    const hz = NET.w1.map((w, j) => w[0] * x[0] + w[1] * x[1] + NET.b1[j]);
    const ha = hz.map(Math.tanh);
    const oz = NET.w2[0].reduce((s, w, j) => s + w * ha[j], NET.b2[0]);
    const out = sig(oz);
    const loss = -(target * Math.log(out) + (1 - target) * Math.log(1 - out));
    const dOut = out - target; // δ at output (sigmoid + BCE)
    const dHid = NET.w2[0].map((w, j) => w * dOut * (1 - ha[j] * ha[j]));
    const dW2 = ha.map((a) => -ETA * dOut * a); // Δw₂ⱼ = −η·δ·aⱼ
    return { x, hz, ha, out, loss, dOut, dHid, dW2 };
  }, [target]);
  // the loss counts up as the error is measured
  const lossShown = useTweenedNumber(phase >= 1 ? calc.loss : 0, { duration: 700 });

  const msgs = [
    <><b>Phase 1 — forward pass.</b> Inputs flow left → right and produce ŷ = {calc.out.toFixed(3)}. (Same math as the forward-pass explorer.)</>,
    <><b>Phase 2 — measure the error.</b> Target y = {target}, prediction ŷ = {calc.out.toFixed(3)} → cross-entropy loss = <b>{calc.loss.toFixed(3)}</b>. Now the network must find out <i>who is to blame</i>.</>,
    <><b>Phase 3 — output delta.</b> For sigmoid + cross-entropy the error signal is beautifully simple: δ = ŷ − y = {calc.out.toFixed(3)} − {target} = <b>{calc.dOut.toFixed(3)}</b>. It starts flowing backwards (coral arrows).</>,
    <><b>Phase 4 — hidden deltas.</b> Each hidden neuron receives blame proportional to its outgoing weight, times its own tanh slope: δⱼ = w₂ⱼ·δ·(1−a²). Here: [{calc.dHid.map((d) => d.toFixed(3)).join(', ')}].</>,
    <><b>Phase 5 — update.</b> Every weight moves against its gradient: w ← w − η·δ·input (gold labels: how much each output weight moves at η = {ETA}). That single loop — forward, loss, backward, update — repeated thousands of times, IS training.</>,
  ];

  const back = phase === 2 || phase === 3; // the error is travelling right → left

  return (
    <div className="block-frame" data-phase={phase} data-target={target} data-running="false" data-done={phase === 4}>
      <svg className="viz-svg" viewBox="0 0 640 300" role="img" aria-label="Backpropagation, step by step" data-demo="diagram">
        <defs>
          {/* coral arrowhead drawn at the start of a left→right edge, pointing back toward the hidden layer */}
          <marker id={arrowId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="11" markerHeight="11"
            markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#ff8a6b" />
          </marker>
        </defs>
        {POS.in.map((a, i) => POS.hid.map((bp, j) => (
          <line key={`ih${i}${j}`} x1={a.x + 24} y1={a.y} x2={bp.x - 24} y2={bp.y}
            stroke={phase >= 4 ? '#ffce6b' : phase === 0 ? '#2ee6ff' : phase === 3 ? 'rgba(255,138,107,0.45)' : 'rgba(127,216,232,0.3)'}
            strokeWidth={0.6 + Math.abs(NET.w1[j][i]) * 2}
            className={`om-nnb-ease ${phase === 0 || phase === 4 ? 'flow-anim' : phase === 3 ? 'flow-anim om-flow-reverse om-flow-idle' : ''}`}
            opacity="0.75" />
        )))}
        {POS.hid.map((a, j) => (
          <line key={`ho${j}`} x1={a.x + 24} y1={a.y} x2={POS.out[0].x - 24} y2={POS.out[0].y}
            stroke={back ? '#ff8a6b' : phase === 0 ? '#2ee6ff' : phase >= 4 ? '#ffce6b' : 'rgba(127,216,232,0.3)'}
            strokeWidth={0.6 + Math.abs(NET.w2[0][j]) * 2}
            className={`om-nnb-ease ${phase === 0 || phase === 4 ? 'flow-anim' : back ? 'flow-anim om-flow-reverse' : ''}`} opacity="0.8"
            markerStart={back ? `url(#${arrowId})` : undefined} />
        ))}
        {phase === 4 && POS.hid.map((a, j) => (
          <text key={`dw${j}-${target}`} x={430} y={(a.y + POS.out[0].y) / 2 - 7} textAnchor="middle" fill="#ffce6b" fontSize="10"
            className="om-nnb-pop" style={{ animationDelay: `${j * 90}ms` }}>
            Δw {calc.dW2[j] >= 0 ? '+' : '−'}{Math.abs(calc.dW2[j]).toFixed(3)}
          </text>
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
              stroke={phase === 3 ? '#ff8a6b' : '#16b8d8'} strokeWidth="1.4" className={`om-nnb-ease${phase === 3 ? ' glow' : ''}`} />
            <text key={`${phase < 3 ? 'a' : 'd'}-${target}`} x={p.x} y={p.y + 4} textAnchor="middle" fill="#fff" fontSize="10.5" className="om-swap">
              {phase < 3 ? calc.ha[j].toFixed(2) : `δ ${calc.dHid[j].toFixed(2)}`}
            </text>
          </g>
        ))}
        <g>
          <circle cx={POS.out[0].x} cy={POS.out[0].y} r="26"
            fill={phase >= 1 && phase < 4 ? 'rgba(255,138,107,0.2)' : 'rgba(53,208,165,0.12)'}
            stroke={phase >= 1 && phase < 4 ? '#ff8a6b' : '#35d0a5'} strokeWidth="1.6"
            className={`om-nnb-ease${phase === 1 || phase === 2 ? ' glow' : ''}`} />
          <text key={`${phase < 2 ? 'a' : 'd'}-${target}`} x={POS.out[0].x} y={POS.out[0].y + 4} textAnchor="middle" fill="#fff" fontSize="11" className="om-swap">
            {phase < 2 ? calc.out.toFixed(2) : `δ ${calc.dOut.toFixed(2)}`}
          </text>
          <text key={`y${target}`} x={POS.out[0].x + 52} y={POS.out[0].y - 30} fill="#9db8c6" fontSize="11" className="om-swap">y = {target}</text>
          {phase >= 1 && (
            <text x={POS.out[0].x + 52} y={POS.out[0].y - 12} fill="#ff8a6b" fontSize="11" className="om-swap" data-demo="loss">
              loss {lossShown.toFixed(2)}
            </text>
          )}
        </g>
      </svg>
      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => setPhase(Math.max(0, phase - 1))} disabled={phase === 0} data-demo="back">← Back</button>
        <button className="btn btn--primary" onClick={() => setPhase(Math.min(4, phase + 1))} disabled={phase === 4} data-demo="step">Step →</button>
        <div className="seg" role="group" aria-label="Target">
          <button className={target === 1 ? 'on' : ''} onClick={() => { setTarget(1); setPhase(0); }} data-demo="target-1">target 1</button>
          <button className={target === 0 ? 'on' : ''} onClick={() => { setTarget(0); setPhase(0); }} data-demo="target-0">target 0</button>
        </div>
      </div>
      <div key={`${phase}-${target}`} className="stepper-msg om-swap" role="status" data-demo="msg">{msgs[phase]}</div>
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
const oclamp = (x) => Math.max(oxMin, Math.min(oxMax, x));
// The curve's two valleys (found numerically): the deeper, GLOBAL minimum on the
// left (loss 0.385) and a shallower, LOCAL one on the right (loss 0.686),
// separated by a bump at x ≈ 0.39.
const GLOBAL_MIN = -0.8605, LOCAL_MIN = 1.2035, BUMP = 0.3905;
// Both balls start high on the right. Simulated with these exact updates:
// at lr .05, β .90 plain SGD stops in the local valley while momentum rolls
// over the bump at tick 12 (~1 s) and the race is decided at tick 57 (~4.6 s).
// Momentum needs β ≥ 0.86 to clear the bump at lr .05.
const RACE_START = 2.2;
const RACE_TICK = 80;   // ms per optimisation step
const RACE_CAP = 300;   // declare a result even if very high β is still sloshing
const RACE_TRAIL = 36;
const nearMin = (x) => Math.min(Math.abs(x - GLOBAL_MIN), Math.abs(x - LOCAL_MIN));
const freshRace = () => ({ s: RACE_START, m: RACE_START, v: 0, steps: 0, calm: 0, still: 0, coast: false });
const fmtLoss = (x) => loss(x).toFixed(3);
const CURVE_D = (() => {
  let d = '';
  for (let i = 0; i <= 140; i++) {
    const cx = oxMin + (i / 140) * (oxMax - oxMin);
    d += `${i === 0 ? 'M' : 'L'}${opx(cx).toFixed(1)} ${opy(loss(cx)).toFixed(1)} `;
  }
  return d;
})();

export function OptimizerRaceBlock() {
  const [lr, setLr] = useState(0.05);
  const [mom, setMom] = useState(0.9);
  const [phase, setPhase] = useState('ready'); // ready · racing · paused · finished
  const [pos, setPos] = useState({ s: RACE_START, m: RACE_START, steps: 0 });
  const [trails, setTrails] = useState({ s: [], m: [] });
  const [result, setResult] = useState(null);
  const timer = useRef(null);
  const sim = useRef(freshRace());
  const params = useRef({ lr, mom });
  params.current = { lr, mom };

  useEffect(() => () => clearInterval(timer.current), []);

  const stopTimer = () => { clearInterval(timer.current); timer.current = null; };

  const finish = (r) => {
    r.coast = true;
    const valley = (x) => (x < BUMP ? 'global' : 'local');
    const sV = valley(r.s), mV = valley(r.m);
    const winner = sV === mV ? 'tie' : mV === 'global' ? 'momentum' : 'sgd';
    setResult({ id: performance.now(), winner, steps: r.steps, sV, mV });
    setPhase('finished');
  };

  const tick = () => {
    const r = sim.current;
    const { lr: L, mom: M } = params.current;
    const sN = oclamp(r.s - L * dLoss(r.s));
    const v = M * r.v - L * dLoss(r.m);
    const mN = oclamp(r.m + v);
    const ds = Math.abs(sN - r.s), dm = Math.abs(mN - r.m);
    const prev = { s: r.s, m: r.m };
    Object.assign(r, { s: sN, m: mN, v, steps: r.steps + 1 });
    setPos({ s: sN, m: mN, steps: r.steps });
    setTrails((t) => ({ s: [...t.s.slice(1 - RACE_TRAIL), prev.s], m: [...t.m.slice(1 - RACE_TRAIL), prev.m] }));
    if (r.coast) {
      // after the result is in, the balls keep rolling until they are truly still
      r.still = ds < 0.0008 && dm < 0.0008 ? r.still + 1 : 0;
      if (r.still >= 5 || r.steps > RACE_CAP + 200) stopTimer();
      return;
    }
    // decided = both balls sit near a valley floor and have nearly stopped, 3 ticks running
    const calm = nearMin(sN) < 0.08 && nearMin(mN) < 0.08 && ds < 0.015 && dm < 0.015;
    r.calm = calm ? r.calm + 1 : 0;
    if (r.calm >= 3 || r.steps >= RACE_CAP) finish(r);
  };

  const clearRace = () => {
    stopTimer();
    sim.current = freshRace();
    setPos({ s: RACE_START, m: RACE_START, steps: 0 });
    setTrails({ s: [], m: [] });
    setResult(null);
  };

  const race = () => {
    if (phase === 'racing') { stopTimer(); setPhase('paused'); return; }
    if (phase === 'finished') clearRace();
    stopTimer();
    setPhase('racing');
    timer.current = setInterval(tick, RACE_TICK);
  };

  const reset = () => { clearRace(); setPhase('ready'); };

  const moving = phase === 'racing' || phase === 'finished';
  const rider = (x, color, label, key, won) => (
    <g key={key} className={`om-nnb-rider${moving ? ' is-running' : ''}`}
      style={{ transform: `translate(${opx(x).toFixed(1)}px, ${opy(loss(x)).toFixed(1)}px)` }}>
      <circle cx="0" cy="-8" r="9" fill={color} stroke="#0a2237" strokeWidth="2" className={phase === 'racing' ? 'glow' : ''} />
      {won && <circle key={result.id} cx="0" cy="-8" r="11" stroke={color} strokeWidth="2" className="om-nnb-ring" />}
      <text x="0" y="-24" textAnchor="middle" fill={color} fontSize="10">{label}{won ? ' 🏁' : ''}</text>
    </g>
  );

  return (
    <div className="block-frame" data-phase={phase} data-running={phase === 'racing'} data-done={phase === 'finished'}
      data-winner={result?.winner ?? ''} data-steps={pos.steps}>
      <svg className="viz-svg" viewBox={`0 0 ${OW} ${OH}`} role="img" aria-label="SGD vs momentum race" data-demo="plot">
        <path d={CURVE_D} fill="none" stroke="#7fd8e8" strokeWidth="2.2" />
        {/* the two valleys and the start */}
        {[[GLOBAL_MIN, 'global min', '#35d0a5'], [LOCAL_MIN, 'local min', '#5d7a8c']].map(([x, label, color]) => (
          <g key={label}>
            <line x1={opx(x)} y1={opy(loss(x)) + 5} x2={opx(x)} y2={opy(loss(x)) + 13} stroke={color} strokeWidth="1.5" />
            <text x={opx(x)} y={opy(loss(x)) + 26} textAnchor="middle" fill={color} fontSize="10.5">{label}</text>
          </g>
        ))}
        <circle cx={opx(RACE_START)} cy={opy(loss(RACE_START)) - 8} r="12" fill="none" stroke="rgba(157,184,198,0.45)"
          strokeDasharray="3 4" strokeWidth="1.2" />
        <text x={opx(RACE_START)} y={opy(loss(RACE_START)) + 16} textAnchor="middle" fill="#5d7a8c" fontSize="10">start</text>
        {/* trails: where each ball has been, older = fainter */}
        {trails.s.map((x, i) => (
          <circle key={`ts${i}`} cx={opx(x)} cy={opy(loss(x)) - 3} r="2.2" fill="#2ee6ff" opacity={((i + 1) / trails.s.length) * 0.6} />
        ))}
        {trails.m.map((x, i) => (
          <circle key={`tm${i}`} cx={opx(x)} cy={opy(loss(x)) - 3} r="2.2" fill="#ffce6b" opacity={((i + 1) / trails.m.length) * 0.6} />
        ))}
        {rider(pos.s, '#2ee6ff', 'SGD', 'sgd', result?.winner === 'sgd')}
        {rider(pos.m, '#ffce6b', 'Momentum', 'mom', result?.winner === 'momentum')}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={race} data-demo="race">
          {phase === 'racing' ? '❚❚ Pause' : phase === 'paused' ? '▶ Resume' : phase === 'finished' ? '↻ Race again' : '🏁 Race'}
        </button>
        <button className="btn btn--ghost" onClick={reset} data-demo="reset">Reset</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.3" step="0.01" value={lr} onChange={(e) => setLr(+e.target.value)} data-demo="lr" /></label>
        <label className="dial">momentum β <b>{mom.toFixed(2)}</b>
          <input type="range" min="0" max="0.98" step="0.02" value={mom} onChange={(e) => setMom(+e.target.value)} data-demo="beta" /></label>
      </div>
      {result && (
        <div key={result.id} className={`stepper-msg om-nnb-callout${result.winner === 'momentum' ? '' : ' is-warn'}`} role="status" data-demo="callout">
          {result.winner === 'momentum' && (
            <>🏁 <b>Momentum wins.</b> Its built-up velocity carried it over the bump into the deeper valley
              (loss <b>{fmtLoss(GLOBAL_MIN)}</b>), while plain SGD stopped in the first dip it met (loss <b>{fmtLoss(LOCAL_MIN)}</b>).
              Decided after {result.steps} steps.</>
          )}
          {result.winner === 'sgd' && (
            <>🏁 <b>SGD wins this time.</b> Momentum overshot and came to rest in the shallow valley (loss <b>{fmtLoss(LOCAL_MIN)}</b>)
              while SGD reached the deep one (loss <b>{fmtLoss(GLOBAL_MIN)}</b>). Too much speed can overshoot the minimum you want.</>
          )}
          {result.winner === 'tie' && (
            <>Both settled in the <b>{result.sV}</b> valley (loss <b>{fmtLoss(result.sV === 'global' ? GLOBAL_MIN : LOCAL_MIN)}</b>).
              {result.sV === 'local' ? ' Momentum didn’t build enough speed to clear the bump — raise β toward 0.90 and race again.' : ''}</>
          )}
        </div>
      )}
      <p className="block-hint">
        Both start high on the right, above a shallow valley (a <b>local minimum</b>). Plain SGD rolls into it and stops;
        momentum accumulates velocity — v ← βv − η∇L — and can roll straight over the bump into the deeper
        valley on the left (the <b>global minimum</b>). loss(SGD) = <b style={{ color: '#2ee6ff' }} data-demo="stat-sgd">{fmtLoss(pos.s)}</b> ·
        loss(Momentum) = <b style={{ color: '#ffce6b' }} data-demo="stat-momentum">{fmtLoss(pos.m)}</b>
      </p>
    </div>
  );
}
