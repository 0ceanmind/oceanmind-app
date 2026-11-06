import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useInView, tween, ease, prefersReducedMotion, demoRandom, isDemo } from '../lib/motion.js';

/* ---------------- icons (light-stroke, hand-inlined) ---------------- */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = {
  wave: (p) => (
    <svg width={p?.size ?? 20} height={p?.size ?? 20} viewBox="0 0 24 24" {...stroke}>
      <path d="M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 4-2.5 5-1.5" />
      <path d="M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0" opacity="0.55" />
    </svg>
  ),
  network: (p) => (
    <svg width={p?.size ?? 22} height={p?.size ?? 22} viewBox="0 0 24 24" {...stroke}>
      <circle cx="5" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" />
      <path d="M7 11l10-4M7 13l10 4" />
    </svg>
  ),
  agent: (p) => (
    <svg width={p?.size ?? 22} height={p?.size ?? 22} viewBox="0 0 24 24" {...stroke}>
      <rect x="6" y="7" width="12" height="10" rx="3" />
      <path d="M12 7V4M9 21v-4M15 21v-4" /><circle cx="10" cy="12" r="0.6" fill="currentColor" /><circle cx="14" cy="12" r="0.6" fill="currentColor" />
    </svg>
  ),
  chat: (p) => (
    <svg width={p?.size ?? 22} height={p?.size ?? 22} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9h7M8.5 12h4.5" opacity="0.6" />
    </svg>
  ),
  bell: (p) => (
    <svg width={p?.size ?? 18} height={p?.size ?? 18} viewBox="0 0 24 24" {...stroke}>
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10" />
      <path d="M10.3 19.5a2 2 0 0 0 3.4 0" />
    </svg>
  ),
  arrow: (p) => (
    <svg width={p?.size ?? 14} height={p?.size ?? 14} viewBox="0 0 24 24" {...stroke}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  ),
  diver: (p) => (
    <svg width={p?.size ?? 30} height={p?.size ?? 30} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="7" r="3" />
      <path d="M12 10v6M12 16l-3.5 4M12 16l3.5 4M8 12.5l8-1" />
    </svg>
  ),
};

/* ---------------- toasts ---------------- */

const ToastCtx = createContext(null);
const TOAST_MS = 4200;
const TOAST_EXIT_MS = 320; // matches .toast.om-leaving in motion.css

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((message, kind = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    // slide out for the last 320ms instead of blinking away
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), TOAST_MS - TOAST_EXIT_MS);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}${t.leaving ? ' om-leaving' : ''}`} data-demo="toast" data-kind={t.kind}>
            {t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'} {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ---------------- primitives ---------------- */

export function Card({ children, className = '', style }) {
  return (
    <div className={`shell ${className}`} style={style}>
      <div className="core">{children}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function EmptyState({ emoji = '🌊', children }) {
  return (
    <div className="empty">
      <span className="big">{emoji}</span>
      {children}
    </div>
  );
}

export function ModeBadge({ live }) {
  return live ? (
    <span className="badge badge--live" title="Powered by a live Claude model through the server">● Live AI</span>
  ) : (
    <span className="badge badge--sim" title="Runs fully offline — set ANTHROPIC_API_KEY on the server to go live">◌ Simulated</span>
  );
}

/* ---------------- modal ---------------- */

const ModalCloseCtx = createContext(null);
const MODAL_EXIT_MS = 260; // matches .modal-backdrop.om-v-leaving

/**
 * Modal with an exit animation. Esc, the backdrop and <ModalClose/> play the
 * exit before calling onClose; a caller that unmounts it directly still works
 * (it just closes instantly, as before).
 */
export function Modal({ onClose, children }) {
  const [leaving, setLeaving] = useState(false);
  const boxRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timer = useRef(null);

  const requestClose = useCallback(() => {
    if (timer.current) return;
    setLeaving(true);
    timer.current = setTimeout(() => onCloseRef.current(), MODAL_EXIT_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // Modals whose caller renders its own "Close" button still get the
  // data-demo="modal-close" hook the auto-pilot looks for.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || box.querySelector('[data-demo="modal-close"]')) return;
    const btn = [...box.querySelectorAll('button')].find((b) => /close/i.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`));
    if (btn && !btn.hasAttribute('data-demo')) btn.setAttribute('data-demo', 'modal-close');
  });

  return (
    <ModalCloseCtx.Provider value={requestClose}>
      <div className={`modal-backdrop${leaving ? ' om-v-leaving' : ''}`} data-demo="modal"
        onClick={(e) => e.target === e.currentTarget && requestClose()}>
        <div className="modal" ref={boxRef}>{children}</div>
      </div>
    </ModalCloseCtx.Provider>
  );
}

/** The standard "Close ✕" button for a Modal; plays the exit animation. */
export function ModalClose({ children = 'Close ✕', className = 'btn btn--ghost' }) {
  const close = useContext(ModalCloseCtx);
  return <button className={className} onClick={() => close?.()} data-demo="modal-close">{children}</button>;
}

/**
 * Scroll-entry reveal wrapper. useInView adds the safety net a bare observer
 * lacks: it also fires if the element is already on screen after 350ms, or
 * the tab is hidden, so content can never stay invisible.
 */
export function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref, { threshold: 0.12, fallbackMs: 350 });
  return (
    <div ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ---------------- staged agent progress ---------------- */

/**
 * Staged progress for work that is in flight: starting at `startAt`, advances
 * one stage every `stepMs` while `running` (a number, or a list: the 1st entry
 * is the wait before the 1st advance, and so on), parks on the last stage
 * until the work returns, then reports every stage done at once when `done`
 * flips. Returns the index of the current stage (count = all done).
 */
export function useStages(count, { running, done = false, startAt = 0, stepMs = 1200 }) {
  const [idx, setIdx] = useState(startAt);
  const stepRef = useRef(stepMs);
  stepRef.current = stepMs;
  useEffect(() => {
    if (running) setIdx(startAt);
  }, [running, startAt]);
  useEffect(() => {
    if (!running || done || idx >= count - 1) return undefined;
    const s = stepRef.current;
    const ms = Array.isArray(s) ? s[Math.max(0, Math.min(idx - startAt, s.length - 1))] : s;
    const t = setTimeout(() => setIdx((v) => Math.min(count - 1, v + 1)), ms);
    return () => clearTimeout(t);
  }, [running, done, idx, count, startAt]);
  return done ? count : idx;
}

/* ---------------- demo reply timing ---------------- */

// The demo server's scripted "thinking" time per AI task at speed 1, ±15%
// (mirrors LATENCY_MS in server/aireplay.js; /api/demo/status may send its own table).
const REPLAY_LATENCY_MS = {
  topic_match: 300, knowledge_map: 900, questions: 800, lesson: 1600, tutor_decide: 650, expand_steps: 1100,
  summary: 900, agent_step: 550, flow_node: 600, integration_guide: 900, chat: 650,
};
let replayTiming = { speed: 1, jitter: 0.15, table: REPLAY_LATENCY_MS };

/**
 * App.jsx hands over the /api/demo/status payload: `speed` (OCEANMIND_DEMO_SPEED),
 * and when the server publishes them `latency` (per-task base ms at speed 1)
 * and `jitter` (the ± fraction).
 */
export function setDemoTiming(status) {
  const speed = Number(status?.speed);
  const lat = status?.latency && typeof status.latency === 'object' ? status.latency : {};
  const table = { ...REPLAY_LATENCY_MS };
  for (const [k, v] of Object.entries(lat)) if (Number.isFinite(v) && v >= 0) table[k] = v;
  const jitter = Number(status?.jitter ?? lat.jitter);
  replayTiming = {
    speed: Number.isFinite(speed) && speed >= 0 ? speed : 1,
    jitter: Number.isFinite(jitter) && jitter >= 0 && jitter < 1 ? jitter : 0.15,
    table,
  };
}

/** Expected demo reply time (ms) of a request that runs these AI tasks in a row; null outside the demo. */
export function demoReplyMs(...tasks) {
  if (!isDemo()) return null;
  return tasks.reduce((sum, t) => sum + (replayTiming.table[t] ?? 600), 0) * replayTiming.speed;
}

/** The slowest a demo reply of that expected length should take (upper jitter bound). */
export function demoReplyMaxMs(expectMs) {
  return expectMs == null ? null : expectMs * (1 + replayTiming.jitter);
}

/**
 * Staged progress paced to the request it narrates.
 *
 * start({ startAt, expectMs }) shows stage `startAt` as "now". In the demo
 * (`expectMs` from demoReplyMs) the stages still to come are spread so each is
 * "now" for at least `minMs` and the last one is reached by the earliest
 * expected reply; it then parks until the reply lands. Without an expectation
 * (a real model) the `stepMs` cadence applies (a number, or a list: the 1st
 * entry is the wait before the 1st advance…) and the last stage parks.
 * retime(expectMs, { count }) re-plans from the current stage when a new
 * request starts (or the list grows). finish() resolves once every stage has
 * been seen, then all tick ✓: in the demo, stages the reply overtook flash
 * through within `flourishMs`; outside the demo everything ticks at once.
 * Returns { at, start, retime, finish, reset }; `at` = count when all done.
 */
export function usePacedStages(count, { stepMs = 1200, minMs = 300, flourishMs = 300 } = {}) {
  const [view, setView] = useState({ at: -1, done: false });
  const ref = useRef(null);
  if (!ref.current) ref.current = { timers: [], at: -1, since: 0, startAt: 0, count, waiters: [] };
  const r = ref.current;
  r.count = count;
  r.stepMs = stepMs;
  r.minMs = minMs;
  r.flourishMs = flourishMs;

  const ctl = useMemo(() => {
    const now = () => performance.now();
    const clear = () => {
      r.timers.forEach(clearTimeout);
      r.timers = [];
    };
    const later = (ms, fn) => r.timers.push(setTimeout(fn, Math.max(0, ms)));
    const show = (at) => {
      r.at = at;
      r.since = now();
      setView({ at, done: false });
    };
    const deadlineFor = (expectMs) => (expectMs == null ? null : now() + expectMs * (1 - replayTiming.jitter));
    const plan = (deadline) => {
      clear();
      const last = r.count - 1;
      if (r.at < 0 || r.at >= last) return;
      if (deadline == null) {
        // real model: fixed cadence from when the current stage appeared
        const step = () => {
          if (r.at >= r.count - 1) return;
          const s = r.stepMs;
          const k = r.at - r.startAt;
          const ms = Array.isArray(s) ? s[Math.max(0, Math.min(k, s.length - 1))] : s;
          later(ms - (now() - r.since), () => {
            show(r.at + 1);
            step();
          });
        };
        step();
        return;
      }
      const t = now();
      const base = r.at;
      const left = last - base;
      let slot = (deadline - r.since) / (left + 1);
      let first = r.since + slot;
      if (first < t) {
        first = t;
        slot = (deadline - t) / left;
      }
      slot = Math.max(r.minMs, slot);
      first = Math.max(first, r.since + r.minMs);
      for (let j = 1; j <= left; j += 1) later(first + (j - 1) * slot - t, () => show(base + j));
    };
    const settle = () => {
      r.at = r.count;
      setView({ at: r.count, done: true });
      const w = r.waiters;
      r.waiters = [];
      w.forEach((fn) => fn());
    };
    return {
      start({ startAt = 0, expectMs = null, park = false } = {}) {
        clear();
        r.startAt = startAt;
        show(startAt);
        if (!park) plan(deadlineFor(expectMs));
      },
      retime(expectMs = null, { count: nextCount } = {}) {
        if (nextCount) r.count = nextCount;
        if (r.at >= 0 && r.at < r.count) plan(deadlineFor(expectMs));
      },
      finish() {
        return new Promise((resolve) => {
          clear();
          r.waiters.push(resolve);
          if (!isDemo() || r.at < 0) {
            settle();
            return;
          }
          const t = now();
          const base = r.at;
          const rest = Math.max(0, r.count - 1 - base); // stages the reply overtook
          const own = Math.max(0, r.since + r.minMs - t); // what the current stage is still owed
          const total = own + rest * r.minMs;
          const k = total > r.flourishMs ? r.flourishMs / total : 1;
          let at = own * k;
          for (let j = 1; j <= rest; j += 1) {
            later(at, () => show(base + j));
            at += r.minMs * k;
          }
          later(at, settle);
        });
      },
      reset() {
        clear();
        r.at = -1;
        setView({ at: -1, done: false });
      },
    };
  }, [r]);

  useEffect(() => () => {
    r.timers.forEach(clearTimeout);
    r.timers = [];
    const w = r.waiters;
    r.waiters = [];
    w.forEach((fn) => fn());
  }, [r]);

  return { at: view.done ? count : Math.max(0, Math.min(view.at, count - 1)), ...ctl };
}

/** The agent checklist: done ✓ / now (spinning) / todo, entering one by one. */
export function Stages({ items, current, className = '' }) {
  return (
    <ol className={`om-stages om-v-stages ${className}`} data-current={Math.min(current, items.length)} data-done={current >= items.length}>
      {items.map((label, i) => (
        <li key={label} style={{ '--i': i }} className={i < current ? 'done' : i === current ? 'now' : 'todo'}>{label}</li>
      ))}
    </ol>
  );
}

/* ---------------- celebration ---------------- */

/** A one-off burst of rising bubbles (motion.css .om-burst); unmounts itself. */
export function BubbleBurst({ count = 28, seed = 'burst', lifetime = 5200 }) {
  const [on, setOn] = useState(true);
  const bubbles = useMemo(() => {
    const rand = demoRandom(`bubbles:${seed}`);
    return Array.from({ length: count }, () => ({
      x: 3 + rand() * 94,
      s: 6 + rand() * 16,
      d: 2.4 + rand() * 1.8,
      delay: rand() * 0.9,
      drift: (rand() - 0.5) * 90,
    }));
  }, [count, seed]);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), lifetime);
    return () => clearTimeout(t);
  }, [lifetime]);
  if (!on || prefersReducedMotion()) return null;
  return (
    <div className="om-burst" aria-hidden="true" data-demo="burst">
      {bubbles.map((b, i) => (
        <span key={i} style={{ '--x': `${b.x}%`, '--s': `${b.s}px`, '--d': `${b.d}s`, '--delay': `${b.delay}s`, '--drift': `${b.drift}px` }} />
      ))}
    </div>
  );
}

/* ---------------- accordion ---------------- */

export function Accordion({ title, chip, chipClass, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`acc ${open ? 'open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {chip && <span className={`chip ${chipClass}`}>{chip}</span>}
        <b>{title}</b>
        <span className="chev">▶</span>
      </button>
      <div className="acc-body">
        <div className="acc-body-inner">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- markdown-lite (safe: builds elements, no HTML injection) ---------------- */

function inlineMd(text, keyBase) {
  // **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${keyBase}-${i}`}>{p.slice(1, -1)}</code>;
    return p;
  });
}

/**
 * Renders LLM-written lesson text: paragraphs, "- " bullets, **bold**, `code`.
 * `stagger` lets the paragraphs enter one after another (lesson bodies).
 */
export function Md({ text, stagger = false }) {
  if (!text) return null;
  const blocks = String(text).split(/\n\s*\n/);
  return (
    <div className={`md${stagger ? ' om-stagger' : ''}`}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => l.startsWith('- ') || l.startsWith('* '));
        const style = stagger ? { '--i': bi } : undefined;
        if (isList) {
          return (
            <ul key={bi} style={style}>
              {lines.map((l, li) => <li key={li}>{inlineMd(l.replace(/^[-*]\s+/, ''), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return <p key={bi} style={style}>{inlineMd(lines.join(' '), `${bi}`)}</p>;
      })}
    </div>
  );
}

/* ---------------- faces ---------------- */

const FACES = [
  { rating: 1, label: 'Very unhappy', mouth: 'M8 16.5c1.2-1.6 2.6-2.4 4-2.4s2.8.8 4 2.4', brows: true },
  { rating: 2, label: 'Unhappy', mouth: 'M8.5 16c1-1 2.2-1.5 3.5-1.5s2.5.5 3.5 1.5' },
  { rating: 3, label: 'Neutral', mouth: 'M8.5 15.5h7' },
  { rating: 4, label: 'Happy', mouth: 'M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5' },
  { rating: 5, label: 'Very happy', mouth: 'M8 14c1.2 1.8 2.6 2.6 4 2.6s2.8-.8 4-2.6' },
];

export function FaceRating({ value, onChange }) {
  return (
    <div className="faces" role="radiogroup" aria-label="Rate your experience">
      {FACES.map((f) => (
        <button
          key={f.rating}
          className={`face ${value === f.rating ? 'picked' : ''}`}
          onClick={() => onChange(f.rating)}
          role="radio"
          aria-checked={value === f.rating}
          aria-label={f.label}
          title={f.label}
          data-demo="face"
          data-rating={f.rating}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none"
            stroke={value === f.rating ? '#7fd8e8' : '#5d7a8c'} strokeWidth="1.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <circle cx="9" cy="10" r="0.7" fill="currentColor" stroke="none" style={{ color: value === f.rating ? '#7fd8e8' : '#5d7a8c' }} />
            <circle cx="15" cy="10" r="0.7" fill="currentColor" stroke="none" style={{ color: value === f.rating ? '#7fd8e8' : '#5d7a8c' }} />
            <path d={f.mouth} />
          </svg>
        </button>
      ))}
    </div>
  );
}

/* ---------------- depth gauge ---------------- */

const GAUGE_MAX = 4000;
export const DIVE_MS = 2600;
// Zone boundaries on the gauge: [depth in m, fraction of the gauge height].
const ZONE_EDGES = [[0, 0], [200, 0.3], [1000, 0.65]];

// Non-linear pixel mapping so the shallow zones stay visible.
function depthToPct(d) {
  const zones = [
    { from: 0, to: 200, px: 0.3 },
    { from: 200, to: 1000, px: 0.35 },
    { from: 1000, to: 4000, px: 0.35 },
  ];
  let pct = 0;
  for (const z of zones) {
    if (d <= z.from) break;
    const covered = Math.min(d, z.to) - z.from;
    pct += (covered / (z.to - z.from)) * z.px;
  }
  return Math.min(0.97, Math.max(0.03, pct));
}

/**
 * The depth the readout shows while the diver is at `pct`: exact at every
 * zone line (so it reads 200 / 1,000 as the diver crosses them), and landing
 * exactly on the learner's depth when the diver stops.
 */
function readoutAt(pct, depth, targetPct) {
  let base = ZONE_EDGES[0];
  for (const e of ZONE_EDGES) if (depth > e[0]) base = e;
  if (pct <= base[1]) {
    // inside a zone above the target zone: invert the gauge mapping
    let prev = ZONE_EDGES[0];
    for (const e of ZONE_EDGES.slice(1)) {
      if (pct <= e[1]) return prev[0] + ((pct - prev[1]) / (e[1] - prev[1])) * (e[0] - prev[0]);
      prev = e;
    }
    return prev[0];
  }
  const span = targetPct - base[1];
  return base[0] + (span > 0 ? Math.min(1, (pct - base[1]) / span) : 1) * (depth - base[0]);
}

/**
 * Drives the dive on a setTimeout clock (hidden-window and 120 Hz safe):
 * the diver's position and the metres readout come from the same tween, so
 * the number and the diver can never drift apart.
 * Returns { pct, meters, done }.
 */
export function useDive(depth, { animate = true, duration = DIVE_MS, delay = 150 } = {}) {
  const target = depthToPct(depth);
  const still = !animate || prefersReducedMotion();
  const [state, setState] = useState(() => (still ? { pct: target, meters: depth, done: true } : { pct: 0, meters: 0, done: false }));
  useEffect(() => {
    if (still) {
      setState({ pct: target, meters: depth, done: true });
      return undefined;
    }
    setState({ pct: 0, meters: 0, done: false });
    let tw = null;
    const t = setTimeout(() => {
      tw = tween({
        from: 0,
        to: target,
        duration,
        easing: ease.inOutCubic,
        onUpdate: (p) => setState({ pct: p, meters: readoutAt(p, depth, target), done: false }),
        onDone: () => setState({ pct: target, meters: depth, done: true }),
      });
    }, delay);
    return () => {
      clearTimeout(t);
      tw?.cancel();
    };
  }, [depth, target, still, duration, delay]);
  return state;
}

/**
 * The depth gauge. Pass `dive` (from useDive) to share one dive with a
 * readout; otherwise it runs its own.
 */
export function DepthGauge({ depth, zoneLabel, animate = true, dive }) {
  const own = useDive(depth, { animate: animate && !dive });
  const d = dive ?? own;
  const pos = Math.max(0.03, d.pct);
  const lines = [
    { top: '0%', label: 'Sunlight · 0 m', at: 0 },
    { top: '30%', label: 'Twilight · 200 m', at: 0.3 },
    { top: '65%', label: 'Midnight · 1,000 m', at: 0.65 },
  ];
  return (
    <div className="gauge" aria-label={`Depth gauge: ${depth} meters, ${zoneLabel}`}>
      {lines.map((l) => (
        <div key={l.label} className={`gauge-zone${l.at > 0 && d.pct >= l.at ? ' om-v-hit' : ''}`} style={{ top: l.top }}>{l.label}</div>
      ))}
      <div className="gauge-zone" style={{ top: 'calc(100% - 22px)', borderTop: 'none' }}>4,000 m</div>
      <div className="gauge-diver" style={{ top: `${pos * 100}%`, color: '#7fd8e8' }}>
        <Icon.diver />
      </div>
      <div className="gauge-bubbles">
        {[18, 40, 62, 80].map((left, i) => (
          <span key={i} style={{ left: `${left}%`, animationDelay: `${i * 1.3}s` }} />
        ))}
      </div>
    </div>
  );
}

export { GAUGE_MAX };
