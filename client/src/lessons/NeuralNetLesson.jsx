import { useCallback, useEffect, useRef, useState } from 'react';
import { createMLP, trainEpoch, accuracy, predict, makeDataset } from './mlp.js';
import { Card } from '../components/ui.jsx';
import { demoRandom, useTweenedNumber } from '../lib/motion.js';
import './blocks/nn-a.css';

const W = 520;
const H = 400;
const GRID = 34; // decision-boundary resolution (kept modest — it's re-evaluated per redraw)

// Training runs on a wall clock, not one epoch per animation frame: the same
// epochs per second on a 60 Hz or 144 Hz screen, and it keeps going (catching
// up) when the tab is briefly hidden. Spiral needs far more epochs, so it runs
// faster.
const EPOCHS_PER_SEC = { blobs: 50, circle: 50, spiral: 100 };
const TICK_MS = 16;
const MAX_CATCHUP_SEC = 1.5; // after a stall, catch up at most this much training in one tick
const STATS_MS = 90; // how often the stats and sparkline refresh while training
const CONVERGED_ACC = 0.98; // auto-pause bar
const MIN_TRAIN_SEC = 1.5; // let an instantly-solved dataset visibly settle before pausing
const SPARK_POINTS = 64;

// Demo runs are seeded (demoRandom) so every rehearsal trains identically.
// Variants were picked by simulating mlp.js in node with these exact keys:
// circle/[6] reaches 98% after 120 epochs at lr .008 (190 at .005, 97 at .01,
// 34 at .03; the same ±7 with 3 extra teal points), spiral/[8,8] after 296 at
// lr .05 and then holds 100%.
const SEED_VARIANT = { blobs: 0, circle: 0, spiral: 22 };

const DATASET_LABELS = { blobs: 'Two blobs', circle: 'Ring', spiral: 'Spiral' };

function toCanvas(p) {
  return [((p[0] + 1) / 2) * W, ((1 - (p[1] + 1) / 2)) * H];
}
function toData(cx, cy) {
  return [(cx / W) * 2 - 1, (1 - cy / H) * 2 - 1];
}

/** Evenly spaced samples (always keeping the latest) for the loss sparkline. */
function downsample(values, n) {
  if (values.length <= n) return values.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(values[Math.round((i / (n - 1)) * (values.length - 1))]);
  return out;
}

/** A stat that glides to each new value instead of jumping. */
function TweenStat({ value, format, duration = 260 }) {
  const v = useTweenedNumber(value ?? NaN, { duration });
  return value === null || !Number.isFinite(v) ? '—' : format(v);
}

/** Tiny loss-per-epoch sparkline next to the stats. */
function LossSpark({ values }) {
  const w = 96;
  const h = 26;
  let line = '';
  let last = null;
  if (values.length > 1) {
    const max = Math.max(...values, 0.05);
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 5)]);
    line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    last = pts[pts.length - 1];
  }
  return (
    <svg className="om-nna-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="rgba(127,216,232,0.18)" />
      {line && <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="rgba(22,184,216,0.12)" stroke="none" />}
      {line && <path d={line} fill="none" stroke="#7fd8e8" strokeWidth="1.5" strokeLinejoin="round" />}
      {last && <circle cx={last[0]} cy={last[1]} r="2.2" fill="#fff" />}
    </svg>
  );
}

export default function NeuralNetLesson({ config }) {
  const canvasRef = useRef(null);
  const netRef = useRef(null);
  const dataRef = useRef([]);
  const shuffleRef = useRef(Math.random);
  const epochRef = useRef(0);
  const accRef = useRef(null);
  const lossRef = useRef(null);
  const lossHistRef = useRef([]);
  const genRef = useRef(0); // bumps on every reset so a stale training tick never runs
  const rippleTimers = useRef([]);
  const rippleId = useRef(0);

  const [dataset, setDataset] = useState(config.dataset);
  const [hidden, setHidden] = useState(config.hidden);
  const [lr, setLr] = useState(config.lr);
  const [running, setRunning] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [loss, setLoss] = useState(null);
  const [acc, setAcc] = useState(null);
  const [history, setHistory] = useState([]);
  const [points, setPoints] = useState(0);
  const [converged, setConverged] = useState(null); // { epoch, acc } once auto-paused
  const [paintClass, setPaintClass] = useState(0);
  const [ripples, setRipples] = useState([]);

  const lrRef = useRef(lr);
  lrRef.current = lr;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const net = netRef.current;

    // decision surface
    const cell = W / GRID;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const p = predict(net, toData((gx + 0.5) * cell, (gy + 0.5) * (H / GRID)));
        // class 1 → teal, class 0 → coral
        const t = p;
        const r = Math.round(255 * (1 - t) * 0.42 + 8);
        const g = Math.round(90 * (1 - t) + 150 * t);
        const b = Math.round(85 * (1 - t) + 190 * t);
        ctx.fillStyle = `rgb(${r + 5},${Math.round(g * 0.45) + 20},${Math.round(b * 0.55) + 25})`;
        ctx.fillRect(gx * cell, gy * (H / GRID), cell + 1, H / GRID + 1);
      }
    }
    // points
    for (const { x, y } of dataRef.current) {
      const [cx, cy] = toCanvas(x);
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = y === 1 ? '#2ee6ff' : '#ff8a6b';
      ctx.fill();
      ctx.strokeStyle = 'rgba(3,10,18,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, []);

  const reset = useCallback((nextDataset = dataset, nextHidden = hidden, regenData = true) => {
    genRef.current += 1;
    setRunning(false);
    const v = SEED_VARIANT[nextDataset] ?? 0;
    const arch = nextHidden.join('x');
    netRef.current = createMLP(nextHidden, demoRandom(`nn-playground:net:${nextDataset}:${arch}:${v}`));
    shuffleRef.current = demoRandom(`nn-playground:shuffle:${nextDataset}:${arch}:${v}`);
    if (regenData) dataRef.current = makeDataset(nextDataset, 140, demoRandom(`nn-playground:data:${nextDataset}:${v}`));
    epochRef.current = 0;
    accRef.current = null;
    lossRef.current = null;
    lossHistRef.current = [];
    setEpoch(0);
    setLoss(null);
    setAcc(null);
    setHistory([]);
    setConverged(null);
    setPoints(dataRef.current.length);
    // the canvas exists by now (effects and handlers run after commit), and a
    // direct draw also paints in a hidden tab, unlike requestAnimationFrame
    draw();
  }, [dataset, hidden, draw]);

  useEffect(() => {
    reset(config.dataset, config.hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => rippleTimers.current.forEach(clearTimeout), []);

  // training loop: wall-clock epochs on a setTimeout clock
  useEffect(() => {
    if (!running) return undefined;
    const gen = genRef.current;
    const rate = EPOCHS_PER_SEC[dataset] ?? 50;
    const minEpochs = Math.round(rate * MIN_TRAIN_SEC);
    let last = performance.now();
    let owed = 0;
    let lastStats = 0;
    let timer = 0;
    // Auto-pause only when accuracy CROSSES the bar during this run, so Train
    // on an already-solved network keeps refining instead of stopping at once.
    let armed = accuracy(netRef.current, dataRef.current) < CONVERGED_ACC;

    const publish = () => {
      setEpoch(epochRef.current);
      setLoss(lossRef.current);
      setAcc(accRef.current);
      setHistory(downsample(lossHistRef.current, SPARK_POINTS));
    };

    const tick = () => {
      if (gen !== genRef.current) return;
      const now = performance.now();
      owed = Math.min(owed + ((now - last) / 1000) * rate, rate * MAX_CATCHUP_SEC);
      last = now;
      let n = Math.floor(owed);
      owed -= n;
      const trained = n;
      let hit = false;
      while (n-- > 0) {
        lossRef.current = trainEpoch(netRef.current, dataRef.current, lrRef.current, shuffleRef.current);
        epochRef.current += 1;
        lossHistRef.current.push(lossRef.current);
        accRef.current = accuracy(netRef.current, dataRef.current);
        if (accRef.current < CONVERGED_ACC) armed = true;
        else if (armed && epochRef.current >= minEpochs) {
          hit = true;
          break;
        }
      }
      if (trained > 0) draw();
      if (hit || now - lastStats >= STATS_MS) {
        lastStats = now;
        publish();
      }
      if (hit) {
        setConverged({ epoch: epochRef.current, acc: accRef.current });
        setRunning(false);
        return;
      }
      timer = setTimeout(tick, TICK_MS);
    };
    timer = setTimeout(tick, TICK_MS);
    return () => {
      clearTimeout(timer);
      // leave the numbers exactly where training stopped
      if (gen === genRef.current && epochRef.current > 0) publish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const onCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * W;
    const cy = ((e.clientY - rect.top) / rect.height) * H;
    dataRef.current = [...dataRef.current, { x: toData(cx, cy), y: paintClass }];
    setPoints(dataRef.current.length);
    setConverged(null); // the data changed, so "converged" no longer holds
    draw();
    // a ripple where the point landed, so every click is visible
    const id = ++rippleId.current;
    setRipples((r) => [...r, { id, x: (cx / W) * 100, y: (cy / H) * 100, cls: paintClass }]);
    rippleTimers.current.push(setTimeout(() => setRipples((r) => r.filter((p) => p.id !== id)), 750));
  };

  const setArch = (layers) => {
    setHidden(layers);
    reset(dataset, layers, false);
  };

  const toggleTraining = () => {
    if (!running) setConverged(null);
    setRunning((r) => !r);
  };

  const idle = !running && epoch === 0;
  const archKey = hidden.join('x');

  return (
    <div className="lesson-grid"
      data-running={running ? 'true' : 'false'}
      data-converged={converged ? 'true' : 'false'}
      data-epoch={epoch}
      data-acc={acc === null ? '' : Math.round(acc * 100)}
      data-points={points}
      data-dataset={dataset}
      data-hidden={archKey}
      data-lr={lr}>
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Controls</h3>

        <div className="field">
          <label>Dataset</label>
          <div className="seg" role="group" aria-label="Dataset">
            {(config.dataset === 'spiral' ? ['blobs', 'circle', 'spiral']
              : config.dataset === 'circle' ? ['blobs', 'circle'] : ['blobs']).map((k) => (
              <button key={k} className={dataset === k ? 'on' : ''} data-demo={`dataset-${k}`}
                onClick={() => { setDataset(k); reset(k, hidden); }}>
                {DATASET_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {config.showLayers && (
          <div className="field">
            <label>Hidden layers</label>
            <div className="seg" role="group" aria-label="Architecture">
              <button className={hidden.length === 1 && hidden[0] === 2 ? 'on' : ''} data-demo="arch-2" onClick={() => setArch([2])}>2</button>
              <button className={hidden.length === 1 && hidden[0] === 6 ? 'on' : ''} data-demo="arch-6" onClick={() => setArch([6])}>6</button>
              <button className={hidden.length === 2 ? 'on' : ''} data-demo="arch-8x8" onClick={() => setArch([8, 8])}>8 × 8</button>
            </div>
          </div>
        )}

        {config.showLR && (
          <div className="field">
            <label>Learning rate — {lr.toFixed(3)}</label>
            <div className="slider-wrap">
              <span>slow</span>
              <input type="range" min="0.001" max="0.5" step="0.001" value={lr} data-demo="lr"
                onChange={(e) => setLr(Number(e.target.value))} aria-label="Learning rate" />
              <span>fast</span>
            </div>
          </div>
        )}

        <div className="field">
          <label>Click canvas to add a point as…</label>
          <div className="seg" role="group" aria-label="Point class">
            <button className={paintClass === 0 ? 'on' : ''} data-demo="paint-coral" onClick={() => setPaintClass(0)} style={{ color: paintClass === 0 ? '#ff8a6b' : undefined }}>● Coral</button>
            <button className={paintClass === 1 ? 'on' : ''} data-demo="paint-teal" onClick={() => setPaintClass(1)} style={{ color: paintClass === 1 ? '#2ee6ff' : undefined }}>● Teal</button>
          </div>
        </div>

        <div className="ctrl-row">
          <button className="btn btn--primary" data-demo="train" onClick={toggleTraining}>
            {running ? '❚❚ Pause' : '▶ Train'}
          </button>
          <button className="btn btn--ghost" data-demo="reset" onClick={() => reset()}>Reset</button>
        </div>
      </Card>

      <Card>
        <div className={`nn-canvas-frame${converged ? ' om-nna-frame-done' : ''}`}>
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick} data-demo="canvas"
            aria-label="Neural network decision boundary canvas — click to add data points" />
          <div className={`om-nna-idle${idle ? ' on' : ''}`} aria-hidden="true">
            <span className="om-nna-idle-chip">▶ Press Train and watch the network learn</span>
          </div>
          {ripples.map((p) => (
            <span key={p.id} className={`om-nna-ripple${p.cls === 1 ? ' teal' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true" />
          ))}
          {converged && (
            <div className="om-nna-converged om-pop" data-demo="converged" role="status">
              ✓ Converged · {Math.round(converged.acc * 100)}% after {converged.epoch} epochs
            </div>
          )}
        </div>
        <div className="nn-stats">
          <span>Epoch <b data-demo="stat-epoch"><TweenStat value={epoch} format={(v) => Math.round(v)} duration={200} /></b></span>
          <span>Loss <b data-demo="stat-loss"><TweenStat value={loss} format={(v) => v.toFixed(3)} /></b></span>
          <span className="om-nna-spark-wrap" data-demo="sparkline" title="Loss per epoch">
            <LossSpark values={history} />
          </span>
          <span>Accuracy <b data-demo="stat-acc"><TweenStat value={acc === null ? null : acc * 100} format={(v) => `${Math.round(v)}%`} /></b></span>
          <span>Points <b data-demo="stat-points" key={points} className={points ? 'om-swap' : ''}>{points}</b></span>
        </div>
        <p className="muted mt-1">
          The colored background is the network’s current opinion about every point in space —
          watch it reshape as the weights learn. Teal dots are class A, coral dots class B.
        </p>
      </Card>
    </div>
  );
}
