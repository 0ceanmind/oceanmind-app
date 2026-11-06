/**
 * The pitch-demo director: a tiny state machine that walks chapters → beats,
 * one beat per presenter press. It knows nothing about the DOM; the driver
 * toolkit (drivers.js) is handed to every beat as `ctx` via makeCtx().
 *
 * Rules the show depends on:
 *  - A press while something runs queues exactly one advance.
 *  - A beat that throws, times out or is aborted never freezes the show: it
 *    is logged, the pointer moves past it, and the next press continues.
 *  - Every task gets its own AbortController; jump/back/restart/Escape abort
 *    it, and a stale task can never write over the state of a newer one.
 *  - The pointer lives in sessionStorage, so a refresh resumes at the start
 *    of the current chapter (its enter() runs again).
 */
import {
  DemoTimeoutError, isAbortError, raceAbort, stepTempo, store, TEMPOS, now,
  focusRegistry, isEditable,
} from './runtime.js';

const DEFAULT_TIMEOUT = { beat: 120000, enter: 60000, undo: 30000 };
const RESTART_WINDOW_MS = 1500;
const STATUS_FOR = { beat: 'running', enter: 'entering', undo: 'undoing' };

export function createDirector({ chapters = [], makeCtx, onRestart, storage = store, logger = console } = {}) {
  const savedTempo = storage.get('tempo', 1);
  const state = {
    chapter: 0, // pointer: the next beat to run is chapters[chapter].beats[beat]
    beat: 0,
    status: 'ready', // ready | running | entering | undoing | error | aborted | done | restarting
    task: null, // { kind, chapter, beat, title, startedAt } while something runs
    queued: 0,
    tempo: TEMPOS.includes(savedTempo) ? savedTempo : 1,
    hud: storage.get('hud', false) === true,
    lastError: null, // { message, where, at }
    lastDone: null, // { title, ms, outcome }
    restartArmed: false,
    lines: [], // recent log lines for the HUD
  };
  let snapshot = { ...state };
  const listeners = new Set();
  let current = null; // { token, controller, kind }
  let restartArmedAt = 0;
  let resumed = false;

  /* ------------------------------------------------------------ store */

  function set(patch) {
    Object.assign(state, patch);
    snapshot = { ...state };
    for (const fn of listeners) {
      try { fn(); } catch { /* a HUD bug must not stop the show */ }
    }
  }
  const getState = () => snapshot;
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function log(message, level = 'info') {
    const line = { at: Date.now(), level, message: String(message) };
    set({ lines: [...state.lines, line].slice(-40) });
    const out = level === 'error' ? logger?.error : level === 'warn' ? logger?.warn : logger?.info;
    out?.call(logger, `[demo] ${line.message}`);
  }

  /* ---------------------------------------------------------- pointer */

  const beatsOf = (c) => chapters[c]?.beats ?? [];

  /** Skip past the end of a chapter (and empty chapters). chapter === chapters.length means done. */
  function normalize(c, b) {
    let chapter = c;
    let beat = b;
    while (chapter < chapters.length && beat >= beatsOf(chapter).length) {
      chapter += 1;
      beat = 0;
    }
    return { chapter, beat };
  }

  function persist() {
    storage.set('pointer', { chapter: state.chapter, beat: state.beat });
  }

  /* ------------------------------------------------------------ tasks */

  async function runTask(kind, fn, meta) {
    const controller = new AbortController();
    const token = {};
    current = { token, controller, kind };
    set({ status: STATUS_FOR[kind], task: { kind, chapter: meta.chapter, beat: meta.beat, title: meta.title, startedAt: Date.now() } });
    const t0 = now();
    const limit = meta.timeout ?? DEFAULT_TIMEOUT[kind];
    const timer = setTimeout(() => {
      controller.abort(new DemoTimeoutError(`timed out after ${Math.round(limit / 1000)} s`));
    }, limit);
    let ctx = null;
    let outcome = 'ok';
    let error = null;
    try {
      ctx = makeCtx
        ? makeCtx({ signal: controller.signal, kind, chapter: meta.chapter, beat: meta.beat, title: meta.title })
        : { signal: controller.signal };
      const work = Promise.resolve().then(async () => {
        await ctx.appReady?.();
        return fn(ctx);
      });
      work.catch(() => {}); // it may settle after raceAbort gave up on it
      await raceAbort(work, controller.signal);
    } catch (e) {
      const reason = controller.signal.aborted ? controller.signal.reason : null;
      if (reason instanceof DemoTimeoutError) {
        outcome = 'error';
        error = reason;
      } else if (controller.signal.aborted || isAbortError(e)) {
        outcome = 'aborted';
        error = e;
      } else {
        outcome = 'error';
        error = e;
      }
    } finally {
      clearTimeout(timer);
      try { ctx?.dispose?.(); } catch { /* ignore */ }
    }
    const ms = Math.round(now() - t0);
    const stale = current?.token !== token;
    if (!stale) current = null;
    if (outcome === 'error') {
      const message = String(error?.message ?? error);
      log(`✗ ${meta.title}: ${message}`, 'error');
      if (error?.stack) logger?.error?.(error);
      set({ lastError: { message, where: meta.title, at: Date.now() } });
    } else if (outcome === 'aborted') {
      if (!stale) log(`■ aborted: ${meta.title}`, 'warn');
    } else {
      log(`✓ ${meta.title} (${(ms / 1000).toFixed(1)} s)`);
    }
    return { outcome, error, ms, stale };
  }

  function supersede(why) {
    if (!current) return;
    current.controller.abort(new DOMException(why, 'AbortError'));
    current = null;
  }

  /* ------------------------------------------------------------ beats */

  async function runBeat() {
    const { chapter, beat } = normalize(state.chapter, state.beat);
    if (chapter >= chapters.length) {
      set({ chapter, beat: 0, status: 'done', queued: 0, task: null });
      persist();
      log('the show is over — r r restarts it');
      return;
    }
    const def = beatsOf(chapter)[beat];
    const title = def.title ?? `Beat ${beat + 1}`;
    set({ chapter, beat });
    if (typeof def.run !== 'function') {
      log(`beat "${title}" has no run()`, 'warn');
    }
    const res = await runTask('beat', typeof def.run === 'function' ? def.run : () => {}, {
      chapter, beat, title, timeout: def.timeout,
    });
    if (res.stale) return;
    const nextPtr = normalize(chapter, beat + 1);
    const done = nextPtr.chapter >= chapters.length;
    set({
      ...nextPtr,
      task: null,
      lastDone: { title, ms: res.ms, outcome: res.outcome },
      status: res.outcome === 'ok' ? (done ? 'done' : 'ready') : res.outcome,
    });
    persist();
    if (res.outcome !== 'ok' || done) {
      set({ queued: 0 });
      return;
    }
    const upcoming = beatsOf(nextPtr.chapter)[nextPtr.beat];
    if (upcoming?.auto) {
      void runBeat(); // chained beat: runs without a press; a queued press stays queued
    } else if (state.queued > 0) {
      set({ queued: 0 });
      void runBeat();
    }
  }

  async function enterChapter(c, why) {
    const ch = chapters[c];
    set({ chapter: c, beat: 0, task: null });
    persist();
    if (typeof ch?.enter !== 'function') {
      log(`chapter ${c + 1} has no enter() — the app is left as it is`, 'warn');
      set({ status: 'ready' });
      return;
    }
    const res = await runTask('enter', ch.enter, { chapter: c, beat: 0, title: `enter ${c + 1}. ${ch.title ?? ''}`.trim(), timeout: ch.timeout });
    if (res.stale) return;
    set({ task: null, status: res.outcome === 'ok' ? 'ready' : res.outcome });
    if (res.outcome === 'ok' && state.queued > 0) {
      set({ queued: 0 });
      void runBeat();
    } else if (res.outcome !== 'ok') {
      set({ queued: 0 });
    }
    if (why === 'resume') log(`resumed at chapter ${c + 1}`);
  }

  /* ------------------------------------------------------ presenter API */

  /** Run the next beat, or queue one advance if something is running. */
  function next() {
    if (state.status === 'restarting') return;
    if (current) {
      if (state.queued === 0) set({ queued: 1 });
      return;
    }
    void runBeat();
  }

  /**
   * Step back. If the beat being undone (the running one, or the last one
   * that ran) has undo(), run it and point at that beat again. Otherwise
   * re-enter the chapter that beat belongs to.
   */
  async function back() {
    if (state.status === 'restarting') return;
    let target;
    if (current) {
      const t = state.task;
      const kind = current.kind;
      supersede('Superseded by back');
      set({ queued: 0 });
      if (kind !== 'beat' || !t) return enterChapter(t?.chapter ?? state.chapter, 'back');
      target = { chapter: t.chapter, beat: t.beat };
    } else if (state.beat > 0) {
      target = { chapter: state.chapter, beat: state.beat - 1 };
    } else {
      let c = state.chapter - 1;
      while (c >= 0 && beatsOf(c).length === 0) c -= 1;
      if (c < 0) {
        log('already at the start of the show');
        return;
      }
      target = { chapter: c, beat: beatsOf(c).length - 1 };
    }
    const def = beatsOf(target.chapter)[target.beat];
    if (typeof def?.undo === 'function') {
      set({ chapter: target.chapter, beat: target.beat });
      persist();
      const res = await runTask('undo', def.undo, {
        chapter: target.chapter, beat: target.beat, title: `undo ${def.title ?? ''}`.trim(), timeout: def.undoTimeout,
      });
      if (res.stale) return;
      set({ task: null, status: res.outcome === 'ok' ? 'ready' : res.outcome });
      return;
    }
    return enterChapter(target.chapter, 'back');
  }

  /** Jump to chapter index c (0-based): abort whatever runs, run its enter(). */
  async function jump(c) {
    if (state.status === 'restarting') return;
    if (!Number.isInteger(c) || c < 0 || c >= chapters.length) return;
    supersede('Superseded by a jump');
    set({ queued: 0, lastError: null });
    log(`jump to chapter ${c + 1}`);
    return enterChapter(c, 'jump');
  }

  /** Escape: stop the running task. The pointer moves past an aborted beat. */
  function abort() {
    if (!current) return false;
    set({ queued: 0 });
    current.controller.abort(new DOMException('Aborted by the presenter', 'AbortError'));
    return true;
  }

  /** 'r' pressed: the second press within 1.5 s restarts the whole show. */
  function restartGesture() {
    const t = now();
    if (restartArmedAt && t - restartArmedAt <= RESTART_WINDOW_MS) {
      restartArmedAt = 0;
      set({ restartArmed: false });
      return restart();
    }
    restartArmedAt = t;
    set({ restartArmed: true });
    setTimeout(() => {
      if (restartArmedAt === t) {
        restartArmedAt = 0;
        set({ restartArmed: false });
      }
    }, RESTART_WINDOW_MS + 30);
    return undefined;
  }

  async function restart() {
    supersede('Restart');
    set({ status: 'restarting', queued: 0, chapter: 0, beat: 0, task: null, lastError: null });
    storage.remove('pointer');
    storage.remove('memo');
    log('restarting the show');
    try {
      await onRestart?.();
    } catch (e) {
      log(`restart failed: ${e?.message ?? e}`, 'error');
      set({ status: 'error' });
    }
  }

  function setTempo(t) {
    const v = TEMPOS.includes(t) ? t : 1;
    set({ tempo: v });
    storage.set('tempo', v);
  }
  const tempoStep = (dir) => setTempo(stepTempo(state.tempo, dir));

  function toggleHud(force) {
    const hud = typeof force === 'boolean' ? force : !state.hud;
    set({ hud });
    storage.set('hud', hud);
  }

  /**
   * Rehearsal helper: run fn(ctx) with the full toolkit as a one-off task,
   * without moving the pointer. From the console: __omDirector.try(c => c.click('@nav-logbook')).
   * Resolves { outcome, error, ms, result }.
   */
  async function tryTask(fn, title = 'ad-hoc') {
    if (current) return { outcome: 'busy', error: new Error('the director is busy'), ms: 0 };
    const before = state.status;
    let result;
    const res = await runTask('beat', async (ctx) => {
      result = await fn(ctx);
    }, { chapter: state.chapter, beat: state.beat, title });
    if (!res.stale) set({ task: null, status: res.outcome === 'ok' ? before : res.outcome });
    return { ...res, result };
  }

  /** After a reload: re-enter the chapter the show was in. Runs once per page load. */
  async function resume() {
    if (resumed) return;
    resumed = true;
    const saved = storage.get('pointer', null);
    if (!saved || !Number.isInteger(saved.chapter)) return;
    const c = Math.max(0, Math.min(chapters.length, saved.chapter));
    const b = Number.isInteger(saved.beat) ? saved.beat : 0;
    if (c === 0 && b === 0) return; // nothing ran yet: the natural start state
    if (c >= chapters.length) {
      set({ chapter: c, beat: 0, status: 'done' });
      return;
    }
    await enterChapter(c, 'resume');
  }

  return {
    chapters,
    getState,
    subscribe,
    log,
    next,
    back,
    jump,
    abort,
    restart,
    restartGesture,
    setTempo,
    tempoStep,
    toggleHud,
    resume,
    try: tryTask,
    isBusy: () => !!current,
  };
}

/* ------------------------------------------------------------------ keys */

// Clickers send these. Next: → PageDown Space ↓ Enter. Back: ← PageUp ↑.
const NEXT_KEYS = new Set(['ArrowRight', 'PageDown', ' ', 'Spacebar', 'ArrowDown', 'Enter']);
const BACK_KEYS = new Set(['ArrowLeft', 'PageUp', 'ArrowUp']);

/** Map a keyboard event (or {key}) to a director action, or null. */
export function keyAction(e) {
  const k = e.key;
  if (NEXT_KEYS.has(k)) return { type: 'next' };
  if (BACK_KEYS.has(k)) return { type: 'back' };
  if (k === 'Escape' || k === 'Esc') return { type: 'abort' };
  if (k === 'h' || k === 'H') return { type: 'hud' };
  if (k === 'r' || k === 'R') return { type: 'restart' };
  if (k === '+' || k === '=' || k === 'Add') return { type: 'tempo', dir: 1 };
  if (k === '-' || k === '_' || k === 'Subtract') return { type: 'tempo', dir: -1 };
  if (/^[1-9]$/.test(k)) return { type: 'jump', chapter: Number(k) - 1 };
  return null;
}

export function perform(director, action) {
  switch (action.type) {
    case 'next': return director.next();
    case 'back': return director.back();
    case 'abort': return director.abort();
    case 'hud': return director.toggleHud();
    case 'restart': return director.restartGesture();
    case 'tempo': return director.tempoStep(action.dir);
    case 'jump': return director.jump(action.chapter);
    default: return undefined;
  }
}

/** A trusted click or Tab this recently before a focus change means a person moved the caret. */
const USER_INTENT_MS = 800;

/**
 * Listen at window capture phase (before React and every component). Only the
 * presenter keys are swallowed, only for real (trusted) presses, and never
 * while a person is typing into a field they focused themselves. A field
 * focused by the app (autoFocus) or by the director doesn't count: the
 * clicker keeps driving the show.
 */
export function bindKeys(director, { target = window } = {}) {
  const swallowed = new Set();
  let intentAt = -Infinity;
  const onKeyDown = (e) => {
    if (!e.isTrusted) return; // the director's own synthetic key events
    if (e.key === 'Tab') intentAt = now();
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const action = keyAction(e);
    if (!action) return;
    const active = document.activeElement;
    if (isEditable(active) && active === focusRegistry.user) return; // a person is typing
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowed.add(e.code || e.key);
    if (e.repeat) return; // a held clicker button is one press
    perform(director, action);
  };
  const onKeyUp = (e) => {
    if (!e.isTrusted) return;
    const k = e.code || e.key;
    if (!swallowed.has(k)) return;
    swallowed.delete(k);
    e.preventDefault(); // Space/Enter on a focused button would otherwise click it on keyup
    e.stopImmediatePropagation();
  };
  // a real click (or Tab) into a field hands the keyboard back to the person
  const onPointerDown = (e) => {
    if (!e.isTrusted) return;
    intentAt = now();
    const el = e.target?.closest?.('input, textarea, select, [contenteditable]');
    if (el && isEditable(el) && el === document.activeElement) focusRegistry.user = el;
  };
  const onFocusIn = (e) => {
    if (now() - intentAt <= USER_INTENT_MS) {
      focusRegistry.user = e.target;
    } else if (e.target !== focusRegistry.user) {
      focusRegistry.user = null; // autoFocus or the director moved the caret
    }
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('keyup', onKeyUp, true);
  target.addEventListener('pointerdown', onPointerDown, true);
  target.addEventListener('focusin', onFocusIn, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('keyup', onKeyUp, true);
    target.removeEventListener('pointerdown', onPointerDown, true);
    target.removeEventListener('focusin', onFocusIn, true);
  };
}
