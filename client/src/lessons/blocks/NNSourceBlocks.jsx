import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { demoRandom, prefersReducedMotion, useTweenedNumber } from '../../lib/motion.js';
import './nn-b.css';

// SVG ids must be unique per block instance and valid inside url(#…)
const useSvgId = (prefix) => `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

/* ============ BioNeuronBlock: biological neuron → artificial neuron ============ */

const PARTS = {
  dendrite: { label: 'Dendrites', bio: 'Receive incoming signals from thousands of other neurons.', ai: 'The inputs x₁…xₙ of an artificial neuron.' },
  soma: { label: 'Soma (cell body)', bio: 'Sums the incoming activations and decides whether to fire.', ai: 'The weighted sum Σwᵢxᵢ + b.' },
  axon: { label: 'Axon', bio: 'Carries the output spike away from the cell body.', ai: 'The neuron’s output value.' },
  synapse: { label: 'Synapse', bio: 'The junction whose strength decides how much signal passes through.', ai: 'The weight wᵢ — exactly what training adjusts.' },
};
const DENDRITES = [-55, -20, 15, 50].map((dy) => `M40 ${130 + dy} C 90 ${130 + dy * 0.6}, 120 ${130 + dy * 0.3}, 160 130`);
const AXON = 'M242 130 L 470 130';

export function BioNeuronBlock() {
  const [sel, setSel] = useState('dendrite');
  const [seen, setSeen] = useState(['dendrite']);
  const hot = (k) => (sel === k ? '#2acbe9' : 'rgba(127,216,232,0.5)');
  const choose = (k) => {
    setSel(k);
    setSeen((s) => (s.includes(k) ? s : [...s, k]));
  };
  // each part is a real button: click, or focus + Enter/Space
  const part = (k) => ({
    className: 'dg-node om-nnb-part',
    role: 'button',
    tabIndex: 0,
    'aria-label': PARTS[k].label,
    'aria-pressed': sel === k,
    'data-demo': `part-${k}`,
    onClick: () => choose(k),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(k); } },
  });

  // The spike (a CSS loop in nn-b.css) travels dendrites → soma → axon → synapse
  // every 2.4 s; all its pieces mount together, so they stay in step.
  return (
    <div className="block-frame" data-phase={sel} data-running="true" data-done={seen.length === 4} data-visited={seen.length}>
      <svg className="viz-svg" viewBox="0 0 640 260" role="group" aria-label="Biological neuron" data-demo="diagram">
        {/* dendrites */}
        <g {...part('dendrite')}>
          {DENDRITES.map((d, i) => <path key={`hit${i}`} d={d} className="om-nnb-hit" />)}
          {DENDRITES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={hot('dendrite')} strokeWidth={sel === 'dendrite' ? 3 : 2}
              className="om-nnb-ease" strokeLinecap="round" />
          ))}
          {DENDRITES.map((d, i) => (
            <path key={`spike${i}`} d={d} pathLength="1" strokeWidth="3.4" className="om-nnb-spike is-dend"
              style={{ animationDelay: `${[60, 0, 30, 90][i]}ms` }} />
          ))}
          <text x="52" y="60" fill={hot('dendrite')} fontSize="12" className="om-nnb-ease">dendrites</text>
        </g>
        {/* soma */}
        <g {...part('soma')}>
          <circle cx="200" cy="130" r="42" fill={sel === 'soma' ? 'rgba(22,184,216,0.3)' : 'rgba(22,184,216,0.12)'}
            stroke={hot('soma')} strokeWidth={sel === 'soma' ? 2.8 : 1.6} className="om-nnb-ease om-nnb-soma-fire" />
          <circle cx="200" cy="130" r="15" fill="rgba(127,216,232,0.28)" />
          <text x="200" y="196" textAnchor="middle" fill={hot('soma')} fontSize="12" className="om-nnb-ease">soma</text>
        </g>
        {/* axon */}
        <g {...part('axon')}>
          <path d={AXON} className="om-nnb-hit" />
          <path d={AXON} stroke={hot('axon')} strokeWidth={sel === 'axon' ? 6 : 4} className="om-nnb-ease" strokeLinecap="round" />
          <path d={AXON} pathLength="1" strokeWidth="6" className="om-nnb-spike is-axon" />
          <text x="350" y="112" textAnchor="middle" fill={hot('axon')} fontSize="12" className="om-nnb-ease">axon</text>
        </g>
        {/* synapse */}
        <g {...part('synapse')}>
          <path d="M470 130 q 26 -22 46 -8 q -16 24 -46 8" fill={sel === 'synapse' ? 'rgba(53,208,165,0.35)' : 'rgba(53,208,165,0.16)'}
            stroke={sel === 'synapse' ? '#35d0a5' : 'rgba(53,208,165,0.6)'} strokeWidth={sel === 'synapse' ? 2.6 : 1.6} className="om-nnb-ease" />
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={532 + i * 16} cy={122 + i * 6} r="3.5" fill="#35d0a5" opacity="0.25" className="om-nnb-vesicle"
              style={{ animationDelay: `${i * 60}ms` }} />
          ))}
          <text x="530" y="182" textAnchor="middle" fill={sel === 'synapse' ? '#35d0a5' : 'rgba(53,208,165,0.7)'} fontSize="12" className="om-nnb-ease">synapse</text>
        </g>
      </svg>
      <div key={sel} className="dg-detail" role="status" data-demo="detail">
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
const LOSS_KEYS = Object.keys(LOSSES);
const LW = 620, LH = 260, LPAD = 46;
const L_YMAX = 4;
const lpx = (p) => LPAD + p * (LW - 2 * LPAD);
// Values above the axis keep climbing (up to 1.5× the axis) and are clipped at
// the top of the plot, so cross-entropy visibly shoots off the chart instead
// of flattening into a fake plateau at the cap.
const lpy = (v) => LH - LPAD - (Math.min(v, L_YMAX * 1.5) / L_YMAX) * (LH - 2 * LPAD);
// Every loss here satisfies L(p, 0) = L(1 − p, 1), so the curves are drawn once
// for target 1 and mirrored for target 0.
const LOSS_CURVES = Object.fromEntries(LOSS_KEYS.map((k) => {
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const p = i / 120;
    d += `${i === 0 ? 'M' : 'L'}${lpx(p).toFixed(1)} ${lpy(LOSSES[k].f(p, 1)).toFixed(1)} `;
  }
  return [k, d];
}));

export function LossExplorerBlock() {
  const [active, setActive] = useState(['mse', 'bce']);
  const [leaving, setLeaving] = useState([]); // toggled off, fading out
  const [target, setTarget] = useState(1);
  const [pred, setPred] = useState(0.35);
  const clipId = useSvgId('om-nnb-lx');
  const leaveTimers = useRef({});
  useEffect(() => () => Object.values(leaveTimers.current).forEach(clearTimeout), []);

  const toggle = (k) => {
    clearTimeout(leaveTimers.current[k]);
    if (active.includes(k)) {
      if (active.length === 1) return; // at least one curve stays on
      setActive(active.filter((v) => v !== k));
      setLeaving((l) => [...l.filter((v) => v !== k), k]);
      leaveTimers.current[k] = setTimeout(() => setLeaving((l) => l.filter((v) => v !== k)), 320);
    } else {
      setLeaving((l) => l.filter((v) => v !== k));
      setActive([...active, k]);
    }
  };

  const offscale = active.filter((k) => LOSSES[k].f(pred, target) > L_YMAX);

  return (
    <div className="block-frame" data-phase={`target-${target}`} data-running="false" data-done="false"
      data-target={target} data-active={active.join(',')} data-offscale={offscale.join(',')}>
      <div className="seg" role="group" aria-label="Loss functions">
        {LOSS_KEYS.map((k) => {
          const v = LOSSES[k];
          return (
            <button key={k} className={active.includes(k) ? 'on' : ''} onClick={() => toggle(k)} aria-pressed={active.includes(k)}
              style={active.includes(k) ? { color: v.color } : {}} data-demo={`loss-${k}`}>{v.label}</button>
          );
        })}
      </div>
      <svg className="viz-svg" viewBox={`0 0 ${LW} ${LH}`} style={{ marginTop: '0.7rem' }} role="img" aria-label="Loss curves" data-demo="plot">
        <defs>
          <clipPath id={clipId}><rect x={LPAD - 3} y={LPAD - 12} width={LW - 2 * LPAD + 6} height={LH - 2 * LPAD + 15} /></clipPath>
        </defs>
        <line x1={LPAD} y1={lpy(0)} x2={LW - LPAD} y2={lpy(0)} stroke="rgba(127,216,232,0.28)" />
        <line x1={LPAD} y1={LPAD - 10} x2={LPAD} y2={lpy(0)} stroke="rgba(127,216,232,0.28)" />
        <text x={LW - LPAD} y={LH - 12} textAnchor="end" fill="#5d7a8c" fontSize="11">prediction →</text>
        <text x={12} y={LPAD - 16} fill="#5d7a8c" fontSize="11">loss ↑</text>
        <g clipPath={`url(#${clipId})`}>
          {/* curves: draw in when switched on, fade when switched off, mirror on a target flip */}
          <g className="om-nnb-mirror" style={{ transformOrigin: `${LW / 2}px 0px`, transform: target === 0 ? 'scaleX(-1)' : 'none' }}>
            {LOSS_KEYS.filter((k) => active.includes(k) || leaving.includes(k)).map((k) => (
              <path key={k} d={LOSS_CURVES[k]} pathLength="1" fill="none" stroke={LOSSES[k].color} strokeWidth="2.4"
                className={active.includes(k) ? 'om-draw-in' : 'om-nnb-curve-out'} />
            ))}
          </g>
        </g>
        {/* target marker */}
        <g className="om-nnb-slide" style={{ transform: `translateX(${(lpx(target) - lpx(0)).toFixed(1)}px)` }}>
          <line x1={lpx(0)} y1={LPAD - 10} x2={lpx(0)} y2={lpy(0)} stroke="rgba(53,208,165,0.5)" strokeDasharray="4 4" />
          <text key={target} x={lpx(0)} y={LPAD - 16} textAnchor="middle" fill="#35d0a5" fontSize="11" className="om-swap">target {target}</text>
        </g>
        {/* live prediction */}
        <g className="om-nnb-follow" style={{ transform: `translateX(${lpx(pred).toFixed(1)}px)` }}>
          <line x1={0} y1={LPAD - 10} x2={0} y2={lpy(0)} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 5" />
        </g>
        {active.map((k) => {
          const v = LOSSES[k].f(pred, target);
          const off = v > L_YMAX;
          const cx = lpx(pred), cy = lpy(Math.min(v, L_YMAX));
          return (
            <g key={k}>
              <circle cx={cx} cy={cy} r="6" fill={LOSSES[k].color} className="glow om-glide" />
              {off && (
                <g className="om-nnb-offscale" data-demo={`offscale-${k}`}>
                  <path d={`M${cx - 5} ${cy - 10} L${cx} ${cy - 17} L${cx + 5} ${cy - 10} z`} fill={LOSSES[k].color} />
                  <text x={cx < LW / 2 ? cx + 11 : cx - 11} y={cy - 8} textAnchor={cx < LW / 2 ? 'start' : 'end'}
                    fill={LOSSES[k].color} fontSize="11" fontWeight="600">{v.toFixed(2)} ↑ off the chart</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="stepper-row">
        <label className="dial" style={{ minWidth: 220 }}>your prediction <b>{pred.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.99" step="0.01" value={pred} onChange={(e) => setPred(+e.target.value)} data-demo="pred" /></label>
        <div className="seg" role="group" aria-label="Target">
          <button className={target === 1 ? 'on' : ''} onClick={() => setTarget(1)} data-demo="target-1">target 1</button>
          <button className={target === 0 ? 'on' : ''} onClick={() => setTarget(0)} data-demo="target-0">target 0</button>
        </div>
        <div className="stepper-msg" data-demo="stat">
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
const PULSE_STEP = 110; // ms for the gradient pulse to cross one layer
const PULSE_REST = 1000; // pause between pulses
const BAR_EASE = '0.5s cubic-bezier(0.32,0.72,0,1)';

export function VanishingGradientBlock() {
  const [act, setAct] = useState('sigmoid');
  const [layers, setLayers] = useState(8);
  const [pulse, setPulse] = useState(-1); // which layer (counted back from the output) the pulse is passing
  const slope = ACTS[act].maxSlope;
  // gradient magnitude reaching the layer d steps back from the output
  const mags = useMemo(
    () => Array.from({ length: layers }, (_, d) => Math.pow(slope * (act === 'relu' ? 1 : 0.92), d)),
    [layers, slope, act]
  );
  const barW = 620 / layers;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  // bars grow in from the output side on mount; bars added later grow at once
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1300);
    return () => clearTimeout(t);
  }, []);

  // a gradient pulse leaves the output (right) and travels back to the input
  // (left), fading exactly as much as the gradient does
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let t;
    let d = -1;
    const tick = () => {
      d += 1;
      if (d >= layersRef.current) {
        d = -1;
        setPulse(-1);
        t = setTimeout(tick, PULSE_REST);
        return;
      }
      setPulse(d);
      t = setTimeout(tick, PULSE_STEP);
    };
    t = setTimeout(tick, 900); // let the bars grow in first
    return () => clearTimeout(t);
  }, []);

  const dead = mags.filter((m) => m < 0.01).length;
  // the pulse head rests where it finished (the input side) while it fades out
  const headD = pulse >= 0 ? Math.min(pulse, layers - 1) : layers - 1;
  const headM = mags[headD];
  const headX = (layers - 1 - headD) * barW + barW / 2;
  const headY = 185 - Math.max(1.5, headM * 150) - 10;

  return (
    <div className="block-frame" data-phase={act} data-running={pulse >= 0} data-done="false" data-layers={layers} data-dead={dead}>
      <div className="seg" role="group" aria-label="Activation">
        {Object.entries(ACTS).map(([k, v]) => (
          <button key={k} className={act === k ? 'on' : ''} onClick={() => setAct(k)} style={act === k ? { color: v.color } : {}}
            data-demo={`act-${k}`}>{v.label}</button>
        ))}
      </div>
      <svg className="viz-svg" viewBox="0 0 620 220" style={{ marginTop: '0.7rem' }} role="img" aria-label="Gradient magnitude per layer" data-demo="plot">
        {mags.map((m, d) => {
          const h = Math.max(1.5, m * 150);
          const lit = pulse === d;
          return (
            // output layer on the right (d = 0), input layer on the left
            <g key={d} className="om-nnb-slot" style={{ transform: `translateX(${((layers - 1 - d) * barW).toFixed(1)}px)` }}>
              <rect x={6} y={185 - h} width={barW - 12} height={h} rx="3" fill={ACTS[act].color}
                opacity={0.35 + m * 0.65} className="om-nnb-bar-in" style={{ '--d': intro ? d : 0, transition: `all ${BAR_EASE}` }} />
              <rect x={6} y={185 - h} width={barW - 12} height={h} rx="3" fill="#fff" className="om-nnb-pulse-bar"
                opacity={lit ? 0.1 + 0.35 * m : 0}
                style={{ transition: `y ${BAR_EASE}, height ${BAR_EASE}, width ${BAR_EASE}, opacity ${lit ? 0.1 : 0.6}s ease-out` }} />
              <g className="om-nnb-slot" style={{ transform: `translateX(${(barW / 2).toFixed(1)}px)` }}>
                <text x={0} y={202} textAnchor="middle" fill="#5d7a8c" fontSize="9">L{layers - d}</text>
                {m < 0.01 && <text key="dead" x={0} y={176} textAnchor="middle" fill="#ff6b81" fontSize="11" className="om-nnb-pop">💀</text>}
              </g>
            </g>
          );
        })}
        <g className="om-nnb-pulse-head" data-demo="pulse"
          style={{ transform: `translate(${headX.toFixed(1)}px, ${headY.toFixed(1)}px)`, ...(pulse <= 0 ? { transition: 'opacity 0.3s ease' } : {}) }}
          opacity={pulse >= 0 ? 0.3 + 0.7 * headM : 0}>
          <circle r={2 + 5 * Math.sqrt(headM)} fill={ACTS[act].color} style={{ filter: `drop-shadow(0 0 6px ${ACTS[act].color})` }} />
        </g>
        <text x={8} y={16} fill="#9db8c6" fontSize="11">gradient reaching each layer (output → input, right to left)</text>
      </svg>
      <div className="stepper-row">
        <label className="dial">depth <b>{layers} layers</b>
          <input type="range" min="3" max="14" step="1" value={layers} onChange={(e) => setLayers(+e.target.value)} data-demo="depth" /></label>
        <div className="stepper-msg">
          Gradient at the <b>first</b> layer: <b key={`${act}-${layers}`} className="om-swap om-nnb-num" data-demo="stat-first"
            style={{ color: mags.at(-1) < 0.01 ? 'var(--danger)' : 'var(--kelp)' }}>{mags.at(-1).toExponential(2)}</b>{' '}
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
const GD_START = [-2.1, 1.05];
const GD_TICK = 90;   // ms per descent step
const GD_STEPS = 61;
const VARIANTS = {
  batch: { label: 'Batch GD', color: '#2ee6ff', noise: 0, lr: 0.12, note: 'Uses the whole dataset per step: smooth, accurate, but slow and memory-hungry.' },
  mini: { label: 'Mini-batch', color: '#35d0a5', noise: 0.10, lr: 0.16, note: 'A compromise — small batches give a mostly-smooth path with far less compute. The default in practice.' },
  sgd: { label: 'Stochastic', color: '#ffce6b', noise: 0.30, lr: 0.20, note: 'One sample per step: very noisy and jittery, but fast and the noise can escape shallow traps.' },
};

// Noise is seeded in the pitch demo, so every rehearsal draws the same paths.
const freshGD = () => ({
  n: 0,
  last: 0,
  rand: demoRandom('gd-variants'),
  runs: Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, { x: GD_START[0], y: GD_START[1], path: [] }])),
});

// What to draw: the committed steps plus a head gliding along the current step.
function gdSnapshot(sim, f) {
  return Object.fromEntries(Object.entries(sim.runs).map(([k, s]) => {
    const prev = s.path.at(-1);
    const head = prev ? [prev[0] + (s.x - prev[0]) * f, prev[1] + (s.y - prev[1]) * f] : [s.x, s.y];
    return [k, { path: s.path, head }];
  }));
}

export function GDVariantsBlock() {
  const [phase, setPhase] = useState('ready'); // ready · racing · paused · finished
  const [view, setView] = useState(null);
  const [steps, setSteps] = useState(0);
  const [result, setResult] = useState(null);
  const sim = useRef(null);
  const timers = useRef({ step: null, frame: null });

  const stopTimers = () => {
    clearInterval(timers.current.step);
    clearTimeout(timers.current.frame);
    timers.current = { step: null, frame: null };
  };
  useEffect(() => stopTimers, []);

  const finish = () => {
    stopTimers();
    const s = sim.current;
    setView(gdSnapshot(s, 1));
    setResult({ id: performance.now(), losses: Object.fromEntries(Object.entries(s.runs).map(([k, r]) => [k, bowl(r.x, r.y)])) });
    setPhase('finished');
  };

  const start = () => {
    const s = sim.current;
    // physics: one noisy gradient step per tick
    timers.current.step = setInterval(() => {
      s.n += 1;
      for (const [k, v] of Object.entries(VARIANTS)) {
        const r = s.runs[k];
        const [gx, gy] = bgrad(r.x, r.y);
        r.path.push([r.x, r.y]);
        r.x -= v.lr * (gx + (s.rand() - 0.5) * v.noise * 6);
        r.y -= v.lr * (gy + (s.rand() - 0.5) * v.noise * 6);
      }
      s.last = performance.now();
      setSteps(s.n);
      if (s.n >= GD_STEPS) finish();
    }, GD_TICK);
    // drawing: heads glide along each step between ticks (setTimeout clock, not rAF)
    const frame = () => {
      const f = s.last ? Math.min(1, (performance.now() - s.last) / GD_TICK) : 1;
      setView(gdSnapshot(s, f));
      timers.current.frame = setTimeout(frame, 16);
    };
    frame();
    setPhase('racing');
  };

  const race = () => {
    if (phase === 'racing') {
      stopTimers();
      setView(gdSnapshot(sim.current, 1));
      setPhase('paused');
      return;
    }
    if (phase !== 'paused') { // ready or finished: a fresh race
      sim.current = freshGD();
      setSteps(0);
      setResult(null);
    }
    start();
  };

  const reset = () => {
    stopTimers();
    sim.current = null;
    setView(null);
    setSteps(0);
    setResult(null);
    setPhase('ready');
  };

  const fmt = (v) => (v < 0.0005 ? '≈ 0' : v.toFixed(3));

  return (
    <div className="block-frame" data-phase={phase} data-running={phase === 'racing'} data-done={phase === 'finished'} data-steps={steps}>
      <svg className="viz-svg" viewBox={`0 0 ${GW} ${GH}`} role="img" aria-label="Gradient descent variants" data-demo="plot">
        {/* contour rings of the bowl */}
        {[0.35, 0.8, 1.4, 2.2, 3.2].map((lv, i) => (
          <ellipse key={i} cx={gpx(0)} cy={gpy(0)} rx={Math.sqrt(lv / 0.5) * 92} ry={Math.sqrt(lv / 1.4) * 92}
            fill="none" stroke="rgba(127,216,232,0.18)" strokeWidth="1.2" />
        ))}
        <circle cx={gpx(0)} cy={gpy(0)} r="5" fill="#35d0a5" className="glow" />
        <text x={gpx(0) + 10} y={gpy(0) - 8} fill="#35d0a5" fontSize="11">minimum</text>
        {/* ghost start marker: where all three begin */}
        <circle cx={gpx(GD_START[0])} cy={gpy(GD_START[1])} r="11" fill="none" stroke="rgba(157,184,198,0.5)" strokeDasharray="3 4" strokeWidth="1.2" />
        <text x={gpx(GD_START[0])} y={gpy(GD_START[1]) + 25} textAnchor="middle" fill="#5d7a8c" fontSize="10.5">start</text>
        {view && Object.entries(VARIANTS).map(([k, v]) => {
          const { path, head } = view[k];
          const d = [...path, head].map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${gpx(x).toFixed(1)} ${gpy(y).toFixed(1)}`).join(' ');
          return (
            <g key={k}>
              {path.length > 0 && <path d={d} fill="none" stroke={v.color} strokeWidth="2" strokeLinejoin="round" opacity="0.85" />}
              <circle cx={gpx(head[0])} cy={gpy(head[1])} r="6" fill={v.color} className={phase === 'racing' ? 'glow' : ''} />
              {result && <circle key={result.id} cx={gpx(head[0])} cy={gpy(head[1])} r="8" stroke={v.color} strokeWidth="1.6" className="om-nnb-ring" />}
            </g>
          );
        })}
        {Object.entries(VARIANTS).map(([k, v], i) => (
          <g key={`l${k}`}>
            <rect x={16} y={16 + i * 18} width="10" height="10" rx="2" fill={v.color} />
            <text x={32} y={25 + i * 18} fill="#9db8c6" fontSize="11">{v.label}</text>
          </g>
        ))}
        {phase !== 'ready' && <text x={GW - 16} y={25} textAnchor="end" fill="#5d7a8c" fontSize="11" data-demo="stat-steps">step {steps} / {GD_STEPS}</text>}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={race} data-demo="race">
          {phase === 'racing' ? '❚❚ Pause' : phase === 'paused' ? '▶ Resume' : phase === 'finished' ? '↻ Race again' : '🏁 Race all three'}
        </button>
        <button className="btn btn--ghost" onClick={reset} data-demo="reset">Reset</button>
      </div>
      {result && (
        <div key={result.id} className="stepper-msg om-nnb-callout" role="status" data-demo="callout">
          🏁 <b>{GD_STEPS} steps each.</b> <b style={{ color: VARIANTS.batch.color }}>Batch</b> took the smooth road to loss <b>{fmt(result.losses.batch)}</b>;{' '}
          <b style={{ color: VARIANTS.mini.color }}>mini-batch</b> wobbled but got close (loss <b>{fmt(result.losses.mini)}</b>);{' '}
          <b style={{ color: VARIANTS.sgd.color }}>stochastic</b> is still jittering around the minimum (loss <b>{fmt(result.losses.sgd)}</b>),
          yet each of its steps looked at a single example instead of the whole dataset.
        </div>
      )}
      <p className="block-hint">
        {Object.values(VARIANTS).map((v) => <span key={v.label}><b style={{ color: v.color }}>{v.label}</b> — {v.note} </span>)}
      </p>
    </div>
  );
}

/* ============ ChainRuleBlock: the computational graph behind backprop ============ */

// the backward hops, in order: each is the edge the gradient crosses (drawn source → target)
const HOPS = [null, ['v', 's'], ['u', 'v'], ['w', 'u']];

export function ChainRuleBlock() {
  const [x, setX] = useState(1.4);
  const [w, setW] = useState(0.8);
  const [b, setB] = useState(-0.3);
  const [stage, setStage] = useState(0); // 0 forward · 1..3 backward hops
  const arrowId = useSvgId('om-nnb-cr');

  // the inputs glide, so a slider change visibly cascades through the graph
  const tx = useTweenedNumber(x, { duration: 350 });
  const tw = useTweenedNumber(w, { duration: 350 });
  const tb = useTweenedNumber(b, { duration: 350 });
  const u = tw * tx;        // multiply
  const v = u + tb;         // add
  const s = 1 / (1 + Math.exp(-v)); // sigmoid
  const dS_dv = s * (1 - s);
  const dv_du = 1;
  const du_dw = tx;
  const dS_dw = dS_dv * dv_du * du_dw;

  const nodes = [
    { id: 'x', label: `x = ${tx.toFixed(2)}`, cx: 70, cy: 60 },
    { id: 'w', label: `w = ${tw.toFixed(2)}`, cx: 70, cy: 170 },
    { id: 'u', label: `u = w·x = ${u.toFixed(2)}`, cx: 240, cy: 115 },
    { id: 'b', label: `b = ${tb.toFixed(2)}`, cx: 240, cy: 220 },
    { id: 'v', label: `v = u+b = ${v.toFixed(2)}`, cx: 410, cy: 160 },
    { id: 's', label: `σ(v) = ${s.toFixed(3)}`, cx: 560, cy: 100 },
  ];
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [['x', 'u'], ['w', 'u'], ['u', 'v'], ['b', 'v'], ['v', 's']];
  const hopOf = (a, bb) => HOPS.findIndex((h) => h && h[0] === a && h[1] === bb);
  // local derivative shown on each hop's edge once the gradient has crossed it
  const hopLabel = { 1: `×${dS_dv.toFixed(3)}`, 2: '×1', 3: `×x = ${tx.toFixed(2)}` };
  const visited = new Set(HOPS.slice(1, stage + 1).flat());

  const msgs = [
    <>Forward: each node computes its value from its inputs. Drag the sliders — everything downstream updates instantly.</>,
    <><b>Hop 1:</b> ∂σ/∂v = σ(v)·(1−σ(v)) = <b>{dS_dv.toFixed(4)}</b> — the sigmoid’s local slope.</>,
    <><b>Hop 2:</b> ∂v/∂u = <b>1</b> (addition just passes gradient straight through, unchanged).</>,
    <><b>Hop 3:</b> ∂u/∂w = x = <b>{tx.toFixed(2)}</b>. Multiply the whole chain: ∂σ/∂w = {dS_dv.toFixed(4)} × 1 × {tx.toFixed(2)} = <b style={{ color: 'var(--kelp)' }}>{dS_dw.toFixed(4)}</b>. That is backpropagation — the chain rule, applied edge by edge.</>,
  ];

  return (
    <div className="block-frame" data-phase={stage} data-running="false" data-done={stage === 3}>
      <svg className="viz-svg" viewBox="0 0 640 270" role="img" aria-label="Computational graph and chain rule" data-demo="plot">
        <defs>
          {/* coral arrowhead at the start of an edge, pointing back against the forward direction */}
          <marker id={arrowId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10"
            markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#ff8a6b" />
          </marker>
        </defs>
        {edges.map(([a, bb], i) => {
          const hop = hopOf(a, bb);
          const current = stage > 0 && hop === stage;
          const crossed = hop > 0 && hop < stage;
          // at hop 3, ∂u/∂w = x: the x → u edge is lit gold as the value being multiplied in
          const factor = stage === 3 && a === 'x' && bb === 'u';
          return (
            <line key={i} x1={pos[a].cx + 52} y1={pos[a].cy} x2={pos[bb].cx - 52} y2={pos[bb].cy}
              stroke={current ? '#ff8a6b' : crossed ? 'rgba(255,138,107,0.6)' : factor ? '#ffce6b' : stage === 0 ? '#2ee6ff' : 'rgba(127,216,232,0.28)'}
              strokeWidth={current ? 3.4 : crossed || factor ? 2.4 : 2}
              strokeDasharray={factor ? '5 4' : undefined}
              markerStart={current || crossed ? `url(#${arrowId})` : undefined}
              className={`om-nnb-ease ${current ? 'flow-anim om-flow-reverse' : crossed ? 'flow-anim om-flow-reverse om-flow-idle' : stage === 0 ? 'flow-anim' : ''}`} />
          );
        })}
        {nodes.map((n) => {
          const lit = stage > 0 && HOPS[stage].includes(n.id);
          const factor = stage === 3 && n.id === 'x';
          const trail = !lit && visited.has(n.id);
          return (
            <g key={n.id}>
              <rect x={n.cx - 52} y={n.cy - 20} width="104" height="40" rx="12"
                fill={lit ? 'rgba(255,138,107,0.2)' : factor ? 'rgba(255,206,107,0.14)' : 'rgba(8,26,42,0.92)'}
                stroke={lit ? '#ff8a6b' : factor ? '#ffce6b' : trail ? 'rgba(255,138,107,0.55)' : 'rgba(127,216,232,0.45)'}
                strokeWidth={lit || factor ? 2.4 : 1.3}
                className={`om-nnb-ease${lit ? ' glow' : ''}`} />
              <text x={n.cx} y={n.cy + 4} textAnchor="middle" fill="#fff" fontSize="11">{n.label}</text>
            </g>
          );
        })}
        {HOPS.slice(1, stage + 1).map(([a, bb], i) => (
          <text key={`hop${i + 1}`} x={(pos[a].cx + 52 + pos[bb].cx - 52) / 2} y={(pos[a].cy + pos[bb].cy) / 2 - 9}
            textAnchor="middle" fill="#ff8a6b" fontSize="10.5" fontWeight="600" stroke="#05121e" strokeWidth="3"
            paintOrder="stroke" className="om-nnb-pop">{hopLabel[i + 1]}</text>
        ))}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--ghost" onClick={() => setStage(Math.max(0, stage - 1))} disabled={stage === 0} data-demo="back">← Back</button>
        <button className="btn btn--primary" onClick={() => setStage(Math.min(3, stage + 1))} disabled={stage === 3} data-demo="next">
          {stage === 0 ? 'Start backward pass →' : 'Next hop →'}
        </button>
        <label className="dial">x <b>{x.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={x} onChange={(e) => setX(+e.target.value)} data-demo="x" /></label>
        <label className="dial">w <b>{w.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={w} onChange={(e) => setW(+e.target.value)} data-demo="w" /></label>
        <label className="dial">b <b>{b.toFixed(2)}</b><input type="range" min="-2" max="2" step="0.1" value={b} onChange={(e) => setB(+e.target.value)} data-demo="b" /></label>
      </div>
      <div key={stage} className="stepper-msg om-swap" role="status" data-demo="msg">{msgs[stage]}</div>
    </div>
  );
}
