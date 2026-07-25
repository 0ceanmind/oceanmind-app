import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

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

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((message, kind = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
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

export function Modal({ onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">{children}</div>
    </div>
  );
}

/** Scroll-entry reveal wrapper (IntersectionObserver). */
export function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && (setInView(true), io.disconnect()),
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
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

/** Renders LLM-written lesson text: paragraphs, "- " bullets, **bold**, `code`. */
export function Md({ text }) {
  if (!text) return null;
  const blocks = String(text).split(/\n\s*\n/);
  return (
    <div className="md">
      {blocks.map((block, bi) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => l.startsWith('- ') || l.startsWith('* '));
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => <li key={li}>{inlineMd(l.replace(/^[-*]\s+/, ''), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return <p key={bi}>{inlineMd(lines.join(' '), `${bi}`)}</p>;
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

export function DepthGauge({ depth, zoneLabel, animate = true }) {
  const [pos, setPos] = useState(animate ? 0.03 : depthToPct(depth));
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setPos(depthToPct(depth)), 150);
    return () => clearTimeout(t);
  }, [depth, animate]);
  return (
    <div className="gauge" aria-label={`Depth gauge: ${depth} meters, ${zoneLabel}`}>
      <div className="gauge-zone" style={{ top: '0%' }}>Sunlight · 0 m</div>
      <div className="gauge-zone" style={{ top: '30%' }}>Twilight · 200 m</div>
      <div className="gauge-zone" style={{ top: '65%' }}>Midnight · 1,000 m</div>
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
