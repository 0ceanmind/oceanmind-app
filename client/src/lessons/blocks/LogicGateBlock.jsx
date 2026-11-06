import { useEffect, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween } from '../../lib/motion.js';
import './nn-a.css';

/**
 * "Emulating logical gates with a perceptron" — straight from the source deck.
 * Pick a gate; a single perceptron tries to learn it, checking one truth-table
 * row per tick and nudging its line after every mistake. AND/OR/NAND converge;
 * XOR never does (not linearly separable) — the classic lesson, made live.
 */
const GATES = {
  AND: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
  OR: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
  NAND: [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
  XOR: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
};
// Start line, rate and tick were picked by simulating this exact rule in node:
// every gate starts with 2 rows wrong and a line clear of all four dots; AND is
// solved on tick 18, OR on 13, NAND on 14, each with the final line ≥ 0.27 from
// the nearest dot; XOR keeps swinging through 4 different lines and the weights
// never collapse to (0, 0). On some ticks the line legitimately sits off the
// chart (every point gets the same answer); the tinted region shows that.
const INIT_W = [0.3, -0.25];
const INIT_B = -0.25;
const LR = 0.15;
const TICK_MS = 120; // one truth-table row per tick
const LINE_MS = 110; // boundary glide, a little shorter than a tick
const MAX_EPOCHS = 30;
const XOR_VERDICT_TICKS = 12; // 3 full epochs of failing before the XOR verdict shows

const W = 340, H = 300, PAD = 60;
const gx = (v) => PAD + v * (W - 2 * PAD);
const gy = (v) => H - PAD - v * (H - 2 * PAD);
const BOX = [-0.25, 1.25]; // the boundary is drawn clipped to this square (data units)
const TINT = [-0.2, 1.2]; // the "predicted 1" tint covers this square

const round9 = (v) => Math.round(v * 1e9) / 1e9; // keeps 0.1-steps exact, so ties stay honest
const predict = (w, b, x1, x2) => (w[0] * x1 + w[1] * x2 + b >= 0 ? 1 : 0);
const wrongCount = (w, b, data) => data.filter(([x1, x2, y]) => predict(w, b, x1, x2) !== y).length;

/**
 * The boundary w·x + b = 0 in normal form: angle of the normal, signed offset,
 * and s = which side is "1" (s·(n·p − rho) ≥ 0). Null when w = (0, 0).
 */
function lineOf(w, b) {
  const n = Math.hypot(w[0], w[1]);
  if (n < 1e-9) return null;
  return { th: Math.atan2(w[1], w[0]), rho: -b / n, s: 1 };
}

/** The same line expressed closest to `from`, so a glide takes the short way round. */
function nearest(from, to) {
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const d1 = wrap(to.th - from.th);
  const d2 = wrap(to.th + Math.PI - from.th);
  return Math.abs(d1) <= Math.abs(d2)
    ? { th: from.th + d1, rho: to.rho, s: to.s }
    : { th: from.th + d2, rho: -to.rho, s: -to.s };
}

/**
 * The part of the plot the perceptron currently calls "1" (the TINT square
 * clipped by the half-plane). When the line itself sits off the chart, this
 * is the whole square or nothing, so the picture stays honest and continuous.
 */
function region(l) {
  if (!l) return null;
  const nx = Math.cos(l.th), ny = Math.sin(l.th);
  const f = ([x, y]) => l.s * (nx * x + ny * y - l.rho);
  const [a0, a1] = TINT;
  const sq = [[a0, a0], [a1, a0], [a1, a1], [a0, a1]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const p = sq[i], q = sq[(i + 1) % 4];
    const fp = f(p), fq = f(q);
    if (fp >= 0) pts.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return pts.length >= 3 ? pts.map(([x, y]) => `${gx(x).toFixed(1)},${gy(y).toFixed(1)}`).join(' ') : null;
}

/** Clip the (infinite) line to BOX and return its screen segment, or null if it misses. */
function segment(l) {
  if (!l) return null;
  const nx = Math.cos(l.th), ny = Math.sin(l.th);
  const p0 = [l.rho * nx, l.rho * ny];
  const d = [-ny, nx];
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (p0[k] < BOX[0] || p0[k] > BOX[1]) return null;
    } else {
      const a = (BOX[0] - p0[k]) / d[k];
      const c = (BOX[1] - p0[k]) / d[k];
      t0 = Math.max(t0, Math.min(a, c));
      t1 = Math.min(t1, Math.max(a, c));
    }
  }
  if (t0 >= t1) return null;
  return { x1: gx(p0[0] + d[0] * t0), y1: gy(p0[1] + d[1] * t0), x2: gx(p0[0] + d[0] * t1), y2: gy(p0[1] + d[1] * t1) };
}

export default function LogicGateBlock() {
  const [gate, setGate] = useState('AND');
  const [w, setW] = useState(INIT_W);
  const [b, setB] = useState(INIT_B);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(null); // null | 'solved' | 'gaveup'
  const [probe, setProbe] = useState(null); // the truth-table row checked last
  const [flips, setFlips] = useState([0, 0, 0, 0]); // per row: how often its prediction flipped
  const [shownLine, setShownLine] = useState(() => lineOf(INIT_W, INIT_B));

  const model = useRef({ gate: 'AND', w: INIT_W, b: INIT_B, tick: 0 });
  const timer = useRef(null);
  const glideRef = useRef(null);
  const lineRef = useRef(shownLine);
  lineRef.current = shownLine;

  useEffect(() => () => {
    clearTimeout(timer.current);
    glideRef.current?.cancel();
  }, []);

  // glide the drawn boundary to the model's line (rotation + offset), never snapping or vanishing
  useEffect(() => {
    const target = lineOf(w, b);
    glideRef.current?.cancel();
    const from = lineRef.current;
    if (!target || !from || prefersReducedMotion()) {
      setShownLine(target ?? from);
      return;
    }
    const to = nearest(from, target);
    glideRef.current = tween({
      from: 0, to: 1, duration: LINE_MS, easing: ease.app,
      onUpdate: (u) => setShownLine({ th: from.th + (to.th - from.th) * u, rho: from.rho + (to.rho - from.rho) * u, s: to.s }),
    });
  }, [w, b]);

  const stop = () => {
    clearTimeout(timer.current);
    setRunning(false);
  };

  const reset = (g = gate) => {
    stop();
    model.current = { gate: g, w: INIT_W, b: INIT_B, tick: 0 };
    setW(INIT_W); setB(INIT_B); setTick(0);
    setDone(null);
    setProbe(null);
    setFlips([0, 0, 0, 0]);
  };

  const tickOnce = () => {
    const m = model.current;
    const data = GATES[m.gate];
    const i = m.tick % 4;
    const [x1, x2, y] = data[i];
    const before = data.map(([a, c]) => predict(m.w, m.b, a, c));
    const err = y - predict(m.w, m.b, x1, x2);
    if (err !== 0) {
      m.w = [round9(m.w[0] + LR * err * x1), round9(m.w[1] + LR * err * x2)];
      m.b = round9(m.b + LR * err);
    }
    m.tick += 1;
    const after = data.map(([a, c]) => predict(m.w, m.b, a, c));
    if (after.some((p, k) => p !== before[k])) setFlips((f) => f.map((n, k) => (after[k] !== before[k] ? n + 1 : n)));
    setW(m.w); setB(m.b); setTick(m.tick); setProbe(i);
    if (wrongCount(m.w, m.b, data) === 0) {
      stop();
      setDone('solved');
    } else if (m.tick >= MAX_EPOCHS * 4) {
      stop();
      setDone('gaveup');
    } else {
      timer.current = setTimeout(tickOnce, TICK_MS);
    }
  };

  const train = () => {
    if (running) {
      stop();
      return;
    }
    if (done) reset(); // a finished run starts over from the first line instead of ticking once
    setRunning(true);
    timer.current = setTimeout(tickOnce, TICK_MS / 2);
  };

  const data = GATES[gate];
  const seg = segment(shownLine);
  const tint = region(shownLine);
  const errors = wrongCount(w, b, data);
  const solved = errors === 0;
  const epoch = Math.floor(tick / 4);
  const xorVerdict = gate === 'XOR' && tick >= XOR_VERDICT_TICKS;

  let msg;
  if (solved && tick > 0) msg = <span key="solved" className="om-pop" style={{ color: 'var(--kelp)' }}>Solved! One line cleanly separates the classes — {gate} is linearly separable.</span>;
  else if (xorVerdict) {
    msg = (
      <span key="xor" className="om-nna-appear" style={{ color: 'var(--coral)' }}>
        {done === 'gaveup' ? `Gave up after ${MAX_EPOCHS} epochs. ` : ''}XOR is <b>not linearly separable</b> — one straight line can never split it. Watch the perceptron fail forever. That’s exactly why we need hidden layers.
      </span>
    );
  } else if (tick === 0 && !running) msg = <span key="idle">Press Train: the perceptron checks one row at a time and nudges the line after every mistake.</span>;
  else msg = <span key="training">Training… the line rotates to separate teal (1) from coral (0).</span>;

  return (
    <div className="block-frame" data-gate={gate} data-running={running ? 'true' : 'false'} data-epoch={epoch} data-tick={tick}
      data-errors={errors} data-solved={solved && tick > 0 ? 'true' : 'false'} data-done={done ?? ''}>
      <div className="seg" role="group" aria-label="Logic gate" style={{ marginBottom: '0.7rem' }}>
        {Object.keys(GATES).map((g) => (
          <button key={g} className={gate === g ? 'on' : ''} data-demo={`gate-${g.toLowerCase()}`}
            onClick={() => { setGate(g); reset(g); }}>{g}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 340 }} role="img" aria-label={`${gate} gate perceptron`}>
          {/* faint teal = where the perceptron currently answers 1 */}
          {tint && <polygon points={tint} fill="rgba(46,230,255,0.07)" data-demo="region" />}
          <line x1={PAD} y1={gy(0)} x2={W - PAD} y2={gy(0)} stroke="rgba(127,216,232,0.25)" />
          <line x1={gx(0)} y1={H - PAD} x2={gx(0)} y2={PAD} stroke="rgba(127,216,232,0.25)" />
          <text x={gx(0)} y={gy(0) + 22} textAnchor="middle" fill="#5d7a8c" fontSize="11">0</text>
          <text x={gx(1)} y={gy(0) + 22} textAnchor="middle" fill="#5d7a8c" fontSize="11">1  (x₁)</text>
          <text x={gx(0) - 16} y={gy(1)} textAnchor="end" fill="#5d7a8c" fontSize="11">1 (x₂)</text>
          {seg && <line {...seg} stroke={solved && tick > 0 ? '#35d0a5' : '#7fd8e8'} strokeWidth="2.4" className="glow om-stroke-ease" />}
          {/* the row being checked right now */}
          {running && probe !== null && (
            <circle cx={gx(data[probe][0])} cy={gy(data[probe][1])} r="18" fill="none" stroke="#7fd8e8" strokeWidth="1.4"
              strokeDasharray="3 4" className="om-glide om-nna-probe" />
          )}
          {data.map(([x1, x2, y], i) => {
            const wrong = predict(w, b, x1, x2) !== y;
            return (
              <g key={i}>
                <circle cx={gx(x1)} cy={gy(x2)} r="11"
                  fill={y === 1 ? '#2ee6ff' : '#ff8a6b'}
                  stroke={wrong ? '#ffce6b' : 'rgba(3,10,18,0.9)'} strokeWidth={wrong ? 3 : 1.5} className="om-stroke-ease" />
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
                const pred = predict(w, b, x1, x2);
                const cls = `${flips[i] > 0 ? 'om-nna-flip' : ''}${running && probe === i ? ' om-nna-checking' : ''}`.trim();
                return (
                  <tr key={`${i}-${flips[i]}`} className={cls || undefined} data-demo="truth-row" data-idx={i}>
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
        <button className="btn btn--primary" data-demo="train" onClick={train}>{running ? '❚❚ Pause' : '▶ Train perceptron'}</button>
        <button className="btn btn--ghost" data-demo="reset" onClick={() => reset()}>Reset</button>
        <div className="stepper-msg" data-demo="msg">
          epoch <b>{epoch}</b> · <b>{errors}</b>/4 wrong · {msg}
        </div>
      </div>
    </div>
  );
}
