/**
 * Small shared helpers for the pitch-demo director: abort-aware timing,
 * safe storage, selector shorthand, slider maths. No DOM access at import
 * time and no React, so the engine logic can be unit-checked under Node.
 */

/* ------------------------------------------------------------ errors */

/** Thrown when a find/waitFor (or a whole beat) runs out of time. */
export class DemoTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoTimeoutError';
  }
}

/** The error an aborted await rejects with (the signal's reason when it is an Error). */
export function abortError(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  return new DOMException('Aborted', 'AbortError');
}

export function isAbortError(e) {
  return e?.name === 'AbortError';
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

/* ------------------------------------------------------------ timing */

/** setTimeout sleep that rejects as soon as `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Settle with `promise`, or reject the moment `signal` aborts, whichever is
 * first. This is what keeps a beat that ignores its signal from freezing the show.
 */
export function raceAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); }
    );
  });
}

export const now = () => performance.now();

/* ------------------------------------------------------------ tempo */

export const TEMPOS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Next tempo up (dir = +1) or down (dir = -1) from `t`, clamped to TEMPOS. */
export function stepTempo(t, dir) {
  let i = TEMPOS.findIndex((x) => Math.abs(x - t) < 1e-6);
  if (i < 0) i = TEMPOS.indexOf(1);
  return TEMPOS[Math.max(0, Math.min(TEMPOS.length - 1, i + dir))];
}

/* ------------------------------------------------------------ storage */

// sessionStorage survives an accidental refresh but not a new tab, which is
// exactly the scope of one pitch. Every access is guarded (private mode, tests).
export const PREFIX = 'om-demo';

export const store = {
  get(key, fallback = null) {
    try {
      const raw = sessionStorage.getItem(`${PREFIX}-${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(`${PREFIX}-${key}`, JSON.stringify(value));
    } catch { /* full or blocked */ }
  },
  remove(key) {
    try { sessionStorage.removeItem(`${PREFIX}-${key}`); } catch { /* ignore */ }
  },
};

/** Remove every om-demo* key from sessionStorage and localStorage (full restart). */
export function clearDemoStorage() {
  for (const area of ['sessionStorage', 'localStorage']) {
    try {
      const s = globalThis[area];
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k && k.startsWith(PREFIX)) s.removeItem(k);
      }
    } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------ selectors */

/**
 * '@ask-input' → '[data-demo="ask-input"]'. Works anywhere a compound
 * selector can start: '@quiz-option[data-idx="2"]', '[data-block="memory"] @slider',
 * '@signin-name, #si-name'. An '@' inside a word or attribute value is untouched.
 */
export function expandSelector(sel) {
  return String(sel).replace(/(^|[\s>+~,(])@([A-Za-z][\w-]*)/g, '$1[data-demo="$2"]');
}

/** Lowercase, collapse whitespace, trim: how text= targets are compared. */
export function normText(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ------------------------------------------------------------ sliders */

export function decimalsOf(step) {
  if (!step || !Number.isFinite(step)) return 6;
  const s = String(step);
  if (s.includes('e-')) return Number(s.split('e-')[1]) || 6;
  return (s.split('.')[1] || '').length;
}

/** Snap v to the range's step grid (anchored at min), clamped to [min, max]. step 0 = 'any'. */
export function quantize(v, min, max, step) {
  let x = Math.max(min, Math.min(max, v));
  if (step > 0) x = min + Math.round((x - min) / step) * step;
  return Math.max(min, Math.min(max, x));
}

/** The string an <input type=range> would hold for v at this step. */
export function formatStep(v, step) {
  if (!(step > 0)) return String(Math.round(v * 1e6) / 1e6);
  const d = decimalsOf(step);
  return String(Number(v.toFixed(d)));
}

/* ------------------------------------------------------------ focus */

/**
 * Who put the caret where.
 *  - el:   the field the director focused last (type()/clear()/click()).
 *  - user: the field a real person focused (a trusted click or Tab right
 *          before the focus moved). Presenter keys pass through to that field
 *          only, so a person can type; a field the app focused by itself
 *          (autoFocus on the sign-in and Home inputs) or the director focused
 *          keeps the clicker working.
 */
export const focusRegistry = { el: null, user: null };

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image', 'hidden']);

export function isEditable(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}
