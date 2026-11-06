import { useEffect, useId, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween } from '../../lib/motion.js';
import './nn-a.css';

const W = 620, H = 280, PAD = 40;
const xMin = -2.6, xMax = 2.6;
const yMin = 0, yMax = 2.7;

// The landscape: a steep cliff on the left, a shallow narrow dip (the LOCAL
// minimum, x ≈ -1.90, loss 0.85), a bump (x ≈ -1.32, loss 1.26) and a wide deep
// valley (the GLOBAL minimum, x ≈ 0.01, loss 0.22). Every claim in the copy was
// checked by running this exact update and stop rule in node from START_X:
//   lr .01–.18 → settles in the dip (lr .08: 6 steps)
//   lr .19–.42 → the first stride clears the bump, settles in the global valley
//               (lr .25: 8 steps, no wobble; lr .30: 8 steps)
//   lr ≥ .43   → overshoots the valley floor on every step and bounces for good
//               (a stable 2-cycle from .44; stopped after 60 steps)
const A = 0.114, M = -0.24, E = 1.36, WE = 0.13, D1 = 0.66, N1 = -1.94, S1 = 0.26, D2 = 0.97, N2 = 0.02, S2 = 0.475, C0 = 1.18;
const dip = (x) => Math.exp(-((x - N1) ** 2) / (2 * S1 * S1));
const valley = (x) => Math.exp(-((x - N2) ** 2) / (2 * S2 * S2));
const cliff = (x) => Math.exp(-(x - xMin) / WE);
const loss = (x) => A * (x - M) ** 2 + E * cliff(x) + C0 - D1 * dip(x) - D2 * valley(x);
const dLoss = (x) => 2 * A * (x - M) - (E / WE) * cliff(x) + (D1 * dip(x) * (x - N1)) / (S1 * S1) + (D2 * valley(x) * (x - N2)) / (S2 * S2);

const START_X = -2.52; // on the cliff
const LOCAL_X = -1.896;
const GLOBAL_X = 0.007;
const STEP_MS = 140;
const HOP_MS = 130; // each step's glide; shorter than STEP_MS so hops never overlap
const RETURN_MS = 480;
const MAX_STEPS = 60; // stop a run that is still bouncing after this many steps
const HARD_STEPS = 400;
const TRAIL = 40;

const px = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
const py = (y) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);
const clampX = (x) => Math.max(xMin, Math.min(xMax, x));

let CURVE_D = '';
for (let i = 0; i <= 160; i++) {
  const cx = xMin + (i / 160) * (xMax - xMin);
  CURVE_D += `${i === 0 ? 'M' : 'L'}${px(cx).toFixed(1)} ${py(loss(cx)).toFixed(1)} `;
}

/** How high a step must arc so the ball clears the curve (big strides hop the bump). */
function hopLift(xa, ya, xb, yb) {
  let lift = 0;
  for (let i = 1; i < 16; i++) {
    const s = i / 16;
    const need = loss(xa + (xb - xa) * s) - (ya + (yb - ya) * s);
    if (need > 0) lift = Math.max(lift, need / (4 * s * (1 - s)));
  }
  return lift > 0 ? lift + 0.05 : 0;
}

function classify(x) {
  if (Math.abs(x - LOCAL_X) < 0.05) return 'local';
  if (Math.abs(x - GLOBAL_X) < 0.05) return 'global';
  return 'flat';
}

/** ≥4 direction changes in the last 8 steps = bouncing, not just rolling slowly. */
function isBouncing(path) {
  const p = path.slice(-9);
  let r = 0;
  for (let i = 2; i < p.length; i++) {
    const a = p[i - 1] - p[i - 2];
    const b = p[i] - p[i - 1];
    if (a * b < 0 && Math.abs(b) > 0.002) r++;
  }
  return r >= 4;
}

const RESULT = {
  local: { label: 'local minimum', color: '#ff8a6b', msg: 'Stuck in a local minimum: the slope is zero here, so gradient descent stops, even though a deeper valley exists. Raise the learning rate (try 0.25) and press Descend to retry from the same start.' },
  global: { label: 'global minimum', color: '#35d0a5', msg: 'Global minimum: the lowest point on this curve. Every step followed the slope downhill.' },
  flat: { label: 'flat spot', color: '#ffce6b', msg: 'Stopped on a flat spot: the slope is zero on top of the bump too, so gradient descent has nothing to follow.' },
  bounce: { label: 'never settles', color: '#ff8a6b', msg: 'Never settles: every step overshoots the valley floor, so the ball bounces from side to side. Lower the learning rate.' },
  slow: { label: 'still rolling', color: '#ffce6b', msg: 'Still creeping after 400 tiny steps: a very small learning rate is safe but slow.' },
};

/** Gradient-descent lab: click the curve to drop a ball, tune the learning rate, watch it roll. */
export default function GradientBlock() {
  const uid = useId().replace(/:/g, '');
  const [ball, setBall] = useState(START_X);
  const [pos, setPos] = useState({ x: START_X, y: loss(START_X) }); // where the ball is drawn (mid-hop too)
  const [lr, setLr] = useState(0.08);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(0);
  const [trail, setTrail] = useState([]); // [{ x, n }]
  const [result, setResult] = useState(null);

  const timer = useRef(null);
  const motion = useRef(null);
  const ballRef = useRef(ball);
  const posRef = useRef(pos);
  posRef.current = pos;
  const lrRef = useRef(lr);
  lrRef.current = lr;
  const stepsRef = useRef(0);
  const pathRef = useRef([START_X]);
  const runStart = useRef(START_X); // where the current run began; "Descend" after a finished run retries from here

  useEffect(() => () => {
    clearTimeout(timer.current);
    motion.current?.cancel();
  }, []);

  /** Glide the drawn ball from wherever it is to x, arcing over anything in the way. */
  const glide = (x, duration, { dropFrom = null } = {}) => {
    motion.current?.cancel();
    const target = { x, y: loss(x) };
    if (prefersReducedMotion() || duration <= 0) {
      setPos(target);
      return;
    }
    const from = dropFrom ?? posRef.current;
    const lift = dropFrom ? 0 : hopLift(from.x, from.y, target.x, target.y);
    motion.current = tween({
      from: 0, to: 1, duration, easing: dropFrom ? ease.outCubic : ease.inOutCubic,
      onUpdate: (u) => setPos({
        x: from.x + (target.x - from.x) * u,
        y: from.y + (target.y - from.y) * u + lift * 4 * u * (1 - u),
      }),
    });
  };

  const stop = () => {
    clearTimeout(timer.current);
    setRunning(false);
  };

  const finish = (res) => {
    stop();
    setResult(res);
  };

  const stepOnce = () => {
    const x = ballRef.current;
    const g = dLoss(x);
    const next = clampX(x - lrRef.current * g);
    ballRef.current = next;
    stepsRef.current += 1;
    pathRef.current.push(next);
    const n = stepsRef.current;
    setBall(next);
    setSteps(n);
    setTrail((t) => [...t.slice(-(TRAIL - 1)), { x, n }]);
    glide(next, HOP_MS);
    if (Math.abs(g) < 0.004 || Math.abs(next - x) < 0.0005) return finish(classify(next));
    if (n >= MAX_STEPS && isBouncing(pathRef.current)) return finish('bounce');
    if (n >= HARD_STEPS) return finish('slow');
    timer.current = setTimeout(stepOnce, STEP_MS);
    return undefined;
  };

  /** Put the ball at x (a click, Reset, or a retry) with an empty trail. */
  const place = (x, { animate = 'return' } = {}) => {
    stop();
    setResult(null);
    setTrail([]);
    setSteps(0);
    stepsRef.current = 0;
    pathRef.current = [x];
    ballRef.current = x;
    runStart.current = x;
    setBall(x);
    if (animate === 'drop') glide(x, 340, { dropFrom: { x, y: loss(x) + 0.55 } });
    else glide(x, RETURN_MS);
  };

  const start = () => {
    if (running) {
      stop(); // pause keeps the trail and step count
      return;
    }
    if (result) {
      // a finished run: fly back to where it began and descend again at the current rate
      place(runStart.current);
      setRunning(true);
      timer.current = setTimeout(stepOnce, RETURN_MS + 60);
      return;
    }
    if (stepsRef.current === 0) runStart.current = ballRef.current;
    setRunning(true);
    timer.current = setTimeout(stepOnce, 60);
  };

  const drop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const x = clampX(xMin + ((sx - PAD) / (W - 2 * PAD)) * (xMax - xMin));
    place(x, { animate: 'drop' });
  };

  const g = Math.abs(dLoss(ball)) < 0.0005 ? 0 : dLoss(ball); // no "-0.000" at a minimum
  // the arrow rides on the drawn ball and its length follows the slope under it
  const gDraw = dLoss(pos.x);
  const arrowLen = Math.min(80, Math.abs(gDraw) * 24);
  const bx = px(pos.x);
  const by = py(pos.y);
  const tier = lr >= 0.36
    ? 'That learning rate is huge — steps can overshoot the valley floor, so the ball may bounce from side to side.'
    : lr >= 0.19
      ? 'Bigger steps: one stride can clear a bump and land in a deeper valley.'
      : 'Small steps: the ball settles into the nearest dip, even a shallow one.';
  const idle = !running && steps === 0 && !result;

  return (
    <div className="block-frame" data-running={running ? 'true' : 'false'} data-steps={steps}
      data-result={result ?? ''} data-x={ball.toFixed(3)} data-lr={lr.toFixed(2)}>
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} onClick={drop} style={{ cursor: 'crosshair' }}
        role="img" aria-label="Loss curve — click to place the ball" data-demo="curve">
        <defs>
          <clipPath id={`gc${uid}`}><rect x="0" y={PAD - 14} width={W} height={H - PAD + 14} /></clipPath>
          <marker id={`ga${uid}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 z" fill="#ff8a6b" />
          </marker>
        </defs>
        <path d={CURVE_D} pathLength="1" fill="none" stroke="#7fd8e8" strokeWidth="2.4" className="om-draw-in" clipPath={`url(#gc${uid})`} />
        <text x={W - PAD} y={py(0) + 18} textAnchor="end" fill="#5d7a8c" fontSize="11">weight value →</text>
        <text x={PAD} y={PAD - 22} fill="#5d7a8c" fontSize="11">loss ↑</text>
        {/* trail: each visited spot stays put and fades as the run moves on */}
        {trail.map((t, i) => (
          <circle key={t.n} cx={px(t.x)} cy={py(loss(t.x))} r="3.5" fill="#16b8d8" className="om-glide"
            style={{ opacity: ((i + 1) / trail.length) * 0.5 }} />
        ))}
        {/* gradient arrow: points downhill, length ∝ |gradient| */}
        <path d={`M${bx.toFixed(1)} ${by.toFixed(1)} L${(bx - Math.sign(gDraw) * arrowLen).toFixed(1)} ${by.toFixed(1)}`}
          stroke="#ff8a6b" strokeWidth="2.4" markerEnd={`url(#ga${uid})`} className="om-nna-fade"
          style={{ opacity: arrowLen < 4 ? 0 : 1 }} />
        {/* ball */}
        <circle cx={bx} cy={by - 8} r="9" fill="#ffce6b" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
        {result && (
          <text key={result} x={px(ball)} y={py(loss(ball)) - 30} textAnchor="middle" fontSize="12" fontWeight="600"
            fill={RESULT[result].color} className="om-nna-appear" data-demo="result">
            {RESULT[result].label}
          </text>
        )}
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" data-demo="descend" onClick={start}>
          {running ? '❚❚ Pause' : steps > 0 && !result ? '▶ Resume' : '▶ Descend'}
        </button>
        <button className="btn btn--ghost" data-demo="reset" onClick={() => place(START_X)}>↺ Reset</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.6" step="0.01" value={lr} data-demo="lr" onChange={(e) => setLr(+e.target.value)} />
        </label>
        <div className="stepper-msg" data-demo="msg">
          step <b>{steps}</b> · loss <b>{loss(ball).toFixed(3)}</b> · gradient <b>{g.toFixed(3)}</b> — the ball always rolls
          opposite the gradient (orange arrow).{' '}
          <span key={result ?? tier} className="om-nna-appear">
            {result ? RESULT[result].msg : idle ? `${tier} Click anywhere on the curve to drop the ball somewhere new.` : tier}
          </span>
        </div>
      </div>
      <p className="block-hint">
        From the cliff: at a learning rate of 0.08 the ball settles in the shallow dip, a <b>local minimum</b>. At 0.25 its
        first stride clears the bump and it rolls into the deeper valley, the <b>global minimum</b>. Above about 0.45 every
        step overshoots, so it bounces forever. This is gradient descent, the engine of all training.
      </p>
    </div>
  );
}
