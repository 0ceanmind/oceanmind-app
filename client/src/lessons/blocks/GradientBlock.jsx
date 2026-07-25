import { useEffect, useRef, useState } from 'react';

const W = 620, H = 280, PAD = 40;
const xMin = -2.6, xMax = 2.6;
// A bumpy loss curve: global min near x=1.4, local min near x=-1.2
const loss = (x) => 0.28 * x * x + 0.35 * Math.sin(2.2 * x + 1) + 0.45;
const dLoss = (x) => 0.56 * x + 0.77 * Math.cos(2.2 * x + 1);
const yMin = 0, yMax = 2.4;
const px = (x) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
const py = (y) => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);

/** Gradient-descent lab: click the curve to drop a ball, tune the learning rate, watch it roll. */
export default function GradientBlock() {
  const [ball, setBall] = useState(-2.1);
  const [lr, setLr] = useState(0.08);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(0);
  const [trail, setTrail] = useState([]);
  const timer = useRef(null);
  const ballRef = useRef(ball);
  ballRef.current = ball;
  const lrRef = useRef(lr);
  lrRef.current = lr;

  useEffect(() => () => clearInterval(timer.current), []);

  const start = () => {
    if (running) { clearInterval(timer.current); setRunning(false); return; }
    setRunning(true);
    setTrail([]);
    setSteps(0);
    timer.current = setInterval(() => {
      const x = ballRef.current;
      const g = dLoss(x);
      let next = x - lrRef.current * g;
      next = Math.max(xMin, Math.min(xMax, next));
      setTrail((t) => [...t.slice(-40), x]);
      setBall(next);
      setSteps((s) => s + 1);
      if (Math.abs(g) < 0.004 || Math.abs(next - x) < 0.0005) {
        clearInterval(timer.current);
        setRunning(false);
      }
    }, 140);
  };

  const drop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const x = xMin + ((sx - PAD) / (W - 2 * PAD)) * (xMax - xMin);
    clearInterval(timer.current);
    setRunning(false);
    setTrail([]);
    setSteps(0);
    setBall(Math.max(xMin, Math.min(xMax, x)));
  };

  let curveD = '';
  for (let i = 0; i <= 140; i++) {
    const cx = xMin + (i / 140) * (xMax - xMin);
    curveD += `${i === 0 ? 'M' : 'L'}${px(cx).toFixed(1)} ${py(loss(cx)).toFixed(1)} `;
  }
  const g = dLoss(ball);

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} onClick={drop} style={{ cursor: 'crosshair' }}
        role="img" aria-label="Loss curve — click to place the ball">
        <path d={curveD} fill="none" stroke="#7fd8e8" strokeWidth="2.4" />
        <text x={W - PAD} y={py(0) + 18} textAnchor="end" fill="#5d7a8c" fontSize="11">weight value →</text>
        <text x={PAD} y={PAD - 12} fill="#5d7a8c" fontSize="11">loss ↑</text>
        {/* trail */}
        {trail.map((t, i) => (
          <circle key={i} cx={px(t)} cy={py(loss(t))} r="3.5" fill="#16b8d8" opacity={(i + 1) / trail.length * 0.5} />
        ))}
        {/* gradient arrow */}
        <line x1={px(ball)} y1={py(loss(ball))} x2={px(ball) - Math.sign(g) * 34} y2={py(loss(ball))}
          stroke="#ff8a6b" strokeWidth="2.4" markerEnd="url(#arr)" />
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 z" fill="#ff8a6b" />
          </marker>
        </defs>
        {/* ball */}
        <circle cx={px(ball)} cy={py(loss(ball)) - 8} r="9" fill="#ffce6b" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={start}>{running ? '❚❚ Pause' : '▶ Descend'}</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.01" max="0.6" step="0.01" value={lr} onChange={(e) => setLr(+e.target.value)} />
        </label>
        <div className="stepper-msg">
          step <b>{steps}</b> · loss <b>{loss(ball).toFixed(3)}</b> · gradient <b>{g.toFixed(3)}</b> — the ball always rolls
          opposite the gradient (orange arrow). {lr > 0.4 ? 'That learning rate is huge — watch it overshoot and bounce!' : 'Click anywhere on the curve to drop the ball somewhere new.'}
        </div>
      </div>
      <p className="block-hint">
        Try dropping the ball left of the bump: with a small learning rate it gets trapped in the shallow valley (a
        <b> local minimum</b>) — raise the rate and it can escape to the deeper one. This is gradient descent, the engine of all training.
      </p>
    </div>
  );
}
