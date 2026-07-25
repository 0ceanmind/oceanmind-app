import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * A real 3-D loss surface you can orbit with the mouse, with a ball performing
 * gradient descent across it and leaving a trail. Rendered as depth-sorted SVG
 * quads (no WebGL dependency), shaded by height — covers "gradient and Hessian"
 * and gradient-descent optimization from the source deck.
 */
const N = 22;               // grid resolution
const SPAN = 2.6;           // world extent in x/y
const W = 640, H = 380;

// A bowl with a saddle-ish ripple: interesting but well-behaved.
const lossFn = (x, y) => 0.45 * (x * x + y * y) + 0.55 * Math.sin(1.7 * x) * Math.cos(1.7 * y) + 1.2;
const gradFn = (x, y) => [
  0.9 * x + 0.935 * Math.cos(1.7 * x) * Math.cos(1.7 * y),
  0.9 * y - 0.935 * Math.sin(1.7 * x) * Math.sin(1.7 * y),
];

export default function LossSurface3D() {
  const [rot, setRot] = useState({ a: 0.7, e: 0.62 }); // azimuth, elevation
  const [ball, setBall] = useState({ x: -2.0, y: 1.7 });
  const [trail, setTrail] = useState([]);
  const [lr, setLr] = useState(0.12);
  const [running, setRunning] = useState(false);
  const dragRef = useRef(null);
  const timer = useRef(null);
  const st = useRef({ ball, lr });
  st.current = { ball, lr };

  useEffect(() => () => clearInterval(timer.current), []);

  // 3-D → 2-D projection
  const project = useMemo(() => {
    const ca = Math.cos(rot.a), sa = Math.sin(rot.a);
    const ce = Math.cos(rot.e), se = Math.sin(rot.e);
    return (x, y, z) => {
      const rx = x * ca - y * sa;
      const ry = x * sa + y * ca;
      const sx = W / 2 + rx * 88;
      const sy = H / 2 + ry * 88 * se - z * 62 * ce;
      return [sx, sy, ry]; // ry = depth for painter's sort
    };
  }, [rot]);

  const quads = useMemo(() => {
    const step = (SPAN * 2) / N;
    const out = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x0 = -SPAN + i * step, y0 = -SPAN + j * step;
        const x1 = x0 + step, y1 = y0 + step;
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => {
          const z = lossFn(x, y);
          const [sx, sy, d] = project(x, y, z);
          return { sx, sy, d, z };
        });
        const avgZ = corners.reduce((s, c) => s + c.z, 0) / 4;
        const depth = corners.reduce((s, c) => s + c.d, 0) / 4;
        out.push({ pts: corners.map((c) => `${c.sx.toFixed(1)},${c.sy.toFixed(1)}`).join(' '), avgZ, depth });
      }
    }
    return out.sort((a, b) => a.depth - b.depth); // painter's algorithm
  }, [project]);

  const zMin = 0.2, zMax = 5.2;
  const shade = (z) => {
    const t = Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin)));
    // deep teal valleys → warm coral peaks
    const r = Math.round(18 + t * 220);
    const g = Math.round(150 - t * 66);
    const b = Math.round(190 - t * 120);
    return `rgb(${r},${g},${b})`;
  };

  const descend = () => {
    if (running) { clearInterval(timer.current); setRunning(false); return; }
    setRunning(true);
    setTrail([]);
    timer.current = setInterval(() => {
      const { ball: b, lr: L } = st.current;
      const [gx, gy] = gradFn(b.x, b.y);
      const nx = Math.max(-SPAN, Math.min(SPAN, b.x - L * gx));
      const ny = Math.max(-SPAN, Math.min(SPAN, b.y - L * gy));
      setTrail((t) => [...t.slice(-60), b]);
      setBall({ x: nx, y: ny });
      if (Math.hypot(nx - b.x, ny - b.y) < 0.0015) { clearInterval(timer.current); setRunning(false); }
    }, 110);
  };

  // orbit controls
  const onDown = (e) => { dragRef.current = { sx: e.clientX, sy: e.clientY, a: rot.a, e: rot.e }; };
  useEffect(() => {
    const move = (ev) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      setRot({
        a: d.a + (ev.clientX - d.sx) * 0.008,
        e: Math.max(0.12, Math.min(1.25, d.e + (ev.clientY - d.sy) * 0.005)),
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const bz = lossFn(ball.x, ball.y);
  const [bsx, bsy] = project(ball.x, ball.y, bz);
  const [gx, gy] = gradFn(ball.x, ball.y);

  return (
    <div className="block-frame">
      <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown}
        style={{ cursor: 'grab', touchAction: 'none' }} role="img" aria-label="3D loss surface — drag to orbit">
        {quads.map((q, i) => (
          <polygon key={i} points={q.pts} fill={shade(q.avgZ)} stroke={shade(q.avgZ)} strokeWidth="0.5"
            opacity="0.92" />
        ))}
        {/* descent trail */}
        {trail.map((t, i) => {
          const [tx, ty] = project(t.x, t.y, lossFn(t.x, t.y) + 0.05);
          return <circle key={i} cx={tx} cy={ty} r="2.6" fill="#ffd97a" opacity={(i + 1) / trail.length * 0.85} />;
        })}
        {/* the ball */}
        <circle cx={bsx} cy={bsy - 6} r="8" fill="#ffce6b" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
        <text x={14} y={24} fill="#9db8c6" fontSize="12">drag to orbit ⟳</text>
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={descend}>{running ? '❚❚ Pause' : '▶ Descend the surface'}</button>
        <button className="btn btn--ghost" onClick={() => { clearInterval(timer.current); setRunning(false); setBall({ x: -2.0, y: 1.7 }); setTrail([]); }}>Reset</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.02" max="0.5" step="0.01" value={lr} onChange={(e) => setLr(+e.target.value)} /></label>
        <div className="stepper-msg">
          position <b>({ball.x.toFixed(2)}, {ball.y.toFixed(2)})</b> · loss <b>{bz.toFixed(3)}</b> ·
          gradient <b>({gx.toFixed(2)}, {gy.toFixed(2)})</b>
        </div>
      </div>
      <p className="block-hint">
        This is what a loss landscape really looks like in 3-D: <b style={{ color: '#2ee6ff' }}>teal valleys</b> are low loss,
        <b style={{ color: '#e05a44' }}> warm ridges</b> are high. Gradient descent always steps downhill along the steepest
        direction — orbit the surface and watch the ball find a basin. Raise the learning rate until it starts skipping over ridges.
      </p>
    </div>
  );
}
