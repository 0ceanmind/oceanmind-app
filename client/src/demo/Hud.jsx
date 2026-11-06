import { useEffect, useState, useSyncExternalStore } from 'react';
import { onNet, netState } from '../api.js';

const STATUS_LABEL = {
  ready: 'ready',
  running: 'running',
  entering: 'entering',
  undoing: 'undoing',
  error: 'error',
  aborted: 'aborted',
  done: 'end of show',
  restarting: 'restarting',
};

/**
 * Presenter-only heads-up display (hidden by default; 'h' toggles it).
 * Sits top-right under the nav, in the app's floating-glass style, and never
 * takes a click. The audience is not meant to see it.
 */
export default function Hud({ director }) {
  const s = useSyncExternalStore(director.subscribe, director.getState);
  const [inflight, setInflight] = useState(() => netState().inflight);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!s.hud) return undefined;
    setInflight(netState().inflight);
    return onNet((e) => setInflight(e.inflight));
  }, [s.hud]);

  // refresh the elapsed timer while something runs
  useEffect(() => {
    if (!s.hud || !s.task) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [s.hud, s.task]);

  if (!s.hud) return null;

  const { chapters } = director;
  const total = chapters.length;
  const ch = chapters[Math.min(s.chapter, total - 1)];
  // while a beat runs, "next" is the one after it
  let nc = s.chapter;
  let nb = s.task?.kind === 'beat' ? s.beat + 1 : s.beat;
  while (nc < total && nb >= (chapters[nc].beats?.length ?? 0)) {
    nc += 1;
    nb = 0;
  }
  const beats = chapters[nc]?.beats ?? [];
  const upcoming = nc < total ? beats[nb] : null;
  const elapsed = s.task ? ((Date.now() - s.task.startedAt) / 1000).toFixed(1) : null;
  const recent = s.lines.slice(-3);

  return (
    <aside className="om-demo-hud" aria-hidden="true">
      <div className="om-demo-hud-row">
        <b>Director</b>
        <span className={`om-demo-hud-status is-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
        <span className="om-demo-hud-tempo">{s.tempo}×</span>
      </div>

      <div className="om-demo-hud-chapter">
        {s.chapter < total ? (
          <>Chapter {s.chapter + 1}/{total} · {ch?.title ?? '—'}</>
        ) : (
          <>All {total} chapters played</>
        )}
      </div>

      {s.task && (
        <div className="om-demo-hud-now">
          ▶ {s.task.title} <span className="om-demo-hud-dim">{elapsed} s</span>
        </div>
      )}
      <div className="om-demo-hud-next">
        next: {upcoming ? <>{upcoming.title ?? `Beat ${nb + 1}`} <span className="om-demo-hud-dim">({nc !== s.chapter ? `ch ${nc + 1} · ` : ''}{nb + 1}/{beats.length}{upcoming.auto ? ' · auto' : ''})</span></> : '—'}
        {s.queued > 0 && <span className="om-demo-hud-queued">+1 queued</span>}
      </div>

      {s.lastError && (
        <div className="om-demo-hud-error">✗ {s.lastError.where}: {s.lastError.message}</div>
      )}
      {s.restartArmed && <div className="om-demo-hud-warn">press r again to restart the show</div>}

      <div className="om-demo-hud-dim">network: {inflight ? `${inflight} in flight` : 'idle'}</div>
      {recent.length > 0 && (
        <ol className="om-demo-hud-log">
          {recent.map((l) => (
            <li key={`${l.at}-${l.message}`} className={`is-${l.level}`}>{l.message}</li>
          ))}
        </ol>
      )}
      <div className="om-demo-hud-keys">→ next · ← back · 1–9 chapter · + − tempo · Esc abort · h hide · r r restart</div>
    </aside>
  );
}
