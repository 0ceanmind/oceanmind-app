import { useCallback, useEffect, useRef, useState } from 'react';
import { createMLP, trainEpoch, accuracy, predict, makeDataset } from './mlp.js';
import { Card } from '../components/ui.jsx';

const W = 520;
const H = 400;
const GRID = 34; // decision-boundary resolution (kept modest — it's re-evaluated per redraw)
const REDRAW_EVERY = 3; // frames between full surface repaints while training

const DATASET_LABELS = { blobs: 'Two blobs', circle: 'Ring', spiral: 'Spiral' };

function toCanvas(p) {
  return [((p[0] + 1) / 2) * W, ((1 - (p[1] + 1) / 2)) * H];
}
function toData(cx, cy) {
  return [(cx / W) * 2 - 1, (1 - cy / H) * 2 - 1];
}

export default function NeuralNetLesson({ config }) {
  const canvasRef = useRef(null);
  const netRef = useRef(null);
  const dataRef = useRef([]);
  const rafRef = useRef(0);

  const [dataset, setDataset] = useState(config.dataset);
  const [hidden, setHidden] = useState(config.hidden);
  const [lr, setLr] = useState(config.lr);
  const [running, setRunning] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [loss, setLoss] = useState(null);
  const [acc, setAcc] = useState(null);
  const [paintClass, setPaintClass] = useState(0);

  const lrRef = useRef(lr);
  lrRef.current = lr;
  const runningRef = useRef(running);
  runningRef.current = running;

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
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    netRef.current = createMLP(nextHidden);
    if (regenData) dataRef.current = makeDataset(nextDataset, 140);
    setEpoch(0);
    setLoss(null);
    setAcc(null);
    requestAnimationFrame(draw);
  }, [dataset, hidden, draw]);

  useEffect(() => {
    reset(config.dataset, config.hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // training loop
  useEffect(() => {
    if (!running) return;
    let epochLocal = epoch;
    let frame = 0;
    const tick = () => {
      if (!runningRef.current) return;
      // one epoch per frame + throttled repaint keeps the tab responsive
      const l = trainEpoch(netRef.current, dataRef.current, lrRef.current);
      epochLocal += 1;
      frame += 1;
      if (frame % REDRAW_EVERY === 0) {
        setEpoch(epochLocal);
        setLoss(l);
        setAcc(accuracy(netRef.current, dataRef.current));
        draw();
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const onCanvasClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * W;
    const cy = ((e.clientY - rect.top) / rect.height) * H;
    dataRef.current = [...dataRef.current, { x: toData(cx, cy), y: paintClass }];
    draw();
  };

  const setArch = (layers) => {
    setHidden(layers);
    reset(dataset, layers, false);
  };

  return (
    <div className="lesson-grid">
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Controls</h3>

        <div className="field">
          <label>Dataset</label>
          <div className="seg" role="group" aria-label="Dataset">
            {(config.dataset === 'spiral' ? ['blobs', 'circle', 'spiral']
              : config.dataset === 'circle' ? ['blobs', 'circle'] : ['blobs']).map((k) => (
              <button key={k} className={dataset === k ? 'on' : ''} onClick={() => { setDataset(k); reset(k, hidden); }}>
                {DATASET_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        {config.showLayers && (
          <div className="field">
            <label>Hidden layers</label>
            <div className="seg" role="group" aria-label="Architecture">
              <button className={hidden.length === 1 && hidden[0] === 2 ? 'on' : ''} onClick={() => setArch([2])}>2</button>
              <button className={hidden.length === 1 && hidden[0] === 6 ? 'on' : ''} onClick={() => setArch([6])}>6</button>
              <button className={hidden.length === 2 ? 'on' : ''} onClick={() => setArch([8, 8])}>8 × 8</button>
            </div>
          </div>
        )}

        {config.showLR && (
          <div className="field">
            <label>Learning rate — {lr.toFixed(3)}</label>
            <div className="slider-wrap">
              <span>slow</span>
              <input type="range" min="0.001" max="0.5" step="0.001" value={lr}
                onChange={(e) => setLr(Number(e.target.value))} aria-label="Learning rate" />
              <span>fast</span>
            </div>
          </div>
        )}

        <div className="field">
          <label>Click canvas to add a point as…</label>
          <div className="seg" role="group" aria-label="Point class">
            <button className={paintClass === 0 ? 'on' : ''} onClick={() => setPaintClass(0)} style={{ color: paintClass === 0 ? '#ff8a6b' : undefined }}>● Coral</button>
            <button className={paintClass === 1 ? 'on' : ''} onClick={() => setPaintClass(1)} style={{ color: paintClass === 1 ? '#2ee6ff' : undefined }}>● Teal</button>
          </div>
        </div>

        <div className="ctrl-row">
          <button className="btn btn--primary" onClick={() => setRunning((r) => !r)}>
            {running ? '❚❚ Pause' : '▶ Train'}
          </button>
          <button className="btn btn--ghost" onClick={() => reset()}>Reset</button>
        </div>
      </Card>

      <Card>
        <div className="nn-canvas-frame">
          <canvas ref={canvasRef} width={W} height={H} onClick={onCanvasClick}
            aria-label="Neural network decision boundary canvas — click to add data points" />
        </div>
        <div className="nn-stats">
          <span>Epoch <b>{epoch}</b></span>
          <span>Loss <b>{loss === null ? '—' : loss.toFixed(3)}</b></span>
          <span>Accuracy <b>{acc === null ? '—' : `${Math.round(acc * 100)}%`}</b></span>
          <span>Points <b>{dataRef.current.length}</b></span>
        </div>
        <p className="muted mt-1">
          The colored background is the network’s current opinion about every point in space —
          watch it reshape as the weights learn. Teal dots are class A, coral dots class B.
        </p>
      </Card>
    </div>
  );
}
