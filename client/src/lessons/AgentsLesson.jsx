import { useEffect, useRef, useState } from 'react';
import { Card, Spinner, useToast } from '../components/ui.jsx';
import { api } from '../api.js';

const SUGGESTED_GOALS = [
  'Research what tools an AI agent needs and write a summary note',
  'Calculate a budget: venue 1200 + 80 people at 8 each, check it fits under 2000, note the result',
  'Find what the source documents say about guardrails and save the three key points as notes',
];

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
  const [finalResult, setFinalResult] = useState(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const scrollRef = useRef(null);
  const maxSteps = config?.maxSteps ?? 10;

  useEffect(() => {
    api('/api/agent/tools')
      .then((d) => {
        setTools(d.tools);
        setPicked(d.tools.slice(0, 2).map((t) => t.id));
      })
      .catch((e) => toast(e.message, 'error'));
    return () => { stopRef.current = true; };
  }, [toast]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [steps, finalResult]);

  const toggleTool = (id) => {
    if (running) return;
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const run = async () => {
    const g = goal.trim();
    if (!g || picked.length === 0 || running) return;
    stopRef.current = false;
    setSteps([]);
    setFinalResult(null);
    setRunning(true);
    const history = [];
    try {
      for (let n = 0; n < maxSteps; n++) {
        if (stopRef.current) break;
        const r = await api('/api/agent/step', {
          method: 'POST',
          body: { topicId, goal: g, tools: picked, history },
        });
        if (r.done) {
          setSteps((s) => [...s, { kind: 'think', text: r.thought }]);
          setFinalResult(r.final);
          break;
        }
        history.push({ thought: r.thought, action: r.action, observation: r.observation });
        setSteps((s) => [
          ...s,
          { kind: 'think', text: r.thought },
          { kind: 'act', text: `${r.action.tool}(${String(r.action.input).slice(0, 120)})`, tool: r.action.tool },
          { kind: 'observe', text: r.observation },
        ]);
        if (n === maxSteps - 1) {
          setFinalResult('(Step budget reached — the agent ran out of steps before finishing. Try fewer sub-goals or more useful tools.)');
        }
      }
    } catch (e) {
      toast(e.message, 'error');
      setSteps((s) => [...s, { kind: 'fail', text: e.message }]);
    } finally {
      setRunning(false);
    }
  };

  const glyphs = { think: '🧠', act: '⚙️', observe: '👁', fail: '⛔' };

  if (!tools) return <div className="center"><Spinner /></div>;

  return (
    <div className="lesson-grid">
      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Agent setup</h3>
        <div className="field">
          <label>Goal — what should your agent accomplish?</label>
          <textarea className="textarea" style={{ minHeight: '4.2rem' }} value={goal}
            onChange={(e) => setGoal(e.target.value)} maxLength={300}
            placeholder="Type any goal, or pick a suggestion below…" disabled={running} />
          <div className="suggest-row" style={{ marginTop: '0.5rem' }}>
            {SUGGESTED_GOALS.map((g, i) => (
              <button key={i} className="suggest-pill" style={{ fontSize: '0.78rem' }}
                onClick={() => !running && setGoal(g)} title={g}>
                {g.slice(0, 42)}…
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Toolkit — what may it use?</label>
          {tools.map((t) => (
            <button key={t.id} className={`tool-pick ${picked.includes(t.id) ? 'on' : ''}`} onClick={() => toggleTool(t.id)}>
              <span className="box">{picked.includes(t.id) ? '✓' : ''}</span>
              {t.icon} {t.name}
              <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.75rem' }}>{t.description.split('.')[0]}</span>
            </button>
          ))}
        </div>
        <div className="ctrl-row">
          <button className="btn btn--primary" onClick={run} disabled={running || !goal.trim() || picked.length === 0}>
            {running ? <Spinner /> : '▶ Run agent'}
            {!running && <span className="btn-orb">→</span>}
          </button>
          {running && (
            <button className="btn btn--danger" onClick={() => { stopRef.current = true; }}>Stop</button>
          )}
        </div>
        {picked.length === 0 && <p className="form-error">An agent with no tools can’t act — pick at least one.</p>}
        <p className="muted mt-2">
          Every thought below is generated live by the connected model; every tool call is
          really executed on the server. Max {maxSteps} steps at your depth.
        </p>
      </Card>

      <Card>
        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.9rem' }}>
          The loop: <span style={{ color: 'var(--accent-soft)' }}>think → act → observe</span>
        </h3>
        <div ref={scrollRef} style={{ maxHeight: 460, overflowY: 'auto', paddingRight: 4 }}>
          {steps.length === 0 && !running && (
            <p className="muted">Give your agent a goal and press <b>Run</b> — every decision appears here as it happens, nothing hidden.</p>
          )}
          {steps.map((s, i) => (
            <div key={i} className={`agent-step ${s.kind}`}>
              <span className="glyph">{glyphs[s.kind]}</span>
              <div>
                <div className="kind">{s.kind}{s.tool ? ` · ${s.tool}` : ''}</div>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
          {running && (
            <div className="agent-step think">
              <span className="glyph"><Spinner /></span>
              <div><div className="kind">deciding</div><p>The model is choosing the next step…</p></div>
            </div>
          )}
          {finalResult && (
            <div className="agent-final">
              <div className="kind">🏁 result</div>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--ink)' }}>{finalResult}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
