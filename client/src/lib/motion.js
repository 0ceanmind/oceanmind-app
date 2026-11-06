/**
 * Shared motion helpers. Every block and view uses these instead of rolling
 * its own tween, so timing and easing stay consistent across the app.
 *
 * Clock: every tween runs on setTimeout + performance.now(), NOT
 * requestAnimationFrame. rAF stops completely in a hidden tab, and it runs
 * 2x faster on 120 Hz projector laptops; a time-based setTimeout clock does
 * neither.
 */
import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ demo */

/** True while the pitch-demo director is running (it stamps <html data-demo="1">). */
export function isDemo() {
  return typeof document !== 'undefined' && document.documentElement.dataset.demo === '1';
}

/**
 * Honour the OS "reduce motion" setting, except during the pitch demo, where
 * the presenter's laptop setting must never silently strip the show.
 */
export function prefersReducedMotion() {
  if (isDemo()) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ randomness */

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function seededRandom(seed) {
  let a = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic randomness in demo mode (every rehearsal looks identical and
 * converges the same way), real randomness otherwise.
 */
export function demoRandom(key) {
  return isDemo() ? seededRandom(`oceanmind:${key}`) : Math.random;
}

/* ---------------------------------------------------------------- easing */

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  /** matches the app's --ease cubic-bezier(0.32,0.72,0,1) closely */
  app: (t) => 1 - (1 - t) ** 4,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

/* ---------------------------------------------------------------- tweens */

const FRAME_MS = 16;

/**
 * Imperative tween on a setTimeout clock. Calls onUpdate(value, t) each frame
 * and resolves when finished. Returns { promise, cancel }.
 */
export function tween({ from = 0, to = 1, duration = 600, easing = ease.app, onUpdate, onDone }) {
  let cancelled = false;
  let timer = null;
  const start = performance.now();
  const promise = new Promise((resolve) => {
    const step = () => {
      if (cancelled) return resolve(false);
      const t = duration <= 0 ? 1 : Math.min(1, (performance.now() - start) / duration);
      onUpdate?.(from + (to - from) * easing(t), t);
      if (t >= 1) {
        onDone?.();
        return resolve(true);
      }
      timer = setTimeout(step, FRAME_MS);
    };
    step();
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}

/**
 * React hook: a number that glides to `target` whenever it changes.
 * Use it for stats, readouts and counters that would otherwise jump.
 */
export function useTweenedNumber(target, { duration = 500, easing = ease.app } = {}) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    if (prefersReducedMotion() || !Number.isFinite(current.current)) {
      current.current = target;
      setValue(target);
      return undefined;
    }
    const t = tween({
      from: current.current,
      to: target,
      duration,
      easing,
      onUpdate: (v) => {
        current.current = v;
        setValue(v);
      },
    });
    return () => t.cancel();
  }, [target, duration, easing]);
  return value;
}

/**
 * React hook: count from `from` up to `target` once `active` is true.
 * Used for the depth readout, which counts down with the diver.
 */
export function useCountUp(target, { active = true, duration = 2400, from = 0, easing = ease.inOutCubic } = {}) {
  const [value, setValue] = useState(active ? from : target);
  useEffect(() => {
    if (!active) return undefined;
    if (prefersReducedMotion()) {
      setValue(target);
      return undefined;
    }
    const t = tween({ from, to: target, duration, easing, onUpdate: setValue });
    return () => t.cancel();
  }, [target, active, duration, from, easing]);
  return value;
}

/**
 * React hook: reveals `text` character by character (a "streaming" reply).
 * Returns the visible slice. Instant when disabled or reduced motion.
 */
export function useTypewriter(text, { enabled = true, cps = 90, startDelay = 0 } = {}) {
  const [shown, setShown] = useState(enabled ? '' : text);
  useEffect(() => {
    if (!enabled || prefersReducedMotion() || !text) {
      setShown(text ?? '');
      return undefined;
    }
    let i = 0;
    let timer;
    const tick = () => {
      // reveal a few chars per tick so long replies still finish quickly
      i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30)));
      setShown(text.slice(0, i));
      if (i < text.length) timer = setTimeout(tick, 33);
    };
    setShown('');
    timer = setTimeout(tick, startDelay);
    return () => clearTimeout(timer);
  }, [text, enabled, cps, startDelay]);
  return shown;
}

/**
 * React hook: true once the element has been on screen. Unlike a bare
 * IntersectionObserver it also fires when the tab is hidden or the observer
 * never reports (presenting from a background window, headless capture).
 */
export function useInView(ref, { threshold = 0.12, fallbackMs = 400 } = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      setInView(true);
    };
    let io;
    try {
      io = new IntersectionObserver(([entry]) => entry.isIntersecting && fire(), { threshold });
      io.observe(el);
    } catch {
      fire();
    }
    const fallback = setTimeout(() => {
      if (document.hidden) return fire();
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) fire();
    }, fallbackMs);
    return () => {
      done = true;
      io?.disconnect();
      clearTimeout(fallback);
    };
  }, [ref, threshold, fallbackMs, inView]);
  return inView;
}

/** Promise-based sleep on the setTimeout clock. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
