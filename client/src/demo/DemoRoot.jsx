/**
 * Demo-mode root, lazy-loaded by App.jsx only when GET /api/demo/status says
 * demo: true. It owns the one director for this page load, binds the
 * presenter keys, hides the idle mouse, and renders the (hidden) HUD.
 */
import { useEffect } from 'react';
import './demo.css';
import { chapters as storyChapters } from './beats.js';
import { api, clearSessionRows } from '../api.js';
import { createDirector, bindKeys } from './director.js';
import { createToolkit, clearAllVisuals } from './drivers.js';
import { clearDemoStorage } from './runtime.js';
import Hud from './Hud.jsx';

let director = null;

/** Sign out, forget everything the show stored, and reload at the front door. */
async function restartShow() {
  clearAllVisuals();
  // optional server-side reset of the demo data (ignored if the server has no such route)
  await api('/api/demo/reset', { method: 'POST' }).catch(() => {});
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  clearDemoStorage();
  clearSessionRows();
  window.location.hash = '#/';
  window.location.reload();
}

function getDirector(status) {
  if (director) return director;
  director = createDirector({
    chapters: Array.isArray(storyChapters) ? storyChapters : [],
    onRestart: restartShow,
    makeCtx: (task) =>
      createToolkit({
        signal: task.signal,
        getTempo: () => director.getState().tempo,
        status,
        log: (msg, level) => director.log(msg, level),
        meta: { kind: task.kind, chapter: task.chapter, beat: task.beat, title: task.title },
      }),
  });
  return director;
}

/**
 * Hide the presenter's mouse once it rests, and stop it from hovering things
 * the director is showing (body goes click-through until the mouse moves).
 */
function installIdleMouse(idleMs = 2500) {
  const root = document.documentElement;
  let t;
  const wake = (e) => {
    if (e && !e.isTrusted) return; // the director's synthetic events don't count
    root.classList.remove('om-demo-idle');
    clearTimeout(t);
    t = setTimeout(() => root.classList.add('om-demo-idle'), idleMs);
  };
  const opts = { capture: true, passive: true };
  window.addEventListener('mousemove', wake, opts);
  window.addEventListener('pointerdown', wake, opts);
  window.addEventListener('wheel', wake, opts);
  wake();
  return () => {
    clearTimeout(t);
    window.removeEventListener('mousemove', wake, opts);
    window.removeEventListener('pointerdown', wake, opts);
    window.removeEventListener('wheel', wake, opts);
    root.classList.remove('om-demo-idle');
  };
}

export default function DemoRoot({ status }) {
  const d = getDirector(status);

  useEffect(() => {
    const unbind = bindKeys(d);
    const unidle = installIdleMouse();
    try {
      window.history.scrollRestoration = 'manual';
    } catch { /* ignore */ }
    window.__omDirector = d; // for rehearsals from the console: __omDirector.next()
    d.resume(); // once per page load: an accidental refresh re-enters the current chapter
    return () => {
      unbind();
      unidle();
      if (window.__omDirector === d) delete window.__omDirector;
    };
  }, [d]);

  return <Hud director={d} />;
}
