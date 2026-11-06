import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ease, prefersReducedMotion, tween } from '../../lib/motion.js';
import './nn-b.css';

/**
 * A real 3-D loss surface you can orbit with the mouse, with a ball performing
 * gradient descent across it and leaving a trail. Rendered as depth-sorted SVG
 * quads (no WebGL dependency), shaded by height — covers "gradient and Hessian"
 * and gradient-descent optimization from the source deck.
 *
 * At rest the camera orbits slowly; it eases to a stop while you drag or the
 * ball descends, and picks up again a moment later. All motion runs on a
 * setTimeout clock (not rAF) so it behaves the same in a background window.
 */
const N = 22;               // grid resolution
const SPAN = 2.6;           // world extent in x/y
const W = 640, H = 380;
const START = { x: -2.0, y: 1.7 };
const STEP_MS = 110;        // one gradient step
const MAX_STEPS = 140;      // a too-high learning rate never settles: give up after this many steps
const TRAIL = 60;
const ORBIT_SPEED = 0.18;   // rad/s of idle auto-orbit
const ORBIT_TICK = 33;      // ms (~30 fps is plenty for a slow orbit)
const RESUME_AFTER_DRAG = 1500;
const RESUME_AFTER_DESCENT = 1200;

// A bowl with a saddle-ish ripple: interesting but well-behaved. Its single
// minimum sits at (-0.58, 0) with loss 0.893.
const lossFn = (x, y) => 0.45 * (x * x + y * y) + 0.55 * Math.sin(1.7 * x) * Math.cos(1.7 * y) + 1.2;
const gradFn = (x, y) => [
  0.9 * x + 0.935 * Math.cos(1.7 * x) * Math.cos(1.7 * y),
  0.9 * y - 0.935 * Math.sin(1.7 * x) * Math.sin(1.7 * y),
];

const zMin = 0.2, zMax = 5.2;
const shade = (z) => {
  const t = Math.max(0, Math.min(1, (z - zMin) / (zMax - zMin)));
  // deep teal valleys → warm coral peaks
  const r = Math.round(18 + t * 220);
  const g = Math.round(150 - t * 66);
  const b = Math.round(190 - t * 120);
  return `rgb(${r},${g},${b})`;
};

// The surface itself never changes, only the camera: sample it once.
const GSTEP = (SPAN * 2) / N;
const GRID = Array.from({ length: N + 1 }, (_, i) => Array.from({ length: N + 1 }, (_, j) => {
  const x = -SPAN + i * GSTEP, y = -SPAN + j * GSTEP;
  return [x, y, lossFn(x, y)];
}));
const QUADS = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const avgZ = (GRID[i][j][2] + GRID[i + 1][j][2] + GRID[i + 1][j + 1][2] + GRID[i][j + 1][2]) / 4;
    QUADS.push({ i, j, fill: shade(avgZ) });
  }
}

// 3-D → 2-D projection for a camera at azimuth a, elevation e. The scale keeps
// the original height/width ratio (62/88) but fits the whole surface, rim and
// all, inside the frame at the default elevation for every azimuth (the old
// 88/62 scale drew y from -373 to 185, so the rim and the ball's starting
// point sat above the top edge and the lower half of the frame was empty).
const XY_SCALE = 58, Z_SCALE = 41, Y_SHIFT = 186;
function makeProjector({ a, e }) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const ce = Math.cos(e), se = Math.sin(e);
  return (x, y, z) => {
    const rx = x * ca - y * sa;
    const ry = x * sa + y * ca;
    const sx = W / 2 + rx * XY_SCALE;
    const sy = H / 2 + Y_SHIFT + ry * XY_SCALE * se - z * Z_SCALE * ce;
    return [sx, sy, ry]; // ry = depth for painter's sort
  };
}

// Memoised so the gliding ball and its trail never re-diff the 484 polygons;
// only a camera move does. Each frame projects the 529 grid vertices once.
const Surface = memo(function Surface({ rot }) {
  const polys = useMemo(() => {
    const project = makeProjector(rot);
    const P = GRID.map((row) => row.map(([x, y, z]) => project(x, y, z)));
    const out = QUADS.map(({ i, j, fill }) => {
      const c = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]];
      return {
        pts: c.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
        depth: (c[0][2] + c[1][2] + c[2][2] + c[3][2]) / 4,
        fill,
      };
    });
    return out.sort((a, b) => a.depth - b.depth); // painter's algorithm
  }, [rot]);
  return (
    <g>
      {polys.map((q, i) => (
        <polygon key={i} points={q.pts} fill={q.fill} stroke={q.fill} strokeWidth="0.5" opacity="0.92" />
      ))}
    </g>
  );
});

/** True while the element is on screen (keeps the idle orbit from burning CPU off-screen). */
function useOnScreen(ref) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

export default function LossSurface3D() {
  const [rot, setRot] = useState({ a: 0.7, e: 0.62 }); // azimuth, elevation
  const [ball, setBall] = useState(START);   // where the maths says the ball is
  const [shown, setShown] = useState(START); // where it is drawn (glides between steps)
  const [trail, setTrail] = useState([]);
  const [ghost, setGhost] = useState(null);  // a retired trail { pts, id }, fading out
  const [lr, setLr] = useState(0.12);
  const [phase, setPhase] = useState('idle'); // idle · descending · paused · settled · bouncing
  const [steps, setSteps] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [finishKey, setFinishKey] = useState(0);

  const rootRef = useRef(null);
  const onScreen = useOnScreen(rootRef);
  const dragRef = useRef(null);
  const timer = useRef(null);
  const glide = useRef(null);
  const ghostTimer = useRef(null);
  const sim = useRef({ ball: START, steps: 0 });
  const shownRef = useRef(START);
  const lrRef = useRef(lr);
  lrRef.current = lr;
  const rotRef = useRef(rot);
  rotRef.current = rot;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const orbit = useRef({ speed: 0, resumeAt: 0 });

  useEffect(() => () => {
    clearInterval(timer.current);
    clearTimeout(ghostTimer.current);
    glide.current?.cancel();
  }, []);

  // idle auto-orbit: eases in, eases out while dragging/descending, resumes after
  useEffect(() => {
    if (!onScreen || prefersReducedMotion()) return undefined;
    let t;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const o = orbit.current;
      const want = !dragRef.current && phaseRef.current !== 'descending' && now >= o.resumeAt ? ORBIT_SPEED : 0;
      o.speed += (want - o.speed) * Math.min(1, dt * 3);
      if (o.speed > 0.002) setRot((r) => ({ a: r.a + o.speed * dt, e: r.e }));
      t = setTimeout(tick, ORBIT_TICK);
    };
    t = setTimeout(tick, ORBIT_TICK);
    return () => clearTimeout(t);
  }, [onScreen]);

  const moveShown = (to, duration) => {
    glide.current?.cancel();
    const from = shownRef.current;
    glide.current = tween({
      from: 0, to: 1, duration, easing: ease.linear,
      onUpdate: (k) => {
        const p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
        shownRef.current = p;
        setShown(p);
      },
    });
  };

  // the previous path fades out instead of vanishing
  const retireTrail = () => {
    if (trail.length) {
      setGhost({ pts: trail, id: performance.now() });
      clearTimeout(ghostTimer.current);
      ghostTimer.current = setTimeout(() => setGhost(null), 650);
    }
    setTrail([]);
  };

  const stop = (next) => {
    clearInterval(timer.current);
    timer.current = null;
    setPhase(next);
    orbit.current.resumeAt = performance.now() + RESUME_AFTER_DESCENT;
    if (next === 'settled' || next === 'bouncing') setFinishKey((k) => k + 1);
  };

  const run = () => {
    setPhase('descending');
    timer.current = setInterval(() => {
      const s = sim.current;
      const b = s.ball;
      const L = lrRef.current;
      const [gx, gy] = gradFn(b.x, b.y);
      const nx = Math.max(-SPAN, Math.min(SPAN, b.x - L * gx));
      const ny = Math.max(-SPAN, Math.min(SPAN, b.y - L * gy));
      const next = { x: nx, y: ny };
      s.ball = next;
      s.steps += 1;
      setTrail((t) => [...t.slice(-TRAIL), b]);
      setBall(next);
      setSteps(s.steps);
      moveShown(next, STEP_MS);
      if (Math.hypot(nx - b.x, ny - b.y) < 0.0015) stop('settled');
      else if (s.steps >= MAX_STEPS) stop('bouncing');
    }, STEP_MS);
  };

  const backToStart = (duration) => {
    sim.current = { ball: START, steps: 0 };
    setBall(START);
    setSteps(0);
    retireTrail();
    moveShown(START, duration);
  };

  const descend = () => {
    if (phase === 'descending') { stop('paused'); return; }
    // a finished descent restarts from the top so it can be replayed (e.g. at a new learning rate)
    if (phase === 'settled' || phase === 'bouncing') backToStart(0);
    run();
  };

  const reset = () => {
    clearInterval(timer.current);
    timer.current = null;
    setPhase('idle');
    backToStart(450);
  };

  // orbit controls
  const onDown = (e) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, a: rotRef.current.a, e: rotRef.current.e };
    orbit.current.speed = 0;
    setDragging(true);
  };
  useEffect(() => {
    const move = (ev) => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      setRot({
        a: d.a + (ev.clientX - d.sx) * 0.008,
        e: Math.max(0.12, Math.min(1.25, d.e + (ev.clientY - d.sy) * 0.005)),
      });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      orbit.current.resumeAt = performance.now() + RESUME_AFTER_DRAG;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  const project = useMemo(() => makeProjector(rot), [rot]);
  const bz = lossFn(ball.x, ball.y);
  const [gx, gy] = gradFn(ball.x, ball.y);
  const [bsx, bsy] = project(shown.x, shown.y, lossFn(shown.x, shown.y));
  const onSurface = (p) => project(p.x, p.y, lossFn(p.x, p.y) + 0.05);
  const pathOf = (pts) => pts.map((p) => onSurface(p)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const running = phase === 'descending';
  const done = phase === 'settled' || phase === 'bouncing';

  return (
    <div className="block-frame" ref={rootRef} data-phase={phase} data-running={running} data-done={done} data-steps={steps}>
      <svg className={`viz-svg om-nnb-surface${dragging ? ' is-dragging' : ''}`} viewBox={`0 0 ${W} ${H}`} onPointerDown={onDown}
        data-demo="surface" role="img" aria-label="3D loss surface — drag to orbit">
        <Surface rot={rot} />
        {/* a retired trail fades out */}
        {ghost && (
          <g key={ghost.id} className="om-nnb-fade-out">
            {ghost.pts.length > 1 && <path d={pathOf(ghost.pts)} fill="none" stroke="#ffd97a" strokeWidth="1.6" opacity="0.45" />}
            {ghost.pts.map((t, i) => {
              const [tx, ty] = onSurface(t);
              return <circle key={i} cx={tx} cy={ty} r="2.6" fill="#ffd97a" opacity={((i + 1) / ghost.pts.length) * 0.85} />;
            })}
          </g>
        )}
        {/* descent trail: a line that follows the gliding ball, plus a dot per step, older = fainter */}
        {trail.length > 0 && (
          <path d={pathOf([...trail, shown])} fill="none" stroke="#ffd97a"
            strokeWidth="1.6" strokeLinejoin="round" opacity="0.45" />
        )}
        {trail.map((t, i) => {
          const [tx, ty] = onSurface(t);
          return <circle key={i} cx={tx} cy={ty} r="2.6" fill="#ffd97a" opacity={((i + 1) / trail.length) * 0.85} />;
        })}
        {/* the ball */}
        <circle cx={bsx} cy={bsy - 6} r="8" fill="#ffce6b" stroke="#0a2237" strokeWidth="2" className={running ? 'glow' : ''} />
        {done && (
          <circle key={finishKey} cx={bsx} cy={bsy - 6} r="10" stroke={phase === 'settled' ? '#35d0a5' : '#ff8a6b'}
            strokeWidth="2" className="om-nnb-ring" />
        )}
        <text x={14} y={24} fill="#9db8c6" fontSize="12">drag to orbit ⟳</text>
      </svg>
      <div className="stepper-row">
        <button className="btn btn--primary" onClick={descend} data-demo="descend">
          {running ? '❚❚ Pause' : done ? '↻ Descend again' : phase === 'paused' ? '▶ Resume' : '▶ Descend the surface'}
        </button>
        <button className="btn btn--ghost" onClick={reset} data-demo="reset">Reset</button>
        <label className="dial">learning rate <b>{lr.toFixed(2)}</b>
          <input type="range" min="0.02" max="1.2" step="0.01" value={lr} onChange={(e) => setLr(+e.target.value)} data-demo="lr" /></label>
        <div className="stepper-msg" data-demo="stat">
          position <b>({ball.x.toFixed(2)}, {ball.y.toFixed(2)})</b> · loss <b>{bz.toFixed(3)}</b> ·
          gradient <b>({gx.toFixed(2)}, {gy.toFixed(2)})</b>
        </div>
      </div>
      {phase === 'settled' && (
        <div key={`s${finishKey}`} className="stepper-msg om-nnb-callout" role="status" data-demo="callout">
          Settled in the valley after <b>{steps}</b> steps · loss <b>{bz.toFixed(3)}</b>. The gradient is ≈ 0 here, so
          every further step is too small to matter: that is what “converged” means.
        </div>
      )}
      {phase === 'bouncing' && (
        <div key={`b${finishKey}`} className="stepper-msg om-nnb-callout is-warn" role="status" data-demo="callout">
          Still bouncing after <b>{steps}</b> steps. At learning rate <b>{lr.toFixed(2)}</b> each step overshoots the
          valley floor and lands on the opposite wall. Lower it below about 0.9 and descend again.
        </div>
      )}
      <p className="block-hint">
        This is what a loss landscape really looks like in 3-D: <b style={{ color: '#2ee6ff' }}>teal valleys</b> are low loss,
        <b style={{ color: '#e05a44' }}> warm ridges</b> are high. Gradient descent always steps downhill along the steepest
        direction — orbit the surface and watch the ball find the valley. Push the learning rate above about 0.9 and the
        steps overshoot: the ball ping-pongs across the valley and never settles.
      </p>
    </div>
  );
}
