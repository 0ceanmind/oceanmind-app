/**
 * The driver toolkit: what a beat uses to act on the real UI.
 *
 * There is no cursor on screen, so every action is made legible on the
 * element itself: a brief accent spotlight, the app's own :hover/:active look
 * (mirrored through om-demo-hover / om-demo-press), a ripple, a glowing caret
 * while typing, a glowing thumb while sliding. All timing runs on setTimeout
 * (never rAF), is scaled by the presenter's tempo, and every await rejects the
 * moment the beat's AbortSignal fires.
 *
 * createToolkit() builds the `ctx` object handed to each beat; see README.md.
 */
import { ease as easings, seededRandom } from '../lib/motion.js';
import { api, waitForNetworkIdle, getSessionRow, loadSessionRow, netState } from '../api.js';
import {
  DemoTimeoutError, abortError, sleep, throwIfAborted, expandSelector, normText,
  quantize, formatStep, focusRegistry, isEditable, store, now,
} from './runtime.js';

/* -------------------------------------------------------- overlay layer */

let layerEl = null;

/** One fixed, click-through layer for spotlights, ripples and glows. */
function layer() {
  if (layerEl?.isConnected) return layerEl;
  layerEl = document.createElement('div');
  layerEl.className = 'om-demo-layer';
  layerEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layerEl);
  return layerEl;
}

const DEMO_CLASSES = ['om-demo-hover', 'om-demo-press', 'om-demo-typing', 'om-demo-slide'];

/** Remove every director visual from the page (restart, crash recovery). */
export function clearAllVisuals() {
  layerEl?.replaceChildren();
  for (const cls of DEMO_CLASSES) {
    document.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
  }
}

/* ------------------------------------------------------------ DOM helpers */

const CLICKABLE = [
  'button', 'a[href]', '[role="button"]', '[role="radio"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]',
  'label', 'summary', 'input[type="submit"]', 'input[type="button"]',
  '.option', '.suggest-pill', '.report-row', '.fb-pal-item', '.tool-pick', '.reason-chip', '.dg-node', '.concept--toggle',
].join(', ');

function textMatches(root, text, selector) {
  const want = normText(text);
  if (!want) return [];
  const label = (el) => normText(el.getAttribute?.('aria-label'));
  let hits = Array.from(root.querySelectorAll(selector || CLICKABLE))
    .filter((el) => normText(el.textContent).includes(want) || label(el).includes(want));
  if (!hits.length && !selector) {
    // anything with that text, keeping only the innermost matches
    const all = Array.from(root.querySelectorAll('*'))
      .filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && normText(el.textContent).includes(want));
    hits = all.filter((el) => !Array.from(el.children).some((c) => normText(c.textContent).includes(want)));
  }
  // exact matches first, then the shortest text (the most specific element)
  const score = (el) => {
    const t = normText(el.textContent);
    return (t === want || label(el) === want ? 0 : 1e6) + t.length;
  };
  return hits.sort((a, b) => score(a) - score(b));
}

function queryAll(target, root) {
  if (target == null) return [];
  if (target instanceof Element) return [target];
  if (typeof target === 'function') {
    const r = target(root);
    if (r == null) return [];
    if (Array.isArray(r)) return r.filter(Boolean);
    if (typeof r.length === 'number' && typeof r !== 'string' && !(r instanceof Element)) return Array.from(r);
    return [r];
  }
  if (typeof target === 'object' && 'text' in target) {
    return textMatches(root, target.text, target.selector ? expandSelector(target.selector) : null);
  }
  const s = String(target);
  if (s.startsWith('text=')) return textMatches(root, s.slice(5));
  return Array.from(root.querySelectorAll(expandSelector(s)));
}

function describe(target) {
  if (target == null) return 'nothing';
  if (target instanceof Element) {
    const d = target.getAttribute('data-demo');
    if (d) return `@${d}`;
    return `<${target.tagName.toLowerCase()}${target.className && typeof target.className === 'string' ? `.${target.className.trim().split(/\s+/)[0]}` : ''}>`;
  }
  if (typeof target === 'function') return target.name ? `${target.name}()` : 'a query function';
  if (typeof target === 'object' && 'text' in target) return `text "${target.text}"`;
  return `"${target}"`;
}

export function isVisible(el) {
  if (!el?.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 && r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

export function isEnabled(el) {
  if (el.disabled === true) return false;
  if (el.getAttribute?.('aria-disabled') === 'true') return false;
  return !el.closest?.('fieldset:disabled');
}

function inFixedLayer(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

/** The usable part of the viewport: below the floating nav, above toasts and the Lulu button. */
function viewportBand() {
  const nav = document.querySelector('.nav');
  const top = (nav ? nav.getBoundingClientRect().bottom : 0) + 14;
  const bottom = window.innerHeight - 88;
  return { top, bottom: Math.max(top + 160, bottom) };
}

function needsScroll(el) {
  const r = el.getBoundingClientRect();
  const band = viewportBand();
  if (r.height >= band.bottom - band.top) return !(r.top >= band.top - 2 && r.top <= band.top + 80);
  return r.top < band.top || r.bottom > band.bottom;
}

/** Client point inside el: center, [fx, fy] fractions, {fx, fy}, or {x, y} client coords. */
export function pointIn(el, at) {
  const r = el.getBoundingClientRect();
  if (!at) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  if (Array.isArray(at)) return { x: r.left + at[0] * r.width, y: r.top + at[1] * r.height };
  if ('fx' in at || 'fy' in at) return { x: r.left + (at.fx ?? 0.5) * r.width, y: r.top + (at.fy ?? 0.5) * r.height };
  return { x: at.x, y: at.y };
}

function mouseInit(pt, extra = {}) {
  return {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: pt.x, clientY: pt.y, screenX: pt.x, screenY: pt.y, button: 0, buttons: 0, ...extra,
  };
}

function firePointer(target, type, pt, extra = {}) {
  const init = {
    ...mouseInit(pt, extra), pointerId: 1, pointerType: 'mouse', isPrimary: true,
    width: 1, height: 1, pressure: extra.buttons ? 0.5 : 0,
  };
  if (type === 'pointerenter' || type === 'pointerleave') init.bubbles = false;
  const Ctor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  return target.dispatchEvent(new Ctor(type, init));
}

function fireMouse(target, type, pt, extra = {}) {
  const init = mouseInit(pt, extra);
  if (type === 'mouseenter' || type === 'mouseleave') init.bubbles = false;
  return target.dispatchEvent(new MouseEvent(type, init));
}

function nativeSetter(el) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value').set;
}

/**
 * Set a React-controlled field's value the way a keystroke would: through the
 * native prototype setter (bypassing React's value tracker) plus a bubbling
 * 'input' event, so onChange fires.
 */
export function setFieldValue(el, value, { events = ['input'] } = {}) {
  if (el.isContentEditable) {
    el.textContent = value;
  } else {
    nativeSetter(el).call(el, value);
  }
  for (const type of events) el.dispatchEvent(new Event(type, { bubbles: true }));
}

function caretToEnd(el) {
  try {
    if (typeof el.setSelectionRange === 'function') {
      const n = String(el.value ?? '').length;
      el.setSelectionRange(n, n);
    }
  } catch { /* email/number inputs have no selection API */ }
  if (el.tagName === 'TEXTAREA') el.scrollTop = el.scrollHeight;
}

function easingFn(e) {
  if (typeof e === 'function') return e;
  return easings[e] ?? easings.inOutCubic;
}

/* --------------------------------------------------------------- toolkit */

/**
 * Build the ctx for one task (beat, enter or undo).
 * @param {object} o
 * @param {AbortSignal} o.signal   aborts on Escape / back / jump / restart / timeout
 * @param {() => number} o.getTempo presenter tempo (1 = normal, 2 = twice as fast)
 * @param {object} o.status        GET /api/demo/status payload
 * @param {(msg: string, level?: string) => void} o.log   HUD + console log
 * @param {object} o.meta          { kind, chapter, beat, title }
 */
export function createToolkit({ signal, getTempo = () => 1, status = {}, log = () => {}, meta = {} } = {}) {
  const addedClasses = new Map(); // el -> Set of om-demo classes this ctx added
  const overlays = new Set(); // overlay nodes this ctx created
  const timers = new Set();
  let hovered = null;
  // enter/undo only reset state, so they run faster than the story itself
  let tempoMult = meta.kind === 'enter' || meta.kind === 'undo' ? 2 : 1;

  const tempo = () => Math.max(0.1, (Number(getTempo()) || 1) * tempoMult);
  const check = () => throwIfAborted(signal);
  /** Real milliseconds (not tempo-scaled). */
  const pause = (ms) => sleep(ms, signal);
  /** Tempo-scaled wait: wait(1000) is half a second at tempo 2. */
  const wait = (ms) => sleep(ms / tempo(), signal);

  function addClass(el, cls) {
    el.classList.add(cls);
    if (!addedClasses.has(el)) addedClasses.set(el, new Set());
    addedClasses.get(el).add(cls);
  }
  function removeClass(el, cls) {
    el.classList.remove(cls);
    addedClasses.get(el)?.delete(cls);
  }
  function later(fn, ms) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  }
  function overlay(className) {
    const node = document.createElement('div');
    node.className = className;
    layer().appendChild(node);
    overlays.add(node);
    return node;
  }
  function dropOverlay(node, fadeMs = 260) {
    node.classList.add('out');
    later(() => {
      node.remove();
      overlays.delete(node);
    }, fadeMs);
  }

  /* ------------------------------------------------------------- waiting */

  /**
   * Resolve with the first truthy value of predicate() (sync or async),
   * checked every `interval` ms and whenever the DOM mutates.
   * Rejects with DemoTimeoutError after `timeout` (or resolves null if soft).
   */
  function waitFor(predicate, { timeout = 10000, interval = 50, label = 'condition', soft = false } = {}) {
    return new Promise((resolve, reject) => {
      const t0 = now();
      let timer = null;
      let mo = null;
      let done = false;
      let busy = false;
      let lastErr = null;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        mo?.disconnect();
        signal?.removeEventListener('abort', onAbort);
        fn(v);
      };
      const onAbort = () => finish(reject, abortError(signal));
      const schedule = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(tick, ms);
      };
      async function tick() {
        if (done || busy) return;
        busy = true;
        let v = null;
        try {
          v = await predicate();
          lastErr = null;
        } catch (e) {
          lastErr = e; // keep waiting: the thing it reads may simply not exist yet
        }
        busy = false;
        if (done) return;
        if (v) return finish(resolve, v);
        if (now() - t0 >= timeout) {
          if (soft) return finish(resolve, null);
          const why = lastErr ? ` (last error: ${lastErr.message})` : '';
          return finish(reject, new DemoTimeoutError(`${label}: not ready after ${(timeout / 1000).toFixed(1)} s${why}`));
        }
        schedule(interval);
      }
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        let lastKick = 0;
        mo = new MutationObserver(() => {
          const t = now();
          if (t - lastKick < 16) return;
          lastKick = t;
          if (!busy) schedule(0);
        });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      } catch { /* polling alone still works */ }
      tick();
    });
  }

  /**
   * Wait for an element and return it. target: CSS selector (with '@id' for
   * [data-demo="id"]), 'text=Label', { text, selector }, an Element, or
   * (root) => Element|Element[].
   */
  async function find(target, { within, timeout = 8000, visible = true, enabled = false, index = 0, label } = {}) {
    check();
    if (typeof target === 'string' && !target.startsWith('text=')) {
      try {
        document.querySelector(expandSelector(target));
      } catch {
        throw new Error(`find: invalid selector ${describe(target)}`);
      }
    }
    const what = label || describe(target);
    return waitFor(() => {
      const root = !within ? document : typeof within === 'string' ? document.querySelector(expandSelector(within)) : within;
      if (!root) return null;
      let els = queryAll(target, root);
      if (visible) els = els.filter(isVisible);
      if (enabled) els = els.filter(isEnabled);
      return els.at(index) ?? null;
    }, { timeout, label: `find ${what}${within ? ` within ${describe(within)}` : ''}` });
  }

  /** All current matches (no waiting). */
  function findAll(target, { within, visible = true } = {}) {
    const root = !within ? document : typeof within === 'string' ? document.querySelector(expandSelector(within)) : within;
    if (!root) return [];
    const els = queryAll(target, root);
    return visible ? els.filter(isVisible) : els;
  }

  const exists = (target, opts) => findAll(target, opts).length > 0;

  /** Wait until nothing visible matches target (e.g. a spinner or the compiling panel is gone). */
  async function waitGone(target, { within, timeout = 15000 } = {}) {
    await waitFor(() => !exists(target, { within }), { timeout, label: `${describe(target)} to disappear` });
  }

  /** Network idle for `quiet` ms (after a short grace so a just-clicked request has started). */
  async function waitNet({ quiet = 300, timeout = 20000, grace = 120 } = {}) {
    await pause(grace);
    const ok = await waitForNetworkIdle(quiet, { timeout, signal });
    if (!ok) log(`network still busy after ${Math.round(timeout / 1000)} s — continuing`, 'warn');
    return ok;
  }

  function revealBusy(el) {
    if (!el.classList.contains('in')) return true;
    if (typeof el.getAnimations !== 'function') return false;
    return el.getAnimations().some((a) => a.playState === 'running');
  }

  /** True when no .reveal entrance is pending or playing inside the viewport. */
  function revealsSettled() {
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('.reveal')) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || (r.width < 1 && r.height < 1)) continue;
      if (revealBusy(el)) return false;
    }
    return true;
  }

  /** Network idle + no running reveals: "the screen has finished changing". Never throws on timeout. */
  async function waitIdle({ quiet = 300, timeout = 20000 } = {}) {
    await waitNet({ quiet, timeout });
    await waitFor(revealsSettled, { timeout: 3000, interval: 60, soft: true, label: 'reveals' });
  }

  /** Wait until el's enclosing .reveal wrappers have finished fading in (max ~1.6 s). */
  async function settleReveal(el) {
    await waitFor(() => {
      for (let a = el.closest?.('.reveal'); a; a = a.parentElement?.closest('.reveal')) {
        if (revealBusy(a)) return false;
      }
      return true;
    }, { timeout: 1600, interval: 40, soft: true, label: 'reveal' });
  }

  async function settleScroll(el) {
    let lastY = null;
    let lastTop = null;
    let still = 0;
    const t0 = now();
    while (now() - t0 < 1800) {
      await pause(50);
      const y = window.scrollY;
      const top = el?.isConnected ? el.getBoundingClientRect().top : 0;
      const moved = lastY == null || Math.abs(y - lastY) >= 0.5 || Math.abs(top - lastTop) >= 0.5;
      still = moved ? 0 : still + 1;
      lastY = y;
      lastTop = top;
      if (still >= 3 && now() - t0 >= 150) break;
    }
  }

  /**
   * Smoothly scroll the window so el sits in the usable band; wait for it to
   * settle. Only the window is scrolled (scrollIntoView would also scroll
   * overflow:hidden containers such as the flow canvas), except inside fixed
   * layers (modals, the Lulu panel), where el's own scroll container moves.
   */
  async function scrollToEl(el, { block = 'center', force = false } = {}) {
    if (inFixedLayer(el)) {
      // on screen = inside the viewport and inside every scrolling ancestor (a modal body, the chat)
      const onScreen = () => {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) return false;
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          const oy = getComputedStyle(n).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) {
            const p = n.getBoundingClientRect();
            if (r.top < p.top - 1 || r.bottom > p.bottom + 1) return false;
          }
        }
        return true;
      };
      if (onScreen()) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      await settleScroll(el);
      // smooth scrolling needs rendered frames; a hidden window never gets there
      if (!onScreen()) el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
      return true;
    }
    if (!force && !needsScroll(el)) return false;
    const r = el.getBoundingClientRect();
    const band = viewportBand();
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const tall = r.height >= band.bottom - band.top;
    let y = block === 'start' || tall
      ? window.scrollY + r.top - band.top
      : window.scrollY + r.top + r.height / 2 - (band.top + band.bottom) / 2;
    y = Math.max(0, Math.min(maxY, Math.round(y)));
    if (Math.abs(y - window.scrollY) < 4) return false;
    window.scrollTo({ top: y, behavior: 'smooth' });
    await settleScroll(el);
    // smooth scrolling needs rendered frames; a hidden window never gets there
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' });
    return true;
  }

  /** scrollTo(target | y | 'top', { block: 'center'|'start' }). */
  async function scrollTo(target, { block = 'center', within, timeout } = {}) {
    check();
    if (target === 'top' || typeof target === 'number') {
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.max(0, Math.min(maxY, target === 'top' ? 0 : target));
      if (Math.abs(window.scrollY - y) < 2) return;
      window.scrollTo({ top: y, behavior: 'smooth' });
      await settleScroll(null);
      if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' });
      return;
    }
    const el = await find(target, { within, timeout, visible: false });
    await scrollToEl(el, { block, force: true });
    return el;
  }

  const scrollTop = () => scrollTo('top');

  /* ------------------------------------------------------------- visuals */

  /** Accent ring that follows el until released. */
  function ring(el, { pad = 6 } = {}) {
    const node = overlay('om-demo-spot');
    let radius = 12;
    if (el instanceof HTMLElement) radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    node.style.borderRadius = `${Math.min(radius + pad, 999)}px`;
    let alive = true;
    const place = () => {
      if (!alive || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      node.style.left = `${r.left - pad}px`;
      node.style.top = `${r.top - pad}px`;
      node.style.width = `${r.width + pad * 2}px`;
      node.style.height = `${r.height + pad * 2}px`;
      later(place, 32);
    };
    place();
    return {
      release() {
        if (!alive) return;
        alive = false;
        dropOverlay(node, 280);
      },
    };
  }

  function ripple(pt) {
    const node = overlay('om-demo-ripple');
    node.style.left = `${pt.x}px`;
    node.style.top = `${pt.y}px`;
    later(() => {
      node.remove();
      overlays.delete(node);
    }, 700);
  }

  /** A soft fingertip dot, shown only while dragging or clicking a canvas. */
  function touchDot(pt) {
    const node = overlay('om-demo-touch');
    const move = (p) => {
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
    };
    move(pt);
    return { move, release: () => dropOverlay(node, 260) };
  }

  /** Brief accent glow around an element (≈ 0.3 s in, hold, 0.28 s out). */
  async function spotlight(target, { hold = 320, pad = 6, within, timeout, scroll = true } = {}) {
    const el = await find(target, { within, timeout });
    if (scroll) await scrollToEl(el);
    const r = ring(el, { pad });
    try {
      await wait(hold);
    } finally {
      r.release();
    }
    await pause(200);
    return el;
  }

  /**
   * Move the (invisible) pointer from `from` to `to` (either may be null =
   * outside the app). React derives onMouseEnter/Leave and onPointerEnter/Leave
   * from the *out* event's relatedTarget (and from an *over* event only when
   * the pointer arrives from outside), so this fires exactly the enter/leave
   * handlers a real pointer would, containers included.
   */
  function moveHover(from, to) {
    const src = from?.isConnected ? from : null;
    const pt = to ? pointIn(to) : src ? pointIn(src) : { x: 0, y: 0 };
    if (src) {
      firePointer(src, 'pointerout', pt, { relatedTarget: to });
      firePointer(src, 'pointerleave', pt, { relatedTarget: to });
      fireMouse(src, 'mouseout', pt, { relatedTarget: to });
      fireMouse(src, 'mouseleave', pt, { relatedTarget: to });
    }
    if (to) {
      firePointer(to, 'pointerover', pt, { relatedTarget: src });
      firePointer(to, 'pointerenter', pt, { relatedTarget: src });
      fireMouse(to, 'mouseover', pt, { relatedTarget: src });
      fireMouse(to, 'mouseenter', pt, { relatedTarget: src });
      fireMouse(to, 'mousemove', pt);
    }
  }

  function hoverOn(el) {
    if (hovered === el) return;
    const prev = hovered;
    if (prev) removeClass(prev, 'om-demo-hover');
    hovered = el;
    addClass(el, 'om-demo-hover');
    moveHover(prev, el);
  }

  function hoverOff(el = hovered) {
    if (!el) return;
    removeClass(el, 'om-demo-hover');
    if (hovered === el) {
      hovered = null;
      moveHover(el, null);
    }
  }

  /** Bring el on screen and let its reveal finish, so the audience sees the action. */
  async function prepare(el, { scroll = true } = {}) {
    if (scroll) await scrollToEl(el);
    await settleReveal(el);
    check();
  }

  /* ------------------------------------------------------------- actions */

  /** Hover el (mirrors :hover, fires the enter events React listens to). Stays until unhover() or the next hover/click. */
  async function hover(target, { hold = 380, within, timeout, scroll = true, spot = false } = {}) {
    const el = await find(target, { within, timeout });
    await prepare(el, { scroll });
    const r = spot ? ring(el) : null;
    hoverOn(el);
    try {
      await wait(hold);
    } finally {
      r?.release();
    }
    return el;
  }

  function unhover() {
    hoverOff();
  }

  /**
   * Click like a person would, legibly: scroll into view, spotlight + hover,
   * press (the app's :active look) with a ripple, then the real click.
   * opts.at: [fx, fy] | {fx, fy} | {x, y} — where to press (default center).
   * opts.pointer: also send pointerdown/mousedown/pointerup/mouseup (for
   * components that act on pointer events, e.g. FlowBuilder node selection).
   */
  async function click(target, {
    within, timeout = 8000, at, pointer = false, spot = true, scroll = true, enabled = true,
    dwell = 260, hold = 150, settle = 140,
  } = {}) {
    const el = await find(target, { within, timeout, enabled });
    await prepare(el, { scroll });
    const r = spot ? ring(el) : null;
    try {
      hoverOn(el);
      await wait(dwell);
      const pt = pointIn(el, at);
      addClass(el, 'om-demo-press');
      ripple(pt);
      if (pointer) {
        firePointer(el, 'pointerdown', pt, { buttons: 1 });
        fireMouse(el, 'mousedown', pt, { buttons: 1 });
      }
      await wait(hold);
      removeClass(el, 'om-demo-press');
      if (pointer) {
        firePointer(el, 'pointerup', pt);
        fireMouse(el, 'mouseup', pt);
      }
      hoverOff(el);
      // a real click moves focus away from the field we were typing in
      const active = document.activeElement;
      if (isEditable(active) && active !== el && !el.contains?.(active)) {
        active.blur();
        if (focusRegistry.el === active) focusRegistry.el = null;
        if (focusRegistry.user === active) focusRegistry.user = null;
      }
      check();
      if (isEditable(el)) {
        el.focus({ preventScroll: true });
        focusRegistry.el = el;
      }
      if (el instanceof HTMLElement && !at && typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', mouseInit(pt, { detail: 1 })));
    } finally {
      r?.release();
    }
    await wait(settle);
    return el;
  }

  /**
   * Type text into an input/textarea character by character (native setter
   * + 'input' event per character), with a glowing caret.
   * opts: cps (characters per second at tempo 1), clear (empty it first).
   */
  async function type(target, text, { cps = 18, clear = false, within, timeout = 8000, scroll = true, spot = true } = {}) {
    const el = await find(target, { within, timeout, enabled: true });
    await prepare(el, { scroll });
    const r = spot ? ring(el) : null;
    try {
      await wait(160);
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      focusRegistry.el = el;
      addClass(el, 'om-demo-typing');
    } finally {
      r?.release();
    }
    if (clear && String(el.value ?? el.textContent ?? '')) await clearField(el, { cps: Math.max(40, cps * 3) });
    const rand = seededRandom(`type:${text}`);
    for (const ch of Array.from(String(text))) {
      check();
      const current = el.isContentEditable ? el.textContent : String(el.value ?? '');
      setFieldValue(el, current + ch);
      caretToEnd(el);
      const base = 1000 / (cps * tempo());
      const breath = /[\s,.;:!?—-]/.test(ch) ? base * 0.8 : 0;
      await pause(base * (0.55 + rand() * 0.9) + breath);
    }
    await pause(220);
    removeClass(el, 'om-demo-typing');
    return el;
  }

  async function clearField(el, { cps = 60, instant = false } = {}) {
    if (instant) {
      setFieldValue(el, '');
      return el;
    }
    let value = el.isContentEditable ? el.textContent : String(el.value ?? '');
    while (value.length) {
      check();
      value = Array.from(value).slice(0, -1).join('');
      setFieldValue(el, value);
      await pause(1000 / (cps * tempo()));
      value = el.isContentEditable ? el.textContent : String(el.value ?? '');
    }
    return el;
  }

  /** Empty a field visibly (fast backspacing), or at once with {instant: true}. */
  async function clear(target, { cps = 60, instant = false, within, timeout } = {}) {
    const el = await find(target, { within, timeout, enabled: true });
    await prepare(el);
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    focusRegistry.el = el;
    addClass(el, 'om-demo-typing');
    try {
      await clearField(el, { cps, instant });
    } finally {
      removeClass(el, 'om-demo-typing');
    }
    return el;
  }

  /** Pick an <option> of a <select> by value (spotlight, then native setter + change). */
  async function select(target, value, { within, timeout, hold = 260 } = {}) {
    const el = await find(target, { within, timeout, enabled: true });
    await prepare(el);
    const r = ring(el);
    try {
      await wait(hold);
      setFieldValue(el, String(value), { events: ['input', 'change'] });
    } finally {
      r.release();
    }
    await wait(120);
    return el;
  }

  /**
   * Dispatch keydown/keypress/keyup for `key` (e.g. 'Enter') on target, or on
   * the focused element when target is null. These synthetic events are never
   * mistaken for presenter keys (the director only listens to trusted ones).
   */
  async function pressKey(target, key, { code, within, timeout } = {}) {
    const el = target ? await find(target, { within, timeout, visible: false }) : (document.activeElement ?? document.body);
    const init = { key, code: code ?? (key === ' ' ? 'Space' : key), bubbles: true, cancelable: true, composed: true };
    if (key === 'Enter') Object.assign(init, { keyCode: 13, which: 13 });
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key.length === 1 || key === 'Enter') el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    await wait(80);
    return el;
  }

  /** Glowing dot over a range input's thumb. */
  function thumbGlow(el) {
    const node = overlay('om-demo-thumb');
    const place = () => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const f = max > min ? (Number(el.value) - min) / (max - min) : 0;
      const thumb = 16; // Chromium's default thumb width
      node.style.left = `${r.left + thumb / 2 + f * (r.width - thumb)}px`;
      node.style.top = `${r.top + r.height / 2}px`;
    };
    place();
    return { place, release: () => dropOverlay(node, 260) };
  }

  /**
   * Drag a range input to `to` (a number, or an array of waypoints) over
   * `duration` ms per leg, dispatching 'input' at every step change so the
   * visual redraws live, then 'change'. The thumb glows while it moves.
   */
  async function slide(target, to, { duration = 900, easing = 'inOutCubic', within, timeout, pause: legPause = 250, scroll = true } = {}) {
    const el = await find(target, { within, timeout, enabled: true });
    await prepare(el, { scroll });
    const min = Number.isFinite(parseFloat(el.min)) ? parseFloat(el.min) : 0;
    const max = Number.isFinite(parseFloat(el.max)) ? parseFloat(el.max) : 100;
    const step = el.step === 'any' ? 0 : (parseFloat(el.step) > 0 ? parseFloat(el.step) : 1);
    const ez = easingFn(easing);
    const legs = Array.isArray(to) ? to : [to];
    const r = ring(el, { pad: 8 });
    addClass(el, 'om-demo-slide');
    const glow = thumbGlow(el);
    try {
      await wait(180);
      r.release();
      for (let i = 0; i < legs.length; i++) {
        const from = Number.isFinite(parseFloat(el.value)) ? parseFloat(el.value) : min;
        const goal = quantize(Number(legs[i]), min, max, step);
        const dur = duration / tempo();
        const t0 = now();
        let last = el.value;
        for (;;) {
          check();
          const t = dur <= 0 ? 1 : Math.min(1, (now() - t0) / dur);
          const s = formatStep(quantize(from + (goal - from) * ez(t), min, max, step), step);
          if (s !== last) {
            setFieldValue(el, s);
            last = el.value;
          }
          glow.place();
          if (t >= 1) break;
          await pause(16);
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (i < legs.length - 1) await wait(legPause);
      }
      await wait(160);
    } finally {
      glow.release();
      removeClass(el, 'om-demo-slide');
    }
    return el;
  }

  /**
   * Press on el and drag along a path with PointerEvents: pointerdown on the
   * element, then pointermove/pointerup on window (where this app's drag code
   * listens). path: {dx, dy} from the start, or an array of client points
   * ({x, y} | [x, y]). opts.from: start point (default el center; same forms as click's `at`).
   * opts.moveOn: 'window' (default) | 'element' (bubbles up to window too).
   * opts.mouse: also send mousedown/mousemove/mouseup.
   */
  async function pointerDrag(target, path, {
    duration = 900, easing = 'inOutCubic', from, within, timeout, moveOn = 'window', mouse = false,
    spot = true, scroll = true,
  } = {}) {
    const el = await find(target, { within, timeout });
    await prepare(el, { scroll });
    const start = pointIn(el, from);
    const pts = Array.isArray(path)
      ? path.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }))
      : [{ x: start.x + (path?.dx ?? 0), y: start.y + (path?.dy ?? 0) }];
    const way = [start, ...pts];
    const lens = way.slice(1).map((p, i) => Math.hypot(p.x - way[i].x, p.y - way[i].y));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const at = (f) => {
      let d = f * total;
      for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
          const k = lens[i] ? Math.min(1, d / lens[i]) : 1;
          return { x: way[i].x + (way[i + 1].x - way[i].x) * k, y: way[i].y + (way[i + 1].y - way[i].y) * k };
        }
        d -= lens[i];
      }
      return way[way.length - 1];
    };
    const r = spot ? ring(el) : null;
    const dot = touchDot(start);
    const moveTarget = () => (moveOn === 'element' && el.isConnected ? el : window);
    let p = start;
    try {
      await wait(200);
      r?.release();
      ripple(start);
      firePointer(el, 'pointerover', start);
      firePointer(el, 'pointerdown', start, { buttons: 1 });
      if (mouse) fireMouse(el, 'mousedown', start, { buttons: 1 });
      // React commits the drag state and attaches its window listeners in an effect
      await pause(70);
      const ez = easingFn(easing);
      const dur = duration / tempo();
      const t0 = now();
      for (;;) {
        check();
        const t = dur <= 0 ? 1 : Math.min(1, (now() - t0) / dur);
        p = at(ez(t));
        firePointer(moveTarget(), 'pointermove', p, { buttons: 1 });
        if (mouse) fireMouse(moveTarget(), 'mousemove', p, { buttons: 1 });
        dot.move(p);
        if (t >= 1) break;
        await pause(16);
      }
      await pause(40);
    } finally {
      // always let go, even when aborted, so no component is left mid-drag
      firePointer(moveTarget(), 'pointerup', p);
      if (mouse) fireMouse(moveTarget(), 'mouseup', p);
      dot.release();
      r?.release();
    }
    await wait(120);
    return el;
  }

  /**
   * Click a point on a canvas/SVG. x, y are fractions of its box (0..1) by
   * default; {units: 'px'} = CSS px from its top-left; {units: 'client'} = viewport coords.
   */
  async function canvasClick(target, x, y, { units = 'frac', within, timeout, pointer = true, scroll = true, hold = 90 } = {}) {
    const el = await find(target, { within, timeout });
    await prepare(el, { scroll });
    const r = el.getBoundingClientRect();
    const pt = units === 'client' ? { x, y }
      : units === 'px' ? { x: r.left + x, y: r.top + y }
        : { x: r.left + x * r.width, y: r.top + y * r.height };
    const dot = touchDot(pt);
    ripple(pt);
    try {
      if (pointer) {
        firePointer(el, 'pointerdown', pt, { buttons: 1 });
        fireMouse(el, 'mousedown', pt, { buttons: 1 });
      }
      await wait(hold);
      if (pointer) {
        firePointer(el, 'pointerup', pt);
        fireMouse(el, 'mouseup', pt);
      }
      check();
      el.dispatchEvent(new MouseEvent('click', mouseInit(pt, { detail: 1 })));
    } finally {
      dot.release();
    }
    await wait(120);
    return el;
  }

  /* ------------------------------------------------------------ app state */

  /** Current SessionView stage (from [data-demo="session"][data-stage]) or null. */
  function stage() {
    return document.querySelector('[data-demo="session"]')?.dataset.stage ?? null;
  }

  /** Wait until the SessionView shows `name` (or one of an array of names). */
  async function waitStage(name, { timeout = 15000 } = {}) {
    const names = Array.isArray(name) ? name : [name];
    await waitFor(() => names.includes(stage()), { timeout, label: `stage ${names.join('|')}` });
    return stage();
  }

  /** Current session id (SessionView marker, else the #/session/:id route), or null. */
  function sessionId() {
    const marked = document.querySelector('[data-demo="session"]')?.dataset.sessionId;
    if (marked) return marked;
    return /#\/session\/([^/?#]+)/.exec(window.location.hash)?.[1] ?? null;
  }

  /** Go to a hash route ('/sessions', '#/projects', '/') and wait for it. */
  async function navigate(path) {
    check();
    const clean = String(path).replace(/^#/, '');
    const hash = `#${clean.startsWith('/') ? clean : `/${clean}`}`;
    const same = window.location.hash === hash || (hash === '#/' && (window.location.hash === '' || window.location.hash === '#'));
    if (!same) {
      window.location.hash = hash;
      await waitFor(() => window.location.hash === hash, { timeout: 3000, label: `route ${hash}` });
    }
    await pause(60);
  }

  /**
   * Resolves once the app has booted (the nav is on screen). When a chapter is
   * entered while the app's error screen is up, reload instead: the saved
   * pointer brings the show straight back into this chapter.
   */
  async function appReady() {
    if (meta.kind === 'enter' && document.querySelector('[data-demo="crashed"]')) {
      log('the app hit its error screen — reloading into this chapter', 'warn');
      window.location.reload();
      await new Promise(() => {}); // the page is going away
    }
    await waitFor(() => document.querySelector('.nav'), { timeout: 20000, soft: true, label: 'app boot' });
  }

  /** Run fn(ctx) with this ctx's tempo multiplied (e.g. to fast-forward inside enter()). */
  async function fast(fn, factor = 3) {
    const prev = tempoMult;
    tempoMult = prev * factor;
    try {
      return await fn(ctx);
    } finally {
      tempoMult = prev;
    }
  }

  const memo = {
    get(key, fallback = null) {
      const m = store.get('memo', {}) ?? {};
      return key in m ? m[key] : fallback;
    },
    set(key, value) {
      const m = store.get('memo', {}) ?? {};
      m[key] = value;
      store.set('memo', m);
      return value;
    },
  };

  /** Clean up everything this ctx left on screen (the engine calls it after every task). */
  function dispose() {
    hoverOff();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const node of overlays) node.remove();
    overlays.clear();
    for (const [el, set] of addedClasses) for (const cls of set) el.classList.remove(cls);
    addedClasses.clear();
  }

  const ctx = {
    // task
    signal,
    meta,
    status,
    persona: status?.persona ?? { name: 'Faisal', email: 'faisal@oceanmind.demo' },
    get tempo() { return tempo(); },
    check,
    log,
    // finding & waiting
    find, findAll, exists, waitGone, waitFor, waitIdle, waitNet, wait, pause,
    // acting
    spotlight, hover, unhover, click, type, clear, select, pressKey, slide, pointerDrag, canvasClick,
    scrollTo, scrollTop, pointAt: (el, fx, fy) => pointIn(el, [fx, fy]),
    // app state & data
    stage, waitStage, sessionId, navigate, appReady,
    api: (path, opts = {}) => api(path, { signal, ...opts }),
    net: netState,
    getSessionRow: (id = sessionId()) => getSessionRow(id),
    loadSessionRow: (id = sessionId()) => loadSessionRow(id),
    refreshUnread: () => window.__omRefreshUnread?.(),
    remember: memo.set,
    recall: memo.get,
    fast,
    dispose,
  };
  return ctx;
}

export { DemoTimeoutError };
