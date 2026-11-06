import { useEffect, useRef, useState } from 'react';
import { Card, Spinner, useToast } from '../components/ui.jsx';
import { api } from '../api.js';
import { sleep, useTypewriter } from '../lib/motion.js';
import './agents.css';

const SUGGESTED_GOALS = [
  'Research what tools an AI agent needs and write a summary note',
  'Calculate a budget: venue 1200 + 80 people at 8 each, check it fits under 2000, note the result',
  'Find what the source documents say about guardrails and save the three key points as notes',
];

// Reveal pacing (ms): the thought types out, then act and observe land ~350ms apart.
const STAGGER_MS = 350;
// Between steps the "deciding" card stays up at least this long, even if the reply was instant.
const MIN_THINK_MS = 450;
const TYPE_TICK_MS = 33; // useTypewriter's tick
const glyphs = { think: '🧠', act: '⚙️', observe: '👁', fail: '⛔' };

/** Typing speed that keeps any thought under ~1.1s, however long it is. */
const thoughtCps = (text) => Math.max(120, Math.ceil(String(text ?? '').length / 1.1));
/** How long useTypewriter needs to finish `text` at `cps` (it reveals round(cps/30) chars per tick). */
const typeMs = (text, cps) => Math.ceil(String(text ?? '').length / Math.max(1, Math.round(cps / 30))) * TYPE_TICK_MS;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
/** The result types out in ≤ ~1.4s; its stat chips land 0.5s + 80ms each after it mounts. */
const finalCps = (text) => Math.max(140, Math.ceil(String(text ?? '').length / 1.4));
const FINAL_SETTLE_MS = 800;

function Typed({ text, cps, live = true }) {
  const shown = useTypewriter(text ?? '', { enabled: live, cps });
  return <span className={shown.length < (text ?? '').length ? 'om-caret' : undefined}>{shown}</span>;
}

/** Mini think → act → observe ring; the arc for the current phase lights up. */
function LoopRing({ phase }) {
  const arc = (from, to) => {
    const p = (deg) => {
      const r = (deg - 90) * (Math.PI / 180);
      return `${17 + 12 * Math.cos(r)} ${17 + 12 * Math.sin(r)}`;
    };
    return `M${p(from)} A12 12 0 0 1 ${p(to)}`;
  };
  const cls = (k) => {
    if (phase === 'done' || phase === 'final') return 'done';
    if (phase === 'thinking' && k === 'think') return `on ${k} pulse`;
    return phase === k ? `on ${k}` : k;
  };
  return (
    <svg className="om-ag-ring" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <path d={arc(8, 112)} className={cls('think')} />
      <path d={arc(128, 232)} className={cls('act')} />
      <path d={arc(248, 352)} className={cls('observe')} />
    </svg>
  );
}

/** A tool's real observation, tidied per tool (numbers stand out, passages become quotes). */
function Observation({ tool, text }) {
  const s = String(text ?? '');
  if (tool === 'calculator') {
    const m = s.match(/^([\s\S]*?) = (-?[\d.]+(?:e[+-]?\d+)?)$/i);
    if (m) return <p>{m[1]} = <b className="om-ag-result">{m[2]}</b></p>;
  }
  if (tool === 'docsearch') {
    const m = s.match(/^Top passages for "([\s\S]*?)":\n([\s\S]*)$/);
    if (m) {
      const passages = m[2].split(/\n\s*---\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
      return (
        <div>
          <p className="om-ag-obs-label">{passages.length} passage{passages.length === 1 ? '' : 's'} for “{m[1]}”</p>
          {passages.slice(0, 2).map((p, i) => <blockquote key={i} className="om-ag-quote">“{clip(p, 190)}”</blockquote>)}
          {passages.length > 2 && <p className="om-ag-obs-label">+{passages.length - 2} more</p>}
        </div>
      );
    }
  }
  if (tool === 'notes') {
    const m = s.match(/^Saved note #(\d+): "([\s\S]*)"$/);
    if (m) {
      return (
        <div>
          <p className="om-ag-obs-label">Saved note #{m[1]}</p>
          <blockquote className="om-ag-quote note">{m[2]}</blockquote>
        </div>
      );
    }
  }
  return <p className="om-ag-obs">{clip(s.trim(), 600)}</p>;
}

/**
 * A REAL agent: every think→act→observe step is decided live by the connected
 * model (POST /api/agent/step); the server actually executes the chosen tool
 * and returns the observation. Nothing is scripted.
 */
export default function AgentsLesson({ config, topicId }) {
  const toast = useToast();
  const [tools, setTools] = useState(null); // available tool defs from server
  const [picked, setPicked] = useState([]);
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState([]);
  const [finalResult, setFinalResult] = useState(null); // { text, ok, steps, calls }
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | thinking | think | act | observe | final | done | stopped | error
  const [stepNo, setStepNo] = useState(0);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const fillRef = useRef(null); // a suggestion being typed into the goal box
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const maxSteps = config?.maxSteps ?? 10;

  useEffect(() => {
    mountedRef.current = true;
    api('/api/agent/tools')
      .then((d) => {
        if (!mountedRef.current) return;
        setTools(d.tools);
        setPicked(d.tools.slice(0, 2).map((t) => t.id));
      })
      .catch((e) => toast(e.message, 'error'));
    return () => {
      stopRef.current = true;
      mountedRef.current = false;
      clearTimeout(fillRef.current?.timer);
    };
  }, [toast]);

  // follow the log as cards land and thoughts type out
  useEffect(() => {
    const box = scrollRef.current;
    const list = listRef.current;
    if (!box || !list || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }));
    ro.observe(list);
    return () => ro.disconnect();
  }, [tools]);

  const toggleTool = (id) => {
    if (running) return;
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  // a picked suggestion types itself into the goal box (~0.45s)
  const fillGoal = (text) => {
    if (runningRef.current) return;
    clearTimeout(fillRef.current?.timer);
    const chunk = Math.max(2, Math.ceil(text.length / 14));
    let i = 0;
    const tick = () => {
      i = Math.min(text.length, i + chunk);
      setGoal(text.slice(0, i));
      fillRef.current = i < text.length ? { target: text, timer: setTimeout(tick, TYPE_TICK_MS) } : null;
    };
    tick();
  };
  const finishFill = () => {
    const f = fillRef.current;
    if (!f) return goal;
    clearTimeout(f.timer);
    fillRef.current = null;
    setGoal(f.target);
    return f.target;
  };

  const run = async () => {
    const g = finishFill().trim();
    if (!g || picked.length === 0 || runningRef.current) return;
    const myRun = ++runIdRef.current;
    const live = () => mountedRef.current && runIdRef.current === myRun;
    const toolIds = [...picked];
    const history = [];
    stopRef.current = false;
    runningRef.current = true;
    setSteps([]);
    setFinalResult(null);
    setStepNo(0);
    setRunning(true);

    const ask = () => {
      const p = api('/api/agent/step', { method: 'POST', body: { topicId, goal: g, tools: toolIds, history: [...history] } });
      p.catch(() => {}); // a prefetched step may be abandoned by Stop; never leave it unhandled
      return p;
    };
    const revealThink = async (n, thought) => {
      const text = String(thought ?? '');
      setSteps((s) => [...s, { n, kind: 'think', text }]);
      setPhase('think');
      await sleep(typeMs(text, thoughtCps(text)) + STAGGER_MS);
    };
    const revealStep = async (n, r) => {
      await revealThink(n, r.thought);
      if (!live()) return;
      setSteps((s) => [...s, { n, kind: 'act', tool: r.action.tool, input: clip(String(r.action.input ?? ''), 120) }]);
      setPhase('act');
      await sleep(STAGGER_MS);
      if (!live()) return;
      setSteps((s) => [...s, { n, kind: 'observe', tool: r.action.tool, text: r.observation }]);
      setPhase('observe');
      await sleep(STAGGER_MS);
    };

    let pending = ask();
    let thinkSince = performance.now();
    setPhase('thinking');
    try {
      for (let n = 1; n <= maxSteps; n++) {
        const r = await pending;
        if (!live()) return;
        const waited = performance.now() - thinkSince;
        if (n > 1 && waited < MIN_THINK_MS) await sleep(MIN_THINK_MS - waited);
        if (!live()) return;
        setStepNo(n);
        if (r.done) {
          await revealThink(n, r.thought);
          if (!live()) return;
          const text = String(r.final ?? '');
          setFinalResult({ text, ok: true, steps: n, calls: history.map((h) => h.action.tool) });
          setPhase('final'); // the flourish plays; data-done flips once it has settled
          await sleep(typeMs(text, finalCps(text)) + FINAL_SETTLE_MS);
          if (!live()) return;
          setPhase('done');
          break;
        }
        history.push({ thought: r.thought, action: r.action, observation: r.observation });
        const more = n < maxSteps && !stopRef.current;
        if (more) pending = ask(); // the model decides the next step while this one is revealed
        await revealStep(n, r);
        if (!live()) return;
        if (stopRef.current) {
          setPhase('stopped');
          break;
        }
        if (!more) {
          const text = '(Step budget reached — the agent ran out of steps before finishing. Try fewer sub-goals or more useful tools.)';
          setFinalResult({ text, ok: false, steps: n, calls: history.map((h) => h.action.tool) });
          setPhase('final');
          await sleep(typeMs(text, finalCps(text)) + FINAL_SETTLE_MS);
          if (!live()) return;
          setPhase('done');
          break;
        }
        thinkSince = performance.now();
        setPhase('thinking');
      }
    } catch (e) {
      if (!live()) return;
      toast(e.message, 'error');
      setSteps((s) => [...s, { kind: 'fail', text: e.message }]);
      setPhase('error');
    } finally {
      if (runIdRef.current === myRun) {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
      }
    }
  };

  if (!tools) return <div className="center" data-demo="agent-loading"><Spinner /></div>;

  const toolDef = (id) => tools.find((t) => t.id === id);
  const thinking = running && phase === 'thinking';
  const on = (k) => `om-ag-phase ${phase === k || (k === 'think' && phase === 'thinking') ? 'on' : ''}`;
  const callCounts = finalResult?.ok
    ? Object.entries(finalResult.calls.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}))
    : [];

  return (
    <div className="lesson-grid" data-running={String(running)} data-done={String(phase === 'done')} data-phase={phase}
      data-step={stepNo} data-max-steps={maxSteps}>
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Agent setup</h3>
        <div className="field">
          <label>Goal — what should your agent accomplish?</label>
          <textarea className="textarea" style={{ minHeight: '4.2rem' }} value={goal}
            onChange={(e) => { clearTimeout(fillRef.current?.timer); fillRef.current = null; setGoal(e.target.value); }} maxLength={300}
            placeholder="Type any goal, or pick a suggestion below…" disabled={running} data-demo="agent-goal" />
          <div className="suggest-row" style={{ marginTop: '0.5rem' }}>
            {SUGGESTED_GOALS.map((g, i) => (
              <button key={i} className="suggest-pill" style={{ fontSize: '0.78rem' }}
                onClick={() => !running && fillGoal(g)} title={g} data-demo="agent-suggest" data-idx={i}>
                {g.slice(0, 42)}…
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Toolkit — what may it use?</label>
          {tools.map((t) => {
            const isOn = picked.includes(t.id);
            return (
              <button key={t.id} className={`tool-pick ${isOn ? 'on' : ''}`} onClick={() => toggleTool(t.id)}
                data-demo={`tool-${t.id}`} data-on={String(isOn)}>
                <span className="box">{isOn ? <span className="om-pop">✓</span> : ''}</span>
                {t.icon} {t.name}
                <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>{t.description.split('.')[0]}</span>
              </button>
            );
          })}
        </div>
        <div className="ctrl-row">
          <button className="btn btn--primary" onClick={run} disabled={running || !goal.trim() || picked.length === 0} data-demo="agent-run">
            {running ? <Spinner /> : '▶ Run agent'}
            {!running && <span className="btn-orb">→</span>}
          </button>
          {running && (
            <button className="btn btn--danger" onClick={() => { stopRef.current = true; }} data-demo="agent-stop">Stop</button>
          )}
        </div>
        {picked.length === 0 && <p className="form-error">An agent with no tools can’t act — pick at least one.</p>}
        <p className="muted mt-2">
          Every thought below is generated live by the connected model; every tool call is
          really executed on the server. Max {maxSteps} steps at your depth.
        </p>
      </Card>

      <Card>
        <div className="om-ag-loop-head">
          <h3 style={{ fontSize: '1.05rem' }}>
            The loop: <span style={{ color: 'var(--accent-soft)' }}>
              <span className={on('think')}>think</span> → <span className={on('act')}>act</span> → <span className={on('observe')}>observe</span>
            </span>
          </h3>
          <span className="om-ag-counter" data-demo="agent-counter" title="Steps used of this depth’s budget">
            <LoopRing phase={phase} />
            <span>step <b>{stepNo}</b> / {maxSteps}</span>
          </span>
        </div>
        <div className="om-ag-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, stepNo / maxSteps)})` }} /></div>
        <div ref={scrollRef} style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4 }} data-demo="agent-log">
          <div ref={listRef}>
            {steps.length === 0 && !running && (
              <p className="muted">Give your agent a goal and press <b>Run</b> — every decision appears here as it happens, nothing hidden.</p>
            )}
            {steps.map((s, i) => (
              <div key={i} className={`agent-step ${s.kind}`} data-demo="agent-step" data-kind={s.kind} data-n={s.n ?? ''}>
                <span className="glyph">{glyphs[s.kind]}</span>
                <div className="om-ag-step-body">
                  <div className="kind">{s.kind}{s.kind === 'think' && s.n ? ` · step ${s.n}` : ''}</div>
                  {s.kind === 'think' && <p><Typed text={s.text} cps={thoughtCps(s.text)} /></p>}
                  {s.kind === 'act' && (
                    <p>
                      <span className={`om-ag-chip t-${s.tool}`}>{toolDef(s.tool)?.icon ?? '🔧'} {toolDef(s.tool)?.name ?? s.tool}</span>
                      <code className="om-ag-input">{s.input}</code>
                    </p>
                  )}
                  {s.kind === 'observe' && <Observation tool={s.tool} text={s.text} />}
                  {s.kind === 'fail' && <p>{s.text}</p>}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="agent-step think om-ag-thinking" data-demo="agent-thinking">
                <span className="glyph">🧠</span>
                <div className="om-ag-step-body">
                  <div className="kind">deciding · step {stepNo + 1}</div>
                  <p><span className="om-typing"><i /><i /><i /></span><span className="muted">The model is choosing the next step…</span></p>
                </div>
              </div>
            )}
            {phase === 'stopped' && (
              <div className="agent-step think" data-demo="agent-stopped">
                <span className="glyph">⏹</span>
                <div className="om-ag-step-body">
                  <div className="kind">stopped</div>
                  <p>You stopped the agent after {stepNo} step{stepNo === 1 ? '' : 's'}. Everything above really happened.</p>
                </div>
              </div>
            )}
            {finalResult && (
              <div className="agent-final om-ag-final" data-demo="agent-final" data-ok={String(finalResult.ok)}>
                <div className="kind"><span className="om-ag-flag">🏁</span> result</div>
                <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--ink)' }}>
                  <Typed text={finalResult.text} cps={finalCps(finalResult.text)} />
                </p>
                {finalResult.ok && (
                  <div className="om-ag-final-stats">
                    <span className="om-ag-stat" style={{ '--i': 0 }}>{finalResult.steps} step{finalResult.steps === 1 ? '' : 's'}</span>
                    <span className="om-ag-stat" style={{ '--i': 1 }}>{finalResult.calls.length} real tool call{finalResult.calls.length === 1 ? '' : 's'}</span>
                    {callCounts.map(([t, c], i) => (
                      <span key={t} className={`om-ag-chip t-${t}`} style={{ '--i': i + 2 }}>{toolDef(t)?.icon ?? '🔧'} {toolDef(t)?.name ?? t} ×{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
